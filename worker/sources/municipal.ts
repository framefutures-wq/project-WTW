import {
  createEnrichmentCandidate,
  extractMunicipalCandidates,
  hasMunicipalDetailCoreConflict,
  selectMunicipalGate,
  type MunicipalCandidate,
} from "../../shared/municipal-discovery";
import {
  municipalSourceAllowsUrl,
  MUNICIPAL_SOURCE_REGISTRY,
} from "../../shared/municipal-source-registry";
import {
  fetchMunicipalSourcePages,
  selectBoundedMunicipalCandidates,
} from "../../shared/municipal-pagination";
import { followUpMunicipalListDetails } from "../../shared/municipal-list-detail-followup";
import {
  confirmRepeatedImageVisionCandidate,
  extractMunicipalDocumentCandidates,
  type MunicipalDocumentMode,
} from "../../shared/municipal-document-fallback";
import { decideMunicipalDuplicate } from "../../shared/municipal-duplicate";
import {
  decideAutonomousMunicipal,
  type AutonomousDecision,
} from "../../shared/municipal-autonomous";
import {
  hasUnconfirmedMunicipalCoreChange,
  isMunicipalPublicationMutation,
  municipalPublishSlotAvailable,
} from "../../shared/municipal-publication";
import { municipalDocumentAI, type Env } from "../env";
import {
  alertDedupeKey,
  alertId,
  scheduleChanged,
} from "../../shared/alert-engine";
import {
  extractMunicipalRichDetail,
  type MunicipalRichDetail,
} from "../../shared/municipal-rich-detail";
import { persistMunicipalRichDetail } from "./municipal-rich-detail";
import {
  MUNICIPAL_MAX_FETCHES_PER_SOURCE_WINDOW,
  MUNICIPAL_MIN_FETCH_RESERVE_PER_SOURCE,
  municipalSourceFetchCeiling,
} from "../../shared/municipal-fetch-budget";
import { decidePublishQuality } from "../../shared/publish-quality";
import {
  buildDetailLinkInjection,
  fetchOfficialPageViaReader,
} from "../../shared/official-reader-fallback";

const SOURCES = MUNICIPAL_SOURCE_REGISTRY;
const MAX_PER_SOURCE = 25,
  RETRY_DAYS = 30;

export type MunicipalAutonomousOptions = {
  shardIndex?: number;
  sourceKeys?: readonly string[];
  maxPublishMutations?: number;
  maxRetryCandidates?: number;
  maxDetailFetches?: number;
  maxExternalFetches?: number;
};

const DEFAULT_MAX_PUBLISH_MUTATIONS = 10;
const DEFAULT_MAX_RETRY_CANDIDATES = 25;
const DEFAULT_MAX_DETAIL_FETCHES = 25;
const DEFAULT_MAX_EXTERNAL_FETCHES = 1000;
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const hash = async (value: unknown) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(value)),
      ),
    ),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
const sourceId = (id: string) => `municipal-source-${id}`;
const exactOfficialDetailUrl = (candidate: MunicipalCandidate) => {
  const source = SOURCES.find((item) => item.key === candidate.source);
  if (
    !source ||
    candidate.official_url === source.url ||
    !municipalSourceAllowsUrl(source, candidate.official_url)
  )
    return null;
  return candidate.official_url;
};
const richDetailFieldCount = (detail: MunicipalRichDetail | null) =>
  detail
    ? Number(Boolean(detail.summary)) +
      Number(detail.operating_hours.length > 0) +
      Number(Boolean(detail.price_text)) +
      Number(Boolean(detail.contact_phone)) +
      Number(detail.images.length > 0) +
      Number(detail.programs.length > 0)
    : 0;
// Durable municipal source IDs and Hwaseong's normalized canonical identity never include mutable dates.
const candidateId = (
  source: string,
  sourceId: string,
  _startDate: string | null,
) => `municipal-${source}-${sourceId}`;

async function resolveImprovedGenericIdentity(
  env: Env,
  source: (typeof SOURCES)[number],
  candidate: MunicipalCandidate,
  mode: SourceCandidate["mode"],
  provisionalId: string,
) {
  if (
    mode !== "generic_html" ||
    candidate.official_url === source.url ||
    !candidate.start_date ||
    !candidate.end_date ||
    !candidate.venue
  )
    return { id: provisionalId, rows: 0, bridged: false };

  const matches = await env.DB.prepare(
    `WITH identity_matches(id,rank) AS (
      SELECT id,0 FROM events WHERE id=?
      UNION
      SELECT candidate_id,0 FROM municipal_candidate_state WHERE candidate_id=?
      UNION
      SELECT id,1 FROM events
       WHERE id LIKE ?
         AND title=?
         AND region=?
         AND start_date=?
         AND end_date=?
         AND venue=?
      UNION
      SELECT candidate_id,1 FROM municipal_candidate_state
       WHERE source_key=?
         AND title_snapshot=?
         AND start_date_snapshot=?
         AND end_date_snapshot=?
         AND venue_snapshot=?
    )
    SELECT id,MIN(rank) AS rank
    FROM identity_matches
    GROUP BY id
    ORDER BY rank,id
    LIMIT 3`,
  )
    .bind(
      provisionalId,
      provisionalId,
      `municipal-${source.key}-%`,
      candidate.title,
      candidate.region,
      candidate.start_date,
      candidate.end_date,
      candidate.venue,
      source.key,
      candidate.title,
      candidate.start_date,
      candidate.end_date,
      candidate.venue,
    )
    .all<{ id: string; rank: number }>();

  const exact = matches.results.find((row) => Number(row.rank) === 0);
  if (exact) return {
    id: provisionalId,
    rows: matches.meta.rows_read ?? 0,
    bridged: false,
  };

  const legacy = matches.results.filter((row) => Number(row.rank) === 1);
  return legacy.length === 1
    ? {
        id: legacy[0].id,
        rows: matches.meta.rows_read ?? 0,
        bridged: legacy[0].id !== provisionalId,
      }
    : {
        id: provisionalId,
        rows: matches.meta.rows_read ?? 0,
        bridged: false,
      };
}
const temporal = (candidate: MunicipalCandidate, current: string) =>
  !candidate.end_date || candidate.end_date < current
    ? "EXPIRED"
    : candidate.start_date && candidate.start_date > current
      ? "UPCOMING"
      : "ACTIVE";

