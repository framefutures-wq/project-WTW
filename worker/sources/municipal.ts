import { createEnrichmentCandidate, extractMunicipalCandidates, hasMunicipalDetailCoreConflict, selectMunicipalGate, type MunicipalCandidate } from "../../shared/municipal-discovery";
import { municipalSourceAllowsUrl, MUNICIPAL_SOURCE_REGISTRY } from "../../shared/municipal-source-registry";
import { decideMunicipalDuplicate } from "../../shared/municipal-duplicate";
import { decideAutonomousMunicipal, type AutonomousDecision } from "../../shared/municipal-autonomous";
import type { Env } from "../env";
import { alertDedupeKey, alertId, scheduleChanged } from "../../shared/alert-engine";

const SOURCES = MUNICIPAL_SOURCE_REGISTRY;
const MAX_PER_SOURCE = 25, MAX_PUBLISH = 10, MAX_RETRY_PER_RUN = 25, RETRY_DAYS = 30;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const hash = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))))).map((n) => n.toString(16).padStart(2, "0")).join("");
const sourceId = (id: string) => `municipal-source-${id}`;
// Durable municipal source IDs and Hwaseong's normalized canonical identity never include mutable dates.
const candidateId = (source: string, sourceId: string, _startDate: string | null) => `municipal-${source}-${sourceId}`;
const temporal = (candidate: MunicipalCandidate, current: string) => !candidate.end_date || candidate.end_date < current ? "EXPIRED" : candidate.start_date && candidate.start_date > current ? "UPCOMING" : "ACTIVE";

