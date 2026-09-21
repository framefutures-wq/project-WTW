import { PRIVATE_SOURCE_REGISTRY, canonicalPrivateIdentity, classifyDuplicate } from "../../shared/private-official-sources";
import { KOREAN_FOLK_ADDRESS, KOREAN_FOLK_DISCOVERY_URL, KOREAN_FOLK_VENUE, KOREAN_FOLK_VENUE_URL, koreanFolkSelection, parseKoreanFolkDetail, parseKoreanFolkListing } from "../../shared/korean-folk-private-source";
import { alertDedupeKey, alertId, scheduleChanged } from "../../shared/alert-engine";
import type { Env } from "../env";

export type PrivateSummary = Record<"AUTO_PUBLISH" | "AUTO_RETRY" | "AUTO_EXCLUDE" | "POLICY_SKIP" | "EXPIRED" | "discovered" | "inserted" | "updated" | "source_errors" | "rows_read" | "rows_written", number>;
const empty = (): PrivateSummary => ({ AUTO_PUBLISH: 0, AUTO_RETRY: 0, AUTO_EXCLUDE: 0, POLICY_SKIP: 0, EXPIRED: 0, discovered: 0, inserted: 0, updated: 0, source_errors: 0, rows_read: 0, rows_written: 0 });
const MAX_CANDIDATES_PER_SOURCE = 25, MAX_DETAIL_REQUESTS = 5, MAX_PUBLISH_PER_RUN = 10, RETRY_DAYS = 30;
const sourceId = "private-korean-folk-village-source-main";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const hash = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))))).map((n) => n.toString(16).padStart(2, "0")).join("");
async function official(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "WeekendMwohaePrivateOfficial/1.0" } });
  if (!response.ok) throw new Error(`official_http_${response.status}`);
  const final = new URL(response.url);
  if (final.protocol !== "https:" || !["www.koreanfolk.co.kr", "koreanfolk.co.kr"].includes(final.hostname)) throw new Error("redirect_host_rejected");
  return response.text();
}
async function publish(env: Env, c: { id: string; title: string; startDate: string; endDate: string; description: string | null }, url: string, now: string, existing: { id: string; start_date: string; end_date: string } | null) {
  const after = { start_date: c.startDate, end_date: c.endDate };
  const alert = !existing ? (() => { const key = alertDedupeKey("NEW_EVENT", c.id, after); return env.DB.prepare("INSERT OR IGNORE INTO alert_events(id,event_id,alert_type,dedupe_key,created_at,effective_at,before_json,after_json,source_id) VALUES(?,?,?,?,?,?,?,?,?)").bind(alertId(key), c.id, "NEW_EVENT", key, now, now, null, JSON.stringify(after), sourceId); })() : scheduleChanged(existing, after) ? (() => { const key = alertDedupeKey("SCHEDULE_CHANGED", c.id, after); return env.DB.prepare("INSERT OR IGNORE INTO alert_events(id,event_id,alert_type,dedupe_key,created_at,effective_at,before_json,after_json,source_id) VALUES(?,?,?,?,?,?,?,?,?)").bind(alertId(key), c.id, "SCHEDULE_CHANGED", key, now, now, JSON.stringify({ start_date: existing.start_date, end_date: existing.end_date }), JSON.stringify(after), sourceId); })() : null;
  const evidence = `${c.title} | ${c.startDate}~${c.endDate} | ${KOREAN_FOLK_VENUE}`;
  const result = await env.DB.batch([
    env.DB.prepare("INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload) VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,fetched_at=excluded.fetched_at").bind(sourceId, "organizer", 1, "한국민속촌 공식 행사", KOREAN_FOLK_DISCOVERY_URL, now),
    env.DB.prepare("INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,lat,lng,cost,price_text,pet_policy,status,verification,is_sample,primary_source_id,checked_at,updated_at) VALUES(?,?,?,?,?,?,?,?,NULL,NULL,'unknown',NULL,'unknown','scheduled','verified',0,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,region=excluded.region,venue=excluded.venue,address=excluded.address,start_date=excluded.start_date,end_date=excluded.end_date,status='scheduled',verification='verified',primary_source_id=excluded.primary_source_id,checked_at=excluded.checked_at,updated_at=excluded.updated_at").bind(c.id, c.title, c.description ?? "한국민속촌 공식 행사 안내를 바탕으로 등록된 행사입니다.", "경기", KOREAN_FOLK_VENUE, KOREAN_FOLK_ADDRESS, c.startDate, c.endDate, sourceId, now, now),
    ...["schedule", "venue", "status"].map((field) => env.DB.prepare("INSERT INTO event_evidence(event_id,source_id,field,excerpt,checked_at) VALUES(?,?,?,?,?) ON CONFLICT(event_id,source_id,field) DO UPDATE SET excerpt=excluded.excerpt,checked_at=excluded.checked_at").bind(c.id, sourceId, field, field === "venue" ? `${KOREAN_FOLK_VENUE} | ${KOREAN_FOLK_ADDRESS} | ${KOREAN_FOLK_VENUE_URL}` : evidence, now)),
    ...(alert ? [alert] : []),
  ]);
  return { inserted: existing ? 0 : 1, updated: existing ? 1 : 0, rows: result.reduce((n, item) => n + (item.meta.changes ?? 0), 0) };
}
export async function runPrivateOfficialSources(env: Env) {
  const summary = empty();
  if (!PRIVATE_SOURCE_REGISTRY.korean_folk_village.enabled || !PRIVATE_SOURCE_REGISTRY.korean_folk_village.productionReady) return summary;
  const now = new Date().toISOString();
  try {
    const listing = parseKoreanFolkListing(await official(KOREAN_FOLK_DISCOVERY_URL));
    if (listing.length >= MAX_CANDIDATES_PER_SOURCE) throw new Error("source_candidate_circuit_breaker");
    for (const row of listing.slice(0, MAX_DETAIL_REQUESTS)) {
      summary.discovered += 1;
      try {
        const detail = parseKoreanFolkDetail(await official(row.officialUrl));
        const identity = canonicalPrivateIdentity({ sourceKey: "korean_folk_village", sourceUrl: row.officialUrl, title: detail.title, officialItemId: row.officialItemId });
        const id = `private-korean_folk_village-${row.officialItemId}`;
        const payloadHash = await hash({ title: detail.title, start_date: detail.startDate, end_date: detail.endDate, venue: KOREAN_FOLK_VENUE, official_url: row.officialUrl });
        const existing = await env.DB.prepare("SELECT id,start_date,end_date FROM events WHERE id=? LIMIT 1").bind(id).first<{ id: string; start_date: string; end_date: string }>();
        const previous = await env.DB.prepare("SELECT first_seen_at,last_payload_hash FROM private_candidate_state WHERE candidate_id=?").bind(id).first<{ first_seen_at: string; last_payload_hash: string }>();
        const nearby = await env.DB.prepare("SELECT id,title,start_date,end_date,venue,address FROM events WHERE is_sample=0 AND start_date<=? AND end_date>=? AND region='경기' LIMIT 26").bind(detail.endDate, detail.startDate).all<{ id: string; title: string; start_date: string; end_date: string; venue: string; address: string }>();
        summary.rows_read += nearby.meta.rows_read ?? 0;
        const duplicate = classifyDuplicate({ title: detail.title, startDate: detail.startDate, endDate: detail.endDate, venueName: KOREAN_FOLK_VENUE, address: KOREAN_FOLK_ADDRESS, sourceUrl: row.officialUrl }, nearby.results.map((event) => ({ title: event.title, startDate: event.start_date, endDate: event.end_date, venue: event.venue, address: event.address })));
        const selection = koreanFolkSelection(detail.title, detail.description);
        const changed = Boolean(existing && (existing.start_date !== detail.startDate || existing.end_date !== detail.endDate));
        const decision = detail.endDate < today() ? ["EXPIRED", "end_date_before_today"] as const : duplicate === "probable_duplicate" && !existing ? ["AUTO_EXCLUDE", "confirmed_duplicate"] as const : selection === "EXCLUDE" ? ["AUTO_EXCLUDE", "selection_exclude"] as const : selection !== "MAIN" || duplicate === "ambiguous_duplicate" || (changed && previous?.last_payload_hash !== payloadHash) ? ["AUTO_RETRY", changed ? "core_conflict" : "selection_or_duplicate_not_conclusive"] as const : ["AUTO_PUBLISH", "trusted_main_verified_core"] as const;
        summary[decision[0]] += 1;
        if (decision[0] === "AUTO_PUBLISH" && summary.inserted + summary.updated < MAX_PUBLISH_PER_RUN) { const write = await publish(env, { id, title: detail.title, startDate: detail.startDate, endDate: detail.endDate, description: detail.description }, row.officialUrl, now, existing ?? null); summary.inserted += write.inserted; summary.updated += write.updated; summary.rows_written += write.rows; }
        const retry = decision[0] === "AUTO_RETRY" ? new Date(new Date(previous?.first_seen_at ?? now).getTime() + RETRY_DAYS * 86400_000).toISOString() : null;
        const saved = await env.DB.prepare("INSERT INTO private_candidate_state(candidate_id,source_key,source_candidate_id,first_seen_at,last_seen_at,decision_state,decision_reason,retry_until,last_payload_hash,title_snapshot,start_date_snapshot,end_date_snapshot,venue_snapshot,official_url_snapshot,identity_stability,adapter_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(candidate_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,decision_state=excluded.decision_state,decision_reason=excluded.decision_reason,retry_until=excluded.retry_until,last_payload_hash=excluded.last_payload_hash,title_snapshot=excluded.title_snapshot,start_date_snapshot=excluded.start_date_snapshot,end_date_snapshot=excluded.end_date_snapshot,venue_snapshot=excluded.venue_snapshot,official_url_snapshot=excluded.official_url_snapshot,identity_stability=excluded.identity_stability,adapter_version=excluded.adapter_version").bind(id, "korean_folk_village", row.officialItemId, previous?.first_seen_at ?? now, now, decision[0], decision[1], retry, payloadHash, detail.title, detail.startDate, detail.endDate, KOREAN_FOLK_VENUE, row.officialUrl, identity.stability, PRIVATE_SOURCE_REGISTRY.korean_folk_village.adapterVersion).run();
        summary.rows_written += saved.meta.changes ?? 0;
      } catch (error) { summary.AUTO_RETRY += 1; console.error("private_candidate_failed", { source: "korean_folk_village", error: error instanceof Error ? error.name : "unknown" }); }
    }
  } catch (error) { summary.source_errors += 1; console.error("private_source_failed", { source: "korean_folk_village", error: error instanceof Error ? error.name : "unknown" }); }
  console.log("private_official_summary", summary);
  return summary;
}