type Summary = Record<
  | AutonomousDecision
  | "discovered"
  | "inserted"
  | "updated"
  | "source_errors"
  | "rows_read"
  | "rows_written",
  number
>;
const emptySummary = (): Summary => ({
  AUTO_PUBLISH: 0,
  AUTO_RETRY: 0,
  AUTO_EXCLUDE: 0,
  POLICY_SKIP: 0,
  EXPIRED: 0,
  discovered: 0,
  inserted: 0,
  updated: 0,
  source_errors: 0,
  rows_read: 0,
  rows_written: 0,
});
type MunicipalFetchBudget = {
  used: number;
  limit: number;
  activeLimit: number;
  readerUsed: number;
  readerLimit: number;
};

const budgetedFetch = async (
  url: string,
  budget: MunicipalFetchBudget,
) => {
  if (budget.used >= Math.min(budget.limit, budget.activeLimit))
    throw new Error("municipal_fetch_budget_exhausted");
  budget.used += 1;
  return fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.5",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "upgrade-insecure-requests": "1",
    },
  });
};
const retryableOfficialFetchError = (error: unknown) => {
  if (error instanceof TypeError) return true;
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  if (name === "AbortError" || name === "TimeoutError") return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/fetch failed|network|timeout/i.test(message)) return true;
  const http = /^official_http_(\d{3})$/.exec(message);
  return Boolean(http && (Number(http[1]) === 429 || Number(http[1]) >= 500));
};