type Summary = Record<AutonomousDecision | "discovered" | "inserted" | "updated" | "source_errors" | "rows_read" | "rows_written", number>;
const emptySummary = (): Summary => ({ AUTO_PUBLISH: 0, AUTO_RETRY: 0, AUTO_EXCLUDE: 0, POLICY_SKIP: 0, EXPIRED: 0, discovered: 0, inserted: 0, updated: 0, source_errors: 0, rows_read: 0, rows_written: 0 });
async function official(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "WeekendMwohaeMunicipal/1.0" } });
  if (!response.ok) throw new Error(`official_http_${response.status}`);
  return response.text();
}
async function duplicate(env: Env, candidate: MunicipalCandidate, id: string) {
  if (!candidate.start_date || !candidate.end_date || !candidate.venue) return { decision: "REVIEW" as const, rows: 0 };
  const exact = await env.DB.prepare("SELECT id,title,region,start_date,end_date,venue,address FROM events WHERE title=? LIMIT 2").bind(candidate.title).all();
  const nearby = await env.DB.prepare("SELECT id,title,region,start_date,end_date,venue,address FROM events WHERE is_sample=0 AND verification='verified' AND status IN ('scheduled','unknown') AND region=? AND start_date<=? AND end_date>=? AND (venue LIKE ? OR address LIKE ?) LIMIT 26").bind(candidate.region, candidate.end_date, candidate.start_date, `%${candidate.locality}%`, `%${candidate.locality}%`).all();
  const overflow = nearby.results.length >= 26;
  return { decision: overflow ? "REVIEW" as const : decideMunicipalDuplicate({ id, title: candidate.title, region: candidate.region, start_date: candidate.start_date, end_date: candidate.end_date, venue: candidate.venue, address: candidate.venue }, exact.results as any[], nearby.results as any[]), rows: (exact.meta.rows_read ?? 0) + (nearby.meta.rows_read ?? 0) };
}
async function state(env: Env, id: string) {
  return env.DB.prepare("SELECT last_payload_hash,decision_state,first_seen_at,retry_until FROM municipal_candidate_state WHERE candidate_id=?").bind(id).first<{ last_payload_hash: string; decision_state: AutonomousDecision; first_seen_at: string; retry_until: string | null }>();
}
async function saveState(env: Env, candidate: MunicipalCandidate, id: string, decision: { state: AutonomousDecision; reason: string }, payloadHash: string, now: string, previous: { first_seen_at: string } | null) {
  const retry = decision.state === "AUTO_RETRY" ? new Date(new Date(previous?.first_seen_at ?? now).getTime() + RETRY_DAYS * 86400_000).toISOString() : null;
  return env.DB.prepare("INSERT INTO municipal_candidate_state(candidate_id,source_key,first_seen_at,last_seen_at,decision_state,decision_reason,retry_until,last_payload_hash,source_candidate_id,title_snapshot,start_date_snapshot,end_date_snapshot,venue_snapshot,locality_snapshot,official_url_snapshot) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(candidate_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,decision_state=excluded.decision_state,decision_reason=excluded.decision_reason,retry_until=excluded.retry_until,last_payload_hash=excluded.last_payload_hash,source_candidate_id=excluded.source_candidate_id,title_snapshot=excluded.title_snapshot,start_date_snapshot=excluded.start_date_snapshot,end_date_snapshot=excluded.end_date_snapshot,venue_snapshot=excluded.venue_snapshot,locality_snapshot=excluded.locality_snapshot,official_url_snapshot=excluded.official_url_snapshot")
    .bind(id, candidate.source, now, now, decision.state, decision.reason, retry, payloadHash, candidate.source_candidate_id, candidate.title, candidate.start_date, candidate.end_date, candidate.venue, candidate.locality, candidate.official_url).run();
}
async function publish(env: Env, candidate: MunicipalCandidate, id: string, summaryText: string | null, now: string, existing: { id: string; start_date?: string | null; end_date?: string | null; status?: string | null } | null) {
  const sid = sourceId(id), evidence = `${candidate.title} | ${candidate.start_date}~${candidate.end_date} | ${candidate.venue}`;
  const after = { start_date: candidate.start_date, end_date: candidate.end_date };
  const alertStatements = !existing
    ? (() => { const dedupe = alertDedupeKey("NEW_EVENT", id, after); return [env.DB.prepare("INSERT OR IGNORE INTO alert_events(id,event_id,alert_type,dedupe_key,created_at,effective_at,before_json,after_json,source_id) VALUES(?,?,?,?,?,?,?,?,?)").bind(alertId(dedupe), id, "NEW_EVENT", dedupe, now, now, null, JSON.stringify(after), sid)]; })()
    : scheduleChanged(existing, after)
      ? (() => { const dedupe = alertDedupeKey("SCHEDULE_CHANGED", id, after); return [env.DB.prepare("INSERT OR IGNORE INTO alert_events(id,event_id,alert_type,dedupe_key,created_at,effective_at,before_json,after_json,source_id) VALUES(?,?,?,?,?,?,?,?,?)").bind(alertId(dedupe), id, "SCHEDULE_CHANGED", dedupe, now, now, JSON.stringify({ start_date: existing.start_date, end_date: existing.end_date }), JSON.stringify(after), sid)]; })()
      : [];
  const statements = [
    env.DB.prepare("INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload) VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,fetched_at=excluded.fetched_at").bind(sid, "municipality", 2, `${candidate.source} 공식 행사 안내`, candidate.official_url, now),
    env.DB.prepare("INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,lat,lng,cost,price_text,pet_policy,status,verification,is_sample,primary_source_id,checked_at,updated_at) VALUES(?,?,?,?,?,?,?,?,NULL,NULL,'unknown',NULL,'unknown','scheduled','verified',0,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,region=excluded.region,venue=excluded.venue,address=excluded.address,start_date=excluded.start_date,end_date=excluded.end_date,status='scheduled',verification='verified',primary_source_id=excluded.primary_source_id,checked_at=excluded.checked_at,updated_at=excluded.updated_at")
      .bind(id, candidate.title, summaryText ?? "공식 지자체 행사 안내를 바탕으로 등록된 행사입니다.", candidate.region, candidate.venue, candidate.venue, candidate.start_date, candidate.end_date, sid, now, now),
    ...alertStatements,
    ...["schedule", "venue", "status"].map((field) => env.DB.prepare("INSERT INTO event_evidence(event_id,source_id,field,excerpt,checked_at) VALUES(?,?,?,?,?) ON CONFLICT(event_id,source_id,field) DO UPDATE SET excerpt=excluded.excerpt,checked_at=excluded.checked_at").bind(id, sid, field, evidence, now)),
  ];
  const result = await env.DB.batch(statements);
  return { inserted: existing ? 0 : 1, updated: existing ? 1 : 0, rows: result.reduce((total, item) => total + (item.meta.changes ?? 0), 0) };
}