const municipalFetchUrlCandidates = (rawUrl: string) => {
  let original: URL;
  try {
    original = new URL(rawUrl);
  } catch {
    return [rawUrl];
  }
  const output = [original.toString()];
  const source = SOURCES.find((item) => municipalSourceAllowsUrl(item, rawUrl));
  if (!source) return output;

  const baseHost = original.hostname.replace(/^www\./, "");
  for (const host of source.allowedHosts) {
    if (host === original.hostname || host.replace(/^www\./, "") !== baseHost)
      continue;
    const sibling = new URL(original.toString());
    sibling.hostname = host;
    const value = sibling.toString();
    if (
      value !== output[0] &&
      municipalSourceAllowsUrl(source, value) &&
      !output.includes(value)
    )
      output.push(value);
  }
  return output;
};
const municipalSourceFailureReason = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    message === "source_parse_zero_candidates" ||
    message === "municipal_fetch_budget_exhausted"
  )
    return message;
  const http = /^official_http_(\d{3})$/.exec(message);
  if (http) return `official_http_${http[1]}`;
  if (retryableOfficialFetchError(error)) return "network_or_timeout";
  return "source_error";
};
async function officialResponse(
  url: string,
  budget: MunicipalFetchBudget,
  preferredHosts?: Map<string, string>,
) {
  const candidates = municipalFetchUrlCandidates(url);
  const source = SOURCES.find((item) =>
    municipalSourceAllowsUrl(item, url),
  );
  let family = "";
  try {
    family = new URL(url).hostname.replace(/^www\./, "");
  } catch {}
  const preferredHost = family ? preferredHosts?.get(family) : null;
  const ordered =
    preferredHost && candidates.length > 1
      ? [...candidates].sort((left, right) => {
          const leftPreferred =
            new URL(left).hostname === preferredHost ? 0 : 1;
          const rightPreferred =
            new URL(right).hostname === preferredHost ? 0 : 1;
          return leftPreferred - rightPreferred;
        })
      : candidates;
  const attempts = ordered.length > 1 ? ordered : [url, url];
  let lastError: unknown = null;
  let directBudgetExhausted = false;

  for (let attempt = 0; attempt < attempts.length; attempt += 1) {
    const candidateUrl = attempts[attempt];
    try {
      const response = await budgetedFetch(candidateUrl, budget);
      if (!response.ok) throw new Error(`official_http_${response.status}`);
      const finalUrl = response.url || candidateUrl;
      if (family && preferredHosts)
        preferredHosts.set(family, new URL(finalUrl).hostname);
      return { html: await response.text(), finalUrl };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "municipal_fetch_budget_exhausted" &&
        source &&
        budget.readerUsed < budget.readerLimit
      ) {
        directBudgetExhausted = true;
        break;
      }
      lastError = error;
      if (!retryableOfficialFetchError(error)) throw error;
      if (attempt + 1 < attempts.length) continue;
      break;
    }
  }

  if (
    source &&
    budget.readerUsed < budget.readerLimit &&
    (directBudgetExhausted ||
      (lastError && retryableOfficialFetchError(lastError)))
  ) {
    budget.readerUsed += 1;
    try {
      return await fetchOfficialPageViaReader(url, {
        refererUrl: source.url,
        injectPageScript: buildDetailLinkInjection(
          url,
          source.detailLinkTemplate,
        ),
      });
    } catch {
      // Keep the direct official failure as the operational reason.
    }
  }
  if (directBudgetExhausted)
    throw new Error("municipal_fetch_budget_exhausted");
  throw lastError instanceof Error
    ? lastError
    : new Error("official_fetch_failed");
}
type SourceCandidate = {
  candidate: MunicipalCandidate;
  mode:
    "registered" | "structured_event" | "generic_html" | MunicipalDocumentMode;
  pageHtml: string;
  detailHtml?: string;
};
async function collectSourceCandidates(
  env: Env,
  source: (typeof SOURCES)[number],
  koreaToday: string,
  fetchHtml: (url: string) => Promise<string>,
  fetchResponse: (url: string) => Promise<{ html: string; finalUrl: string }>,
) {
  return fetchMunicipalSourcePages<SourceCandidate>(
    source,
    koreaToday,
    fetchHtml,
    async (pageHtml) => {
      const extraction = extractMunicipalCandidates(source, pageHtml);
      if (extraction.mode === "retry") {
        const documentFallback = await extractMunicipalDocumentCandidates({
          ai: municipalDocumentAI(env),
          source,
          html: pageHtml,
        });
        if (!documentFallback.candidates.length)
          throw new Error(
            `source_${extraction.assessment.status}:${extraction.assessment.reason}:${documentFallback.status}`,
          );
        return documentFallback.candidates.map((item) => ({
          candidate: item.candidate,
          mode: item.mode,
          pageHtml,
        }));
      }
      const extractionMode: "registered" | "structured_event" | "generic_html" =
        extraction.mode;
      const complete = extraction.candidates.map((candidate) => ({
        candidate,
        mode: extractionMode,
        pageHtml,
      }));
      if (
        extractionMode !== "generic_html" ||
        !extraction.partialCandidates?.length
      )
        return complete;
      const followed = await followUpMunicipalListDetails(
        source,
        extraction.partialCandidates,
        koreaToday,
        fetchResponse,
      );
      return [
        ...complete,
        ...followed.candidates.map((item) => ({
          candidate: item.candidate,
          mode: "generic_html" as const,
          pageHtml,
          detailHtml: item.detailHtml,
        })),
      ];
    },
  );
}
async function duplicate(env: Env, candidate: MunicipalCandidate, id: string) {
  if (!candidate.start_date || !candidate.end_date || !candidate.venue)
    return { decision: "REVIEW" as const, rows: 0 };
  const exact = await env.DB.prepare(
    "SELECT id,title,region,start_date,end_date,venue,address FROM events WHERE title=? LIMIT 2",
  )
    .bind(candidate.title)
    .all();
  const nearby = await env.DB.prepare(
    "SELECT id,title,region,start_date,end_date,venue,address FROM events WHERE is_sample=0 AND verification='verified' AND status IN ('scheduled','unknown') AND region=? AND start_date<=? AND end_date>=? AND (venue LIKE ? OR address LIKE ?) LIMIT 26",
  )
    .bind(
      candidate.region,
      candidate.end_date,
      candidate.start_date,
      `%${candidate.locality}%`,
      `%${candidate.locality}%`,
    )
    .all();
  const overflow = nearby.results.length >= 26;
  return {
    decision: overflow
      ? ("REVIEW" as const)
      : decideMunicipalDuplicate(
          {
            id,
            title: candidate.title,
            region: candidate.region,
            start_date: candidate.start_date,
            end_date: candidate.end_date,
            venue: candidate.venue,
            address: candidate.venue,
          },
          exact.results as any[],
          nearby.results as any[],
        ),
    rows: (exact.meta.rows_read ?? 0) + (nearby.meta.rows_read ?? 0),
  };
}
async function state(env: Env, id: string) {
  return env.DB.prepare(
    "SELECT last_payload_hash,decision_state,first_seen_at,last_seen_at,retry_until FROM municipal_candidate_state WHERE candidate_id=?",
  )
    .bind(id)
    .first<{
      last_payload_hash: string;
      decision_state: AutonomousDecision;
      first_seen_at: string;
      last_seen_at: string;
      retry_until: string | null;
    }>();
}
async function saveState(
  env: Env,
  candidate: MunicipalCandidate,
  id: string,
  decision: { state: AutonomousDecision; reason: string },
  payloadHash: string,
  now: string,
  previous: { first_seen_at: string } | null,
) {
  const retry =
    decision.state === "AUTO_RETRY"
      ? new Date(
          new Date(previous?.first_seen_at ?? now).getTime() +
            RETRY_DAYS * 86400_000,
        ).toISOString()
      : null;
  return env.DB.prepare(
    "INSERT INTO municipal_candidate_state(candidate_id,source_key,first_seen_at,last_seen_at,decision_state,decision_reason,retry_until,last_payload_hash,source_candidate_id,title_snapshot,start_date_snapshot,end_date_snapshot,venue_snapshot,locality_snapshot,official_url_snapshot) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(candidate_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,decision_state=excluded.decision_state,decision_reason=excluded.decision_reason,retry_until=excluded.retry_until,last_payload_hash=excluded.last_payload_hash,source_candidate_id=excluded.source_candidate_id,title_snapshot=excluded.title_snapshot,start_date_snapshot=excluded.start_date_snapshot,end_date_snapshot=excluded.end_date_snapshot,venue_snapshot=excluded.venue_snapshot,locality_snapshot=excluded.locality_snapshot,official_url_snapshot=excluded.official_url_snapshot",
  )
    .bind(
      id,
      candidate.source,
      now,
      now,
      decision.state,
      decision.reason,
      retry,
      payloadHash,
      candidate.source_candidate_id,
      candidate.title,
      candidate.start_date,
      candidate.end_date,
      candidate.venue,
      candidate.locality,
      candidate.official_url,
    )
    .run();
}
async function publish(
  env: Env,
  candidate: MunicipalCandidate,
  id: string,
  summaryText: string | null,
  now: string,
  existing: {
    id: string;
    start_date?: string | null;
    end_date?: string | null;
    status?: string | null;
  } | null,
) {
  const description =
    summaryText ?? "공식 지자체 행사 안내를 바탕으로 등록된 행사입니다.";
  const quality = decidePublishQuality({
    title: candidate.title,
    description,
    start_date: candidate.start_date,
    end_date: candidate.end_date,
    venue: candidate.venue,
    address: candidate.venue,
    source_kind: "municipality",
    source_url: candidate.official_url,
  });
  const sid = sourceId(id),
    evidence = `${candidate.title} | ${candidate.start_date}~${candidate.end_date} | ${candidate.venue}`;
  const after = {
    start_date: candidate.start_date,
    end_date: candidate.end_date,
  };
  const alertStatements = !existing
    ? (() => {
        const dedupe = alertDedupeKey("NEW_EVENT", id, after);
        return [
          env.DB.prepare(
            "INSERT OR IGNORE INTO alert_events(id,event_id,alert_type,dedupe_key,created_at,effective_at,before_json,after_json,source_id) VALUES(?,?,?,?,?,?,?,?,?)",
          ).bind(
            alertId(dedupe),
            id,
            "NEW_EVENT",
            dedupe,
            now,
            now,
            null,
            JSON.stringify(after),
            sid,
          ),
        ];
      })()
    : scheduleChanged(existing, after)
      ? (() => {
          const dedupe = alertDedupeKey("SCHEDULE_CHANGED", id, after);
          return [
            env.DB.prepare(
              "INSERT OR IGNORE INTO alert_events(id,event_id,alert_type,dedupe_key,created_at,effective_at,before_json,after_json,source_id) VALUES(?,?,?,?,?,?,?,?,?)",
            ).bind(
              alertId(dedupe),
              id,
              "SCHEDULE_CHANGED",
              dedupe,
              now,
              now,
              JSON.stringify({
                start_date: existing.start_date,
                end_date: existing.end_date,
              }),
              JSON.stringify(after),
              sid,
            ),
          ];
        })()
      : [];
  const statements = [
    env.DB.prepare(
      "INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload) VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,fetched_at=excluded.fetched_at",
    ).bind(
      sid,
      "municipality",
      2,
      `${candidate.source} 공식 행사 안내`,
      candidate.official_url,
      now,
    ),
    env.DB.prepare(
      "INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,lat,lng,cost,price_text,pet_policy,status,verification,is_sample,primary_source_id,checked_at,updated_at,publish_quality_state,publish_quality_reason,publish_quality_rule_version,publish_quality_checked_at) VALUES(?,?,?,?,?,?,?,?,NULL,NULL,'unknown',NULL,'unknown','scheduled','verified',0,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,region=excluded.region,venue=excluded.venue,address=excluded.address,start_date=excluded.start_date,end_date=excluded.end_date,status='scheduled',verification='verified',primary_source_id=excluded.primary_source_id,checked_at=excluded.checked_at,updated_at=excluded.updated_at,publish_quality_state=CASE WHEN events.publish_quality_rule_version IS NULL THEN events.publish_quality_state ELSE excluded.publish_quality_state END,publish_quality_reason=CASE WHEN events.publish_quality_rule_version IS NULL THEN events.publish_quality_reason ELSE excluded.publish_quality_reason END,publish_quality_rule_version=CASE WHEN events.publish_quality_rule_version IS NULL THEN events.publish_quality_rule_version ELSE excluded.publish_quality_rule_version END,publish_quality_checked_at=CASE WHEN events.publish_quality_rule_version IS NULL THEN events.publish_quality_checked_at ELSE excluded.publish_quality_checked_at END",
    ).bind(
      id,
      candidate.title,
      description,
      candidate.region,
      candidate.venue,
      candidate.venue,
      candidate.start_date,
      candidate.end_date,
      sid,
      now,
      now,
      quality.state,
      quality.reason,
      quality.rule_version,
      now,
    ),
    ...alertStatements,
    ...["schedule", "venue", "status"].map((field) =>
      env.DB.prepare(
        "INSERT INTO event_evidence(event_id,source_id,field,excerpt,checked_at) VALUES(?,?,?,?,?) ON CONFLICT(event_id,source_id,field) DO UPDATE SET excerpt=excluded.excerpt,checked_at=excluded.checked_at",
      ).bind(id, sid, field, evidence, now),
    ),
    ...(exactOfficialDetailUrl(candidate)
      ? [
          env.DB.prepare(
            `INSERT INTO event_official_links(event_id,source_id,url,checked_at)
             VALUES(?,?,?,?)
             ON CONFLICT(event_id,source_id) DO UPDATE SET
               url=excluded.url,
               checked_at=excluded.checked_at`,
          ).bind(id, sid, exactOfficialDetailUrl(candidate), now),
        ]
      : []),
  ];
  const result = await env.DB.batch(statements);
  return {
    inserted: existing ? 0 : 1,
    updated: existing ? 1 : 0,
    rows: result.reduce((total, item) => total + (item.meta.changes ?? 0), 0),
  };
}

export async function runMunicipalAutonomous(
  env: Env,
  options: MunicipalAutonomousOptions = {},
) {
  const selectedSourceKeys = new Set(
      options.sourceKeys ?? SOURCES.map((source) => source.key),
    ),
    selectedSources = SOURCES.filter((source) =>
      selectedSourceKeys.has(source.key),
    ),
    maxPublishMutations =
      options.maxPublishMutations ?? DEFAULT_MAX_PUBLISH_MUTATIONS,
    maxRetryCandidates =
      options.maxRetryCandidates ?? DEFAULT_MAX_RETRY_CANDIDATES,
    maxDetailFetches =
      options.maxDetailFetches ?? DEFAULT_MAX_DETAIL_FETCHES,
    fetchBudget: MunicipalFetchBudget = {
      used: 0,
      limit: options.maxExternalFetches ?? DEFAULT_MAX_EXTERNAL_FETCHES,
      activeLimit: options.maxExternalFetches ?? DEFAULT_MAX_EXTERNAL_FETCHES,
      readerUsed: 0,
      readerLimit: 4,
    },
    preferredOfficialHosts = new Map<string, string>(),
    fetchResponse = (url: string) =>
      officialResponse(url, fetchBudget, preferredOfficialHosts),
    fetchHtml = async (url: string) => (await fetchResponse(url)).html,
    summary = emptySummary(),
    source_outcomes: Array<{
      source: string;
      status: "ok" | "error";
      candidates: number;
      reason?: string;
    }> = [],
    now = new Date().toISOString(),
    koreaToday = today(),
    processed = new Set<string>();
  let publishMutations = 0,
    detailFetches = 0,
    identityBridges = 0,
    richDetailAttempted = 0,
    richDetailCandidates = 0,
    richDetailPersisted = 0,
    richDetailErrors = 0;
  const richDetailBySource: Record<string, number> = {};
  const persistRichDetail = async ({
    eventId,
    candidate,
    detail,
  }: {
    eventId: string;
    candidate: MunicipalCandidate;
    detail: MunicipalRichDetail | null;
  }) => {
    if (!detail || richDetailFieldCount(detail) === 0) return;
    try {
      await persistMunicipalRichDetail(env.DB, {
        eventId,
        startDate: candidate.start_date!,
        endDate: candidate.end_date!,
        sourceId: sourceId(eventId),
        sourceName: `${candidate.source} 공식 행사 안내`,
        sourceUrl: candidate.official_url,
        checkedAt: now,
        detail,
      });
      const exactUrl = exactOfficialDetailUrl(candidate);
      if (exactUrl)
        await env.DB.prepare(
          `INSERT INTO event_official_links(event_id,source_id,url,checked_at)
           VALUES(?,?,?,?)
           ON CONFLICT(event_id,source_id) DO UPDATE SET
             url=excluded.url,
             checked_at=excluded.checked_at`,
        )
          .bind(eventId, sourceId(eventId), exactUrl, now)
          .run();
      richDetailPersisted += 1;
      richDetailBySource[candidate.source] =
        (richDetailBySource[candidate.source] ?? 0) + 1;
    } catch (error) {
      richDetailErrors += 1;
      console.error("municipal_rich_detail_failed", {
        source: candidate.source,
        event_id: eventId,
        reason:
          error instanceof Error && error.message
            ? error.message.slice(0, 120)
            : "rich_detail_persist_failed",
      });
    }
  };
  for (let sourceIndex = 0; sourceIndex < selectedSources.length; sourceIndex += 1) {
    const source = selectedSources[sourceIndex];
    fetchBudget.activeLimit = municipalSourceFetchCeiling({
      used: fetchBudget.used,
      hardLimit: fetchBudget.limit,
      remainingSources: selectedSources.length - sourceIndex - 1,
    });
    try {
      const sourceCandidates = await collectSourceCandidates(
        env,
        source,
        koreaToday,
        fetchHtml,
        fetchResponse,
      );
      const candidates = source.pagination
        ? sourceCandidates.slice(0, MAX_PER_SOURCE)
        : selectBoundedMunicipalCandidates(
            sourceCandidates,
            koreaToday,
            MAX_PER_SOURCE,
          );
      if (!candidates.length) throw new Error("source_parse_zero_candidates");
      source_outcomes.push({
        source: source.key,
        status: "ok",
        candidates: candidates.length,
      });
      for (const sourceCandidate of candidates) {
        const {
          candidate,
          mode: candidateMode,
          pageHtml,
          detailHtml,
        } = sourceCandidate;
        summary.discovered += 1;
        const provisionalId = candidateId(
          candidate.source,
          candidate.source_candidate_id,
          candidate.start_date,
        );
        const identity = await resolveImprovedGenericIdentity(
          env,
          source,
          candidate,
          candidateMode,
          provisionalId,
        );
        const id = identity.id;
        summary.rows_read += identity.rows;
        if (identity.bridged) identityBridges += 1;
        processed.add(id);
        const payloadHash = await hash({
          title: candidate.title,
          start_date: candidate.start_date,
          end_date: candidate.end_date,
          venue: candidate.venue,
          official_url: candidate.official_url,
        });
        const previous = await state(env, id);
        const effectiveCandidate =
          candidateMode === "image_vision"
            ? confirmRepeatedImageVisionCandidate(candidate, {
                previousPayloadHash: previous?.last_payload_hash,
                currentPayloadHash: payloadHash,
                previousSeenAt: previous?.last_seen_at,
                currentSeenAt: now,
              })
            : candidate;
        const gate = selectMunicipalGate(effectiveCandidate),
          duplicateResult = await duplicate(env, effectiveCandidate, id);
        summary.rows_read += duplicateResult.rows;
        let detailError = false,
          detailCoreConflict = false,
          richDetail: MunicipalRichDetail | null = null,
          enrichment: ReturnType<typeof createEnrichmentCandidate> | null =
            null;
        if (
          gate.gate === "MAIN" &&
          duplicateResult.decision === "NEW" &&
          !effectiveCandidate.parse_error
        ) {
          if (
            candidateMode === "structured_event" ||
            candidateMode === "pdf_text" ||
            candidateMode === "image_vision"
          ) {
            // Structured data and converted official documents already supplied
            // explicit core facts. Image facts become eligible only after an
            // identical observation on a later Korea calendar day.
            enrichment = {
              summary: effectiveCandidate.snippet,
              operating_hours: null,
              programs: [],
            };
          } else {
            try {
              if (
                !municipalSourceAllowsUrl(
                  source,
                  effectiveCandidate.official_url,
                )
              )
                throw new Error("detail_host_not_allowed");
              const detail =
                detailHtml ??
                (effectiveCandidate.official_url === source.url
                  ? pageHtml
                  : await (async () => {
                      if (detailFetches >= maxDetailFetches)
                        throw new Error(
                          "municipal_detail_fetch_budget_exhausted",
                        );
                      detailFetches += 1;
                      return fetchHtml(effectiveCandidate.official_url);
                    })());
              enrichment = createEnrichmentCandidate(
                effectiveCandidate,
                detail,
              );
              detailError = Boolean(enrichment.parse_error);
              detailCoreConflict =
                effectiveCandidate.official_url !== source.url &&
                hasMunicipalDetailCoreConflict(effectiveCandidate, detail);

              const isSpecificDetail =
                Boolean(detailHtml) ||
                effectiveCandidate.official_url !== source.url;
              if (isSpecificDetail && !detailError && !detailCoreConflict) {
                richDetailAttempted += 1;
                try {
                  richDetail = extractMunicipalRichDetail(
                    effectiveCandidate.official_url,
                    detail,
                  );
                  if (richDetailFieldCount(richDetail) > 0)
                    richDetailCandidates += 1;
                } catch {
                  richDetailErrors += 1;
                  richDetail = null;
                }
              }
            } catch {
              detailError = true;
            }
          }
        }
        const existing = await env.DB.prepare(
          "SELECT id,start_date,end_date,venue,status FROM events WHERE id=? LIMIT 1",
        )
          .bind(id)
          .first<{
            id: string;
            start_date: string;
            end_date: string;
            venue: string;
            status: string;
          }>();
        const changedExisting = Boolean(
          existing &&
          (existing.start_date !== effectiveCandidate.start_date ||
            existing.end_date !== effectiveCandidate.end_date ||
            existing.venue !== effectiveCandidate.venue),
        );
        // A changed core payload needs the same value again on a later
        // Korea calendar day. Same-day manual retries do not confirm it.
        const coreConflict = hasUnconfirmedMunicipalCoreChange({
          changedExisting,
          previousPayloadHash: previous?.last_payload_hash,
          payloadHash,
          previousSeenAt: previous?.last_seen_at,
          currentSeenAt: now,
        });
        const candidateTemporal = temporal(effectiveCandidate, koreaToday);
        const coreValid = Boolean(
          effectiveCandidate.title &&
            effectiveCandidate.start_date &&
            effectiveCandidate.end_date &&
            effectiveCandidate.venue &&
            effectiveCandidate.official_url,
        );
        let decision = decideAutonomousMunicipal({
          gate: gate.gate,
          duplicate: duplicateResult.decision,
          temporal: candidateTemporal,
          trusted: true,
          coreValid,
          parserError: Boolean(effectiveCandidate.parse_error),
          detailError,
          coreConflict: coreConflict || detailCoreConflict,
        });
        const publicationMutation = isMunicipalPublicationMutation({
          existing,
          previousPayloadHash: previous?.last_payload_hash,
          payloadHash,
        });
        if (
          decision.state === "AUTO_PUBLISH" &&
          !municipalPublishSlotAvailable({
            publishMutations,
            isMutation: publicationMutation,
            maxPublish: maxPublishMutations,
          })
        )
          decision = {
            state: "AUTO_RETRY",
            reason: "daily_publish_circuit_breaker",
          };
        summary[decision.state] += 1;
        if (decision.state === "AUTO_PUBLISH") {
          const write = await publish(
            env,
            effectiveCandidate,
            id,
            enrichment?.summary ?? effectiveCandidate.snippet,
            now,
            existing ?? null,
          );
          summary.inserted += write.inserted;
          summary.updated += write.updated;
          summary.rows_written += write.rows;
          if (publicationMutation) publishMutations += 1;
        }

        const safeExistingRichBackfill = Boolean(
          existing &&
            gate.gate === "MAIN" &&
            duplicateResult.decision === "NEW" &&
            candidateTemporal !== "EXPIRED" &&
            coreValid &&
            !effectiveCandidate.parse_error &&
            !detailError &&
            !changedExisting &&
            !coreConflict &&
            !detailCoreConflict,
        );
        if (
          richDetail &&
          (decision.state === "AUTO_PUBLISH" || safeExistingRichBackfill)
        )
          await persistRichDetail({
            eventId: id,
            candidate: effectiveCandidate,
            detail: richDetail,
          });

        const saved = await saveState(
          env,
          effectiveCandidate,
          id,
          decision,
          payloadHash,
          now,
          previous,
        );
        summary.rows_written += saved.meta.changes ?? 0;
      }
    } catch (error) {
      summary.source_errors += 1;
      const reason = municipalSourceFailureReason(error);
      source_outcomes.push({
        source: source.key,
        status: "error",
        candidates: 0,
        reason,
      });
      console.error("municipal_source_failed", {
        source: source.key,
        reason,
      });
    }
  }
  fetchBudget.activeLimit = fetchBudget.limit;
  // Retry candidates are intentionally re-fetched from their minimal core snapshot even when absent from today's listing.
  const retrySourceKeys = selectedSources.map((source) => source.key);
  const retryPlaceholders = retrySourceKeys.map(() => "?").join(",");
  const retries = await env.DB.prepare(
    `SELECT candidate_id,source_key,source_candidate_id,title_snapshot,start_date_snapshot,end_date_snapshot,venue_snapshot,locality_snapshot,official_url_snapshot,first_seen_at,last_seen_at,retry_until,last_payload_hash FROM municipal_candidate_state WHERE decision_state='AUTO_RETRY' AND retry_until IS NOT NULL AND retry_until>=? AND source_key IN (${retryPlaceholders}) ORDER BY retry_until LIMIT ?`,
  )
    .bind(now, ...retrySourceKeys, maxRetryCandidates)
    .all<{
      candidate_id: string;
      source_key: MunicipalCandidate["source"];
      source_candidate_id: string;
      title_snapshot: string;
      start_date_snapshot: string | null;
      end_date_snapshot: string | null;
      venue_snapshot: string | null;
      locality_snapshot: MunicipalCandidate["locality"];
      official_url_snapshot: string;
      first_seen_at: string;
      last_seen_at: string;
      retry_until: string;
      last_payload_hash: string;
    }>();
  summary.rows_read += retries.meta.rows_read ?? 0;
  for (const row of retries.results) {
    if (processed.has(row.candidate_id)) continue;
    try {
      const source = SOURCES.find((item) => item.key === row.source_key);
      if (
        !source ||
        !row.title_snapshot ||
        !row.venue_snapshot ||
        !row.official_url_snapshot
      )
        continue;
      let candidate: MunicipalCandidate = {
        source: row.source_key,
        source_candidate_id: row.source_candidate_id,
        title: row.title_snapshot,
        start_date: row.start_date_snapshot,
        end_date: row.end_date_snapshot,
        venue: row.venue_snapshot,
        locality: row.locality_snapshot || source.locality,
        region: source.region,
        official_url: row.official_url_snapshot,
        category: null,
        snippet: null,
        image_candidate: null,
      };
      let detail: string;
      let detailIsSpecific = false;
      let retryExtractionMode:
        | "registered"
        | "structured_event"
        | "generic_html"
        | MunicipalDocumentMode = "registered";
      const documentSnapshot = row.source_candidate_id.startsWith("doc-");
      if (candidate.official_url === source.url || documentSnapshot) {
        const refreshedCandidates = await collectSourceCandidates(
          env,
          source,
          koreaToday,
          fetchHtml,
          fetchResponse,
        );
        const refreshed = refreshedCandidates.find(
          (item) =>
            item.candidate.source_candidate_id ===
            candidate.source_candidate_id,
        );
        if (refreshed) retryExtractionMode = refreshed.mode;
        // Canonical lists are current authority: an absent identity may never publish from an old snapshot.
        if (!refreshed) {
          summary.AUTO_RETRY += 1;
          continue;
        }
        candidate = refreshed.candidate;
        if (
          retryExtractionMode === "structured_event" ||
          retryExtractionMode === "pdf_text" ||
          retryExtractionMode === "image_vision"
        ) {
          detail = refreshed.detailHtml ?? refreshed.pageHtml;
        } else if (refreshed.detailHtml) {
          detail = refreshed.detailHtml;
          detailIsSpecific = true;
        } else if (candidate.official_url !== source.url) {
          if (!municipalSourceAllowsUrl(source, candidate.official_url))
            throw new Error("detail_host_not_allowed");
          if (detailFetches >= maxDetailFetches)
            throw new Error("municipal_detail_fetch_budget_exhausted");
          detailFetches += 1;
          detail = await fetchHtml(candidate.official_url);
          detailIsSpecific = true;
        } else {
          detail = refreshed.pageHtml;
        }
      } else {
        if (!municipalSourceAllowsUrl(source, candidate.official_url))
          throw new Error("detail_host_not_allowed");
        if (detailFetches >= maxDetailFetches)
          throw new Error("municipal_detail_fetch_budget_exhausted");
        detailFetches += 1;
        detail = await fetchHtml(candidate.official_url);
        detailIsSpecific = true;
      }
      const payloadHash = await hash({
        title: candidate.title,
        start_date: candidate.start_date,
        end_date: candidate.end_date,
        venue: candidate.venue,
        official_url: candidate.official_url,
      });
      const effectiveCandidate =
        retryExtractionMode === "image_vision"
          ? confirmRepeatedImageVisionCandidate(candidate, {
              previousPayloadHash: row.last_payload_hash,
              currentPayloadHash: payloadHash,
              previousSeenAt: row.last_seen_at,
              currentSeenAt: now,
            })
          : candidate;
      const gate = selectMunicipalGate(effectiveCandidate),
        duplicateResult = await duplicate(
          env,
          effectiveCandidate,
          row.candidate_id,
        );
      summary.rows_read += duplicateResult.rows;
      const structuredRetryDetail =
        retryExtractionMode === "structured_event" ||
        retryExtractionMode === "pdf_text" ||
        retryExtractionMode === "image_vision";
      const enrichment = structuredRetryDetail
        ? {
            summary: effectiveCandidate.snippet,
            operating_hours: null,
            programs: [],
          }
        : createEnrichmentCandidate(effectiveCandidate, detail);
      const detailError = Boolean(enrichment.parse_error);
      const detailCoreConflict =
        detailIsSpecific &&
        !structuredRetryDetail &&
        hasMunicipalDetailCoreConflict(effectiveCandidate, detail);
      let richDetail: MunicipalRichDetail | null = null;
      if (
        detailIsSpecific &&
        !structuredRetryDetail &&
        !detailError &&
        !detailCoreConflict
      ) {
        richDetailAttempted += 1;
        try {
          richDetail = extractMunicipalRichDetail(
            effectiveCandidate.official_url,
            detail,
          );
          if (richDetailFieldCount(richDetail) > 0)
            richDetailCandidates += 1;
        } catch {
          richDetailErrors += 1;
          richDetail = null;
        }
      }

      const existing = await env.DB.prepare(
        "SELECT id,start_date,end_date,venue,status FROM events WHERE id=? LIMIT 1",
      )
        .bind(row.candidate_id)
        .first<{
          id: string;
          start_date: string;
          end_date: string;
          venue: string;
          status: string;
        }>();
      const changedExisting = Boolean(
        existing &&
          (existing.start_date !== effectiveCandidate.start_date ||
            existing.end_date !== effectiveCandidate.end_date ||
            existing.venue !== effectiveCandidate.venue),
      );
      const candidateTemporal = temporal(effectiveCandidate, koreaToday);
      const coreValid = Boolean(
        effectiveCandidate.title &&
          effectiveCandidate.start_date &&
          effectiveCandidate.end_date &&
          effectiveCandidate.venue &&
          effectiveCandidate.official_url,
      );
      const retryCoreConflict = hasUnconfirmedMunicipalCoreChange({
        changedExisting,
        previousPayloadHash: row.last_payload_hash,
        payloadHash,
        previousSeenAt: row.last_seen_at,
        currentSeenAt: now,
      });
      let decision = decideAutonomousMunicipal({
        gate: gate.gate,
        duplicate: duplicateResult.decision,
        temporal: candidateTemporal,
        trusted: true,
        coreValid,
        parserError: Boolean(effectiveCandidate.parse_error),
        detailError,
        coreConflict: detailCoreConflict || retryCoreConflict,
      });
      const publicationMutation = isMunicipalPublicationMutation({
        existing,
        previousPayloadHash: row.last_payload_hash,
        payloadHash,
      });
      if (
        decision.state === "AUTO_PUBLISH" &&
        !municipalPublishSlotAvailable({
          publishMutations,
          isMutation: publicationMutation,
          maxPublish: maxPublishMutations,
        })
      )
        decision = {
          state: "AUTO_RETRY",
          reason: "daily_publish_circuit_breaker",
        };
      summary[decision.state] += 1;
      if (decision.state === "AUTO_PUBLISH") {
        const write = await publish(
          env,
          effectiveCandidate,
          row.candidate_id,
          enrichment.summary,
          now,
          existing,
        );
        summary.inserted += write.inserted;
        summary.updated += write.updated;
        summary.rows_written += write.rows;
        if (publicationMutation) publishMutations += 1;
      }

      const safeExistingRichBackfill = Boolean(
        existing &&
          !changedExisting &&
          gate.gate === "MAIN" &&
          duplicateResult.decision === "NEW" &&
          candidateTemporal !== "EXPIRED" &&
          coreValid &&
          !effectiveCandidate.parse_error &&
          !detailError &&
          !detailCoreConflict,
      );
      if (
        richDetail &&
        (decision.state === "AUTO_PUBLISH" || safeExistingRichBackfill)
      )
        await persistRichDetail({
          eventId: row.candidate_id,
          candidate: effectiveCandidate,
          detail: richDetail,
        });

      const saved = await saveState(
        env,
        effectiveCandidate,
        row.candidate_id,
        decision,
        payloadHash,
        now,
        row,
      );
      summary.rows_written += saved.meta.changes ?? 0;
      processed.add(row.candidate_id);
    } catch {
      // Fetch failure is retryable; retain fixed retry_until and last-known-good publication.
      summary.AUTO_RETRY += 1;
    }
  }
  const expiredRetries = await env.DB.prepare(
    "UPDATE municipal_candidate_state SET decision_state='AUTO_EXCLUDE',decision_reason='retry_ttl_expired' WHERE decision_state='AUTO_RETRY' AND retry_until IS NOT NULL AND retry_until<?",
  )
    .bind(now)
    .run();
  summary.rows_written += expiredRetries.meta.changes ?? 0;
  const result = {
    ...summary,
    shard_index: options.shardIndex ?? null,
    source_keys: selectedSources.map((source) => source.key),
    fetch_attempts: fetchBudget.used,
    fetch_budget: fetchBudget.limit,
    source_fetch_window: MUNICIPAL_MAX_FETCHES_PER_SOURCE_WINDOW,
    source_fetch_reserve: MUNICIPAL_MIN_FETCH_RESERVE_PER_SOURCE,
    detail_fetches: detailFetches,
    identity_bridges: identityBridges,
    rich_detail_attempted: richDetailAttempted,
    rich_detail_candidates: richDetailCandidates,
    rich_detail_persisted: richDetailPersisted,
    rich_detail_errors: richDetailErrors,
    rich_detail_by_source: richDetailBySource,
    source_outcomes,
  };
  console.log("municipal_autonomous_summary", result);
  return result;
}