export async function runMunicipalAutonomous(env: Env) {
  const summary = emptySummary(), now = new Date().toISOString(), koreaToday = today(), processed = new Set<string>();
  for (const source of SOURCES) {
    try {
      const list = await official(source.url);
      const extraction = extractMunicipalCandidates(source, list);
      if (extraction.mode === "retry")
        throw new Error(
          `source_${extraction.assessment.status}:${extraction.assessment.reason}`,
        );
      const candidates = extraction.candidates.slice(0, MAX_PER_SOURCE);
      if (!candidates.length) throw new Error("source_parse_zero_candidates");
      if (candidates.length >= MAX_PER_SOURCE) throw new Error("source_candidate_circuit_breaker");
      for (const candidate of candidates) {
        summary.discovered += 1;
        const id = candidateId(candidate.source, candidate.source_candidate_id, candidate.start_date);
        processed.add(id);
        const gate = selectMunicipalGate(candidate), duplicateResult = await duplicate(env, candidate, id);
        summary.rows_read += duplicateResult.rows;
        let detailError = false, detailCoreConflict = false, enrichment: ReturnType<typeof createEnrichmentCandidate> | null = null;
        if (gate.gate === "MAIN" && duplicateResult.decision === "NEW" && !candidate.parse_error) {
          try {
            if (!municipalSourceAllowsUrl(source, candidate.official_url))
              throw new Error("detail_host_not_allowed");
            const detail =
              candidate.official_url === source.url
                ? list
                : await official(candidate.official_url);
            enrichment = createEnrichmentCandidate(candidate, detail);
            detailError = Boolean(enrichment.parse_error);
            detailCoreConflict =
              candidate.official_url !== source.url &&
              hasMunicipalDetailCoreConflict(candidate, detail);
          } catch {
            detailError = true;
          }
        }
        const payloadHash = await hash({ title: candidate.title, start_date: candidate.start_date, end_date: candidate.end_date, venue: candidate.venue, official_url: candidate.official_url });
        const existing = await env.DB.prepare("SELECT id,start_date,end_date,venue,status FROM events WHERE id=? LIMIT 1").bind(id).first<{ id: string; start_date: string; end_date: string; venue: string; status: string }>();
        const previous = await state(env, id);
        const changedExisting = Boolean(existing && (existing.start_date !== candidate.start_date || existing.end_date !== candidate.end_date || existing.venue !== candidate.venue));
        // A changed core payload needs two identical daily observations before it replaces last-known-good.
        const coreConflict = changedExisting && previous?.last_payload_hash !== payloadHash;
        let decision = decideAutonomousMunicipal({ gate: gate.gate, duplicate: duplicateResult.decision, temporal: temporal(candidate, koreaToday), trusted: true, coreValid: Boolean(candidate.title && candidate.start_date && candidate.end_date && candidate.venue && candidate.official_url), parserError: Boolean(candidate.parse_error), detailError, coreConflict: coreConflict || detailCoreConflict });
        if (decision.state === "AUTO_PUBLISH" && summary.inserted + summary.updated >= MAX_PUBLISH)
          decision = { state: "AUTO_RETRY", reason: "daily_publish_circuit_breaker" };
        summary[decision.state] += 1;
        if (decision.state === "AUTO_PUBLISH") {
          const write = await publish(env, candidate, id, enrichment?.summary ?? candidate.snippet, now, existing ?? null);
          summary.inserted += write.inserted; summary.updated += write.updated; summary.rows_written += write.rows;
        }
        const saved = await saveState(env, candidate, id, decision, payloadHash, now, previous); summary.rows_written += saved.meta.changes ?? 0;
      }
    } catch (error) {
      summary.source_errors += 1;
      console.error("municipal_source_failed", {
        source: source.key,
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  // Retry candidates are intentionally re-fetched from their minimal core snapshot even when absent from today's listing.
  const retries = await env.DB.prepare("SELECT candidate_id,source_key,source_candidate_id,title_snapshot,start_date_snapshot,end_date_snapshot,venue_snapshot,locality_snapshot,official_url_snapshot,first_seen_at,retry_until,last_payload_hash FROM municipal_candidate_state WHERE decision_state='AUTO_RETRY' AND retry_until IS NOT NULL AND retry_until>=? ORDER BY retry_until LIMIT ?").bind(now, MAX_RETRY_PER_RUN).all<{
    candidate_id: string; source_key: MunicipalCandidate["source"]; source_candidate_id: string; title_snapshot: string; start_date_snapshot: string | null; end_date_snapshot: string | null; venue_snapshot: string | null; locality_snapshot: MunicipalCandidate["locality"]; official_url_snapshot: string; first_seen_at: string; retry_until: string; last_payload_hash: string;
  }>();
  summary.rows_read += retries.meta.rows_read ?? 0;
  for (const row of retries.results) {
    if (processed.has(row.candidate_id)) continue;
    try {
      const source = SOURCES.find((item) => item.key === row.source_key);
      if (!source || !row.title_snapshot || !row.venue_snapshot || !row.official_url_snapshot) continue;
      let candidate: MunicipalCandidate = { source: row.source_key, source_candidate_id: row.source_candidate_id, title: row.title_snapshot, start_date: row.start_date_snapshot, end_date: row.end_date_snapshot, venue: row.venue_snapshot, locality: row.locality_snapshot || source.locality, region: source.region, official_url: row.official_url_snapshot, category: null, snippet: null, image_candidate: null };
      let detail: string;
      if (candidate.official_url === source.url) {
        detail = await official(source.url);
        const extraction = extractMunicipalCandidates(source, detail);
        if (extraction.mode === "retry")
          throw new Error(
            `source_${extraction.assessment.status}:${extraction.assessment.reason}`,
          );
        const refreshed = extraction.candidates.find(
          (item) => item.source_candidate_id === candidate.source_candidate_id,
        );
        // Canonical lists are current authority: an absent identity may never publish from an old snapshot.
        if (!refreshed) { summary.AUTO_RETRY += 1; continue; }
        candidate = refreshed;
      } else {
        if (!municipalSourceAllowsUrl(source, candidate.official_url))
          throw new Error("detail_host_not_allowed");
        detail = await official(candidate.official_url);
      }
      const gate = selectMunicipalGate(candidate), duplicateResult = await duplicate(env, candidate, row.candidate_id);
      summary.rows_read += duplicateResult.rows;
      const enrichment = createEnrichmentCandidate(candidate, detail);
      const decision = decideAutonomousMunicipal({ gate: gate.gate, duplicate: duplicateResult.decision, temporal: temporal(candidate, koreaToday), trusted: true, coreValid: Boolean(candidate.title && candidate.start_date && candidate.end_date && candidate.venue && candidate.official_url), parserError: Boolean(candidate.parse_error), detailError: Boolean(enrichment.parse_error), coreConflict: candidate.official_url !== source.url && hasMunicipalDetailCoreConflict(candidate, detail) });
      summary[decision.state] += 1;
      const payloadHash = await hash({ title: candidate.title, start_date: candidate.start_date, end_date: candidate.end_date, venue: candidate.venue, official_url: candidate.official_url });
      const existing = await env.DB.prepare("SELECT id,start_date,end_date,status FROM events WHERE id=? LIMIT 1").bind(row.candidate_id).first<{ id: string; start_date: string; end_date: string; status: string }>();
      if (decision.state === "AUTO_PUBLISH" && summary.inserted + summary.updated < MAX_PUBLISH) {
        const write = await publish(env, candidate, row.candidate_id, enrichment.summary, now, existing); summary.inserted += write.inserted; summary.updated += write.updated; summary.rows_written += write.rows;
      }
      const saved = await saveState(env, candidate, row.candidate_id, decision, payloadHash, now, row); summary.rows_written += saved.meta.changes ?? 0;
      processed.add(row.candidate_id);
    } catch {
      // Fetch failure is retryable; retain fixed retry_until and last-known-good publication.
      summary.AUTO_RETRY += 1;
    }
  }
  const expiredRetries = await env.DB.prepare("UPDATE municipal_candidate_state SET decision_state='AUTO_EXCLUDE',decision_reason='retry_ttl_expired' WHERE decision_state='AUTO_RETRY' AND retry_until IS NOT NULL AND retry_until<?").bind(now).run();
  summary.rows_written += expiredRetries.meta.changes ?? 0;
  console.log("municipal_autonomous_summary", summary);
  return summary;
}
