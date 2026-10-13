import {
  createEnrichmentCandidate,
  extractMunicipalCandidates,
  hasMunicipalDetailCoreConflict,
  selectMunicipalGate,
  type MunicipalCandidate,
} from "../../shared/municipal-discovery";
import {
  municipalSourceAllowsUrl,
  assessMunicipalSourceDocument,
  MUNICIPAL_SOURCE_REGISTRY,
} from "../../shared/municipal-source-registry";
import {
  fetchMunicipalSourcePages,
  mergePaginatedMunicipalCandidates,
  municipalSourcePageUrls,
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
import { enqueueMunicipalDetailJob } from "./municipal-detail-jobs";
import {
  MUNICIPAL_MAX_FETCHES_PER_SOURCE_WINDOW,
  MUNICIPAL_MIN_FETCH_RESERVE_PER_SOURCE,
  municipalSourceFetchCeiling,
} from "../../shared/municipal-fetch-budget";
import { decidePublishQuality } from "../../shared/publish-quality";
import { fetchOfficialPageViaReader } from "../../shared/official-reader-fallback";

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
  /** Scheduled-only whole-shard deadline; omitted for manual/explicit runs. */
  maxDurationMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: MunicipalProgress) => Promise<void> | void;
};

export type MunicipalProgress = {
  shard_index: number | null;
  source_keys: string[];
  current_source: string | null;
  last_started_source: string | null;
  completed_sources: string[];
  failed_sources: string[];
  skipped_due_to_budget: string[];
  municipal_budget_exhausted: boolean;
  elapsed_ms: number;
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
  if (exact)
    return {
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
  readerSucceeded: number;
  readerFailures: number;
  readerFailureReasons: Record<string, number>;
  signal?: AbortSignal;
  assertActive?: () => void;
};

const budgetedFetch = async (url: string, budget: MunicipalFetchBudget) => {
  budget.assertActive?.();
  if (budget.used >= Math.min(budget.limit, budget.activeLimit))
    throw new Error("municipal_fetch_budget_exhausted");
  budget.used += 1;
  const signal = budget.signal
    ? AbortSignal.any([AbortSignal.timeout(20_000), budget.signal])
    : AbortSignal.timeout(20_000);
  return fetch(url, {
    signal,
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
  budget.assertActive?.();
  const candidates = municipalFetchUrlCandidates(url);
  const source = SOURCES.find((item) => municipalSourceAllowsUrl(item, url));
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
    budget.assertActive?.();
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

  const readerEligible = Boolean(
    source &&
    (source.detailLinkTemplate ||
      (() => {
        try {
          return new URL(url).href !== new URL(source.url).href;
        } catch {
          return false;
        }
      })()),
  );
  if (
    source &&
    readerEligible &&
    budget.readerUsed < budget.readerLimit &&
    (directBudgetExhausted ||
      (lastError && retryableOfficialFetchError(lastError)))
  ) {
    // Reader has independent egress from the Worker. Try the same allowed
    // host variants as direct fetches; some municipal sites expose only one
    // of bare/www reliably from a given network.
    for (const readerUrl of ordered) {
      if (budget.readerUsed >= budget.readerLimit) break;
      budget.readerUsed += 1;
      try {
        budget.assertActive?.();
        const readerPage = await fetchOfficialPageViaReader(readerUrl, {
          refererUrl: source.url,
          signal: budget.signal,
        });
        budget.readerSucceeded += 1;
        if (family && preferredHosts)
          preferredHosts.set(family, new URL(readerPage.finalUrl).hostname);
        return readerPage;
      } catch (readerError) {
        budget.readerFailures += 1;
        const reason =
          readerError instanceof Error && readerError.message
            ? readerError.message.slice(0, 120)
            : "official_reader_failed";
        budget.readerFailureReasons[reason] =
          (budget.readerFailureReasons[reason] ?? 0) + 1;
        console.error("municipal_reader_fallback_failed", {
          source: source.key,
          url: readerUrl,
          reason,
        });
      }
    }
    // Keep the direct official failure as the source outcome reason.
  }
  if (directBudgetExhausted)
    throw new Error("municipal_fetch_budget_exhausted");
  throw lastError instanceof Error
    ? lastError
    : new Error("official_fetch_failed");
}
export type MunicipalCandidateMode =
  "registered" | "structured_event" | "generic_html" | MunicipalDocumentMode;
type SourceCandidate = {
  candidate: MunicipalCandidate;
  mode: MunicipalCandidateMode;
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
    rows_written: result.reduce(
      (total, item) =>
        total + (item.meta.rows_written ?? item.meta.changes ?? 0),
      0,
    ),
  };
}

export async function runMunicipalAutonomous(
  env: Env,
  options: MunicipalAutonomousOptions = {},
) {
  const startedMs = Date.now();
  const deadlineMs = options.maxDurationMs
    ? startedMs + options.maxDurationMs
    : null;
  const budgetController = new AbortController();
  const budgetTimer = deadlineMs
    ? setTimeout(() => budgetController.abort(), options.maxDurationMs)
    : null;
  const signal =
    deadlineMs !== null || options.signal
      ? options.signal
        ? AbortSignal.any([budgetController.signal, options.signal])
        : budgetController.signal
      : undefined;
  const budgetExceeded = () => deadlineMs !== null && Date.now() >= deadlineMs;
  const assertActive = () => {
    if (budgetExceeded() || signal?.aborted)
      throw new Error("municipal_wall_clock_budget_exhausted");
  };
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
    maxDetailFetches = options.maxDetailFetches ?? DEFAULT_MAX_DETAIL_FETCHES,
    fetchBudget: MunicipalFetchBudget = {
      used: 0,
      limit: options.maxExternalFetches ?? DEFAULT_MAX_EXTERNAL_FETCHES,
      activeLimit: options.maxExternalFetches ?? DEFAULT_MAX_EXTERNAL_FETCHES,
      readerUsed: 0,
      readerLimit: 4,
      readerSucceeded: 0,
      readerFailures: 0,
      readerFailureReasons: {},
      signal,
      assertActive,
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
  const progress: MunicipalProgress = {
    shard_index: options.shardIndex ?? null,
    source_keys: selectedSources.map((source) => source.key),
    current_source: null,
    last_started_source: null,
    completed_sources: [],
    failed_sources: [],
    skipped_due_to_budget: [],
    municipal_budget_exhausted: false,
    elapsed_ms: 0,
  };
  const reportProgress = async () => {
    progress.elapsed_ms = Date.now() - startedMs;
    await options.onProgress?.({
      ...progress,
      source_keys: [...progress.source_keys],
      completed_sources: [...progress.completed_sources],
      failed_sources: [...progress.failed_sources],
      skipped_due_to_budget: [...progress.skipped_due_to_budget],
    });
  };
  let publishMutations = 0,
    detailFetches = 0,
    identityBridges = 0,
    richDetailAttempted = 0,
    richDetailCandidates = 0,
    richDetailPersisted = 0,
    richDetailErrors = 0;
  const richDetailBySource: Record<string, number> = {};
  const finishBudget = async () => {
    progress.municipal_budget_exhausted = true;
    progress.current_source = null;
    await reportProgress();
    if (budgetTimer) clearTimeout(budgetTimer);
    const result = {
      ...summary,
      ...progress,
      status: "budget_exhausted" as const,
      fetch_attempts: fetchBudget.used,
      fetch_budget: fetchBudget.limit,
      reader_attempts: fetchBudget.readerUsed,
      reader_successes: fetchBudget.readerSucceeded,
      reader_failures: fetchBudget.readerFailures,
      reader_failure_reasons: fetchBudget.readerFailureReasons,
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
  };
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
  for (
    let sourceIndex = 0;
    sourceIndex < selectedSources.length;
    sourceIndex += 1
  ) {
    const source = selectedSources[sourceIndex];
    if (budgetExceeded() || signal?.aborted) {
      progress.municipal_budget_exhausted = true;
      progress.current_source = null;
      progress.skipped_due_to_budget.push(
        ...selectedSources.slice(sourceIndex).map((item) => item.key),
      );
      await reportProgress();
      break;
    }
    progress.current_source = source.key;
    progress.last_started_source = source.key;
    await reportProgress();
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
        assertActive();
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
        assertActive();
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
        assertActive();
        if (
          richDetail &&
          (decision.state === "AUTO_PUBLISH" || safeExistingRichBackfill)
        )
          await persistRichDetail({
            eventId: id,
            candidate: effectiveCandidate,
            detail: richDetail,
          });

        assertActive();
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
      progress.completed_sources.push(source.key);
      progress.current_source = null;
      await reportProgress();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "municipal_wall_clock_budget_exhausted"
      ) {
        progress.municipal_budget_exhausted = true;
        progress.current_source = null;
        progress.skipped_due_to_budget.push(
          ...selectedSources.slice(sourceIndex).map((item) => item.key),
        );
        await reportProgress();
        break;
      }
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
      progress.failed_sources.push(source.key);
      progress.current_source = null;
      await reportProgress();
    }
  }
  if (progress.municipal_budget_exhausted) return finishBudget();
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
    if (budgetExceeded() || signal?.aborted) return finishBudget();
    if (processed.has(row.candidate_id)) continue;
    try {
      assertActive();
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
          if (richDetailFieldCount(richDetail) > 0) richDetailCandidates += 1;
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
      assertActive();
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
      assertActive();
      if (
        richDetail &&
        (decision.state === "AUTO_PUBLISH" || safeExistingRichBackfill)
      )
        await persistRichDetail({
          eventId: row.candidate_id,
          candidate: effectiveCandidate,
          detail: richDetail,
        });

      assertActive();
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
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "municipal_wall_clock_budget_exhausted"
      )
        return finishBudget();
      // Fetch failure is retryable; retain fixed retry_until and last-known-good publication.
      summary.AUTO_RETRY += 1;
    }
  }
  assertActive();
  const expiredRetries = await env.DB.prepare(
    "UPDATE municipal_candidate_state SET decision_state='AUTO_EXCLUDE',decision_reason='retry_ttl_expired' WHERE decision_state='AUTO_RETRY' AND retry_until IS NOT NULL AND retry_until<?",
  )
    .bind(now)
    .run();
  summary.rows_written += expiredRetries.meta.changes ?? 0;
  const result = {
    ...summary,
    fetch_attempts: fetchBudget.used,
    fetch_budget: fetchBudget.limit,
    reader_attempts: fetchBudget.readerUsed,
    reader_successes: fetchBudget.readerSucceeded,
    reader_failures: fetchBudget.readerFailures,
    reader_failure_reasons: fetchBudget.readerFailureReasons,
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
    ...progress,
    status: "success" as const,
  };
  console.log("municipal_autonomous_summary", result);
  if (budgetTimer) clearTimeout(budgetTimer);
  return result;
}

export type MunicipalCandidateOneResult = {
  candidate_id: string;
  decision: AutonomousDecision;
  reason: string;
  inserted: number;
  updated: number;
  rows_read: number;
  rows_written: number;
  detail_required: boolean;
};

const hasDistinctOfficialDetailUrl = (
  source: (typeof SOURCES)[number],
  candidateUrl: string,
) => {
  const list = new URL(source.url);
  const detail = new URL(candidateUrl);
  return (
    list.hostname.replace(/^www\./, "") !==
      detail.hostname.replace(/^www\./, "") ||
    list.pathname !== detail.pathname ||
    list.search !== detail.search
  );
};

/**
 * Process one already-normalized municipal candidate without touching a list
 * or detail network resource. Detail-dependent candidates are checkpointed
 * for the separate detail runner and remain AUTO_RETRY until validated.
 */
export async function runMunicipalCandidateOne(
  env: Env,
  input: {
    candidate: MunicipalCandidate;
    mode: MunicipalCandidateMode;
    now?: string;
    koreaToday?: string;
    publishMutations: number;
    maxPublishMutations: number;
    /** Internal-only: an exact generic-detail checkpoint verified this core. */
    verifiedGenericCore?: boolean;
  },
): Promise<MunicipalCandidateOneResult> {
  const { candidate, mode } = input;
  const source = SOURCES.find((item) => item.key === candidate.source);
  if (!source || !municipalSourceAllowsUrl(source, candidate.official_url))
    throw new Error("municipal_candidate_invalid_source");

  const now = input.now ?? new Date().toISOString();
  const koreaToday = input.koreaToday ?? today();
  let rowsRead = 0;
  let rowsWritten = 0;
  const provisionalId = candidateId(
    candidate.source,
    candidate.source_candidate_id,
    candidate.start_date,
  );
  const identity = await resolveImprovedGenericIdentity(
    env,
    source,
    candidate,
    mode,
    provisionalId,
  );
  const id = identity.id;
  rowsRead += identity.rows;

  const payloadHash = await hash({
    title: candidate.title,
    start_date: candidate.start_date,
    end_date: candidate.end_date,
    venue: candidate.venue,
    official_url: candidate.official_url,
  });
  const previousResult = await env.DB.prepare(
    "SELECT last_payload_hash,decision_state,first_seen_at,last_seen_at,retry_until FROM municipal_candidate_state WHERE candidate_id=?",
  )
    .bind(id)
    .all<{
      last_payload_hash: string;
      decision_state: AutonomousDecision;
      first_seen_at: string;
      last_seen_at: string;
      retry_until: string | null;
    }>();
  rowsRead += previousResult.meta.rows_read ?? 0;
  const previous = previousResult.results[0] ?? null;
  const effectiveCandidate =
    mode === "image_vision"
      ? confirmRepeatedImageVisionCandidate(candidate, {
          previousPayloadHash: previous?.last_payload_hash,
          currentPayloadHash: payloadHash,
          previousSeenAt: previous?.last_seen_at,
          currentSeenAt: now,
        })
      : candidate;
  const gate = selectMunicipalGate(effectiveCandidate);
  const duplicateResult = await duplicate(env, effectiveCandidate, id);
  rowsRead += duplicateResult.rows;

  const existingResult = await env.DB.prepare(
    "SELECT id,start_date,end_date,venue,status FROM events WHERE id=? LIMIT 1",
  )
    .bind(id)
    .all<{
      id: string;
      start_date: string;
      end_date: string;
      venue: string;
      status: string;
    }>();
  rowsRead += existingResult.meta.rows_read ?? 0;
  const existing = existingResult.results[0] ?? null;
  const changedExisting = Boolean(
    existing &&
    (existing.start_date !== effectiveCandidate.start_date ||
      existing.end_date !== effectiveCandidate.end_date ||
      existing.venue !== effectiveCandidate.venue),
  );
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
  const explicitCoreMode =
    mode === "structured_event" ||
    mode === "pdf_text" ||
    mode === "image_vision";
  // Only the Taebaek parser can set this marker, after extracting title,
  // date, and venue from one `schedule_<number>` table. A common calendar
  // URL remains insufficient generic evidence everywhere else.
  const selfContainedGenericCore = Boolean(
    mode === "generic_html" &&
    source.key === "taebaek" &&
    effectiveCandidate.official_url === source.url &&
    effectiveCandidate.self_contained_core_evidence ===
      "taebaek_schedule_block",
  );
  const detailPending = Boolean(
    gate.gate === "MAIN" &&
    duplicateResult.decision === "NEW" &&
    !effectiveCandidate.parse_error &&
    !explicitCoreMode &&
    coreValid &&
    candidateTemporal !== "EXPIRED" &&
    !input.verifiedGenericCore &&
    !selfContainedGenericCore,
  );
  const detailRequired =
    detailPending &&
    hasDistinctOfficialDetailUrl(source, effectiveCandidate.official_url);
  let decision = decideAutonomousMunicipal({
    gate: gate.gate,
    duplicate: duplicateResult.decision,
    temporal: candidateTemporal,
    trusted: true,
    coreValid,
    parserError: Boolean(effectiveCandidate.parse_error),
    detailError: detailPending,
    coreConflict,
  });
  // Generic list candidates may only cross into publication after their
  // retained official-detail checkpoint verified the exact core. Apply the
  // product visibility gate before any source/event/evidence write so HOLD
  // and EXCLUDE never create a hidden pseudo-public record on this path.
  if (
    (input.verifiedGenericCore || selfContainedGenericCore) &&
    decision.state === "AUTO_PUBLISH"
  ) {
    const quality = decidePublishQuality({
      title: effectiveCandidate.title,
      description:
        effectiveCandidate.snippet ??
        "공식 지자체 행사 안내를 바탕으로 등록된 행사입니다.",
      start_date: effectiveCandidate.start_date,
      end_date: effectiveCandidate.end_date,
      venue: effectiveCandidate.venue,
      address: effectiveCandidate.venue,
      source_kind: "municipality",
      source_url: effectiveCandidate.official_url,
      event_official_url: exactOfficialDetailUrl(effectiveCandidate),
    });
    if (quality.state !== "PUBLIC")
      decision = {
        state: quality.state === "EXCLUDE" ? "AUTO_EXCLUDE" : "AUTO_RETRY",
        reason: `publish_quality_${quality.reason}`,
      };
  }
  const publicationMutation = isMunicipalPublicationMutation({
    existing,
    previousPayloadHash: previous?.last_payload_hash,
    payloadHash,
  });
  if (
    decision.state === "AUTO_PUBLISH" &&
    !municipalPublishSlotAvailable({
      publishMutations: input.publishMutations,
      isMutation: publicationMutation,
      maxPublish: input.maxPublishMutations,
    })
  )
    decision = {
      state: "AUTO_RETRY",
      reason: "daily_publish_circuit_breaker",
    };

  // A generic candidate remains AUTO_RETRY until its official detail has
  // explicitly verified its core. The job can retain verification before an
  // event exists and never publishes from this path.
  if (detailRequired)
    await enqueueMunicipalDetailJob(env.DB, {
      sourceKey: candidate.source,
      candidate: effectiveCandidate,
      eventId: id,
    });

  let inserted = 0;
  let updated = 0;
  if (decision.state === "AUTO_PUBLISH") {
    const write = await publish(
      env,
      effectiveCandidate,
      id,
      effectiveCandidate.snippet,
      now,
      existing,
    );
    inserted += write.inserted;
    updated += write.updated;
    rowsWritten += write.rows_written;
  }
  const saved = await saveState(
    env,
    effectiveCandidate,
    id,
    decision,
    payloadHash,
    now,
    previous,
  );
  rowsWritten += saved.meta.rows_written ?? saved.meta.changes ?? 0;

  return {
    candidate_id: id,
    decision: decision.state,
    reason: decision.reason,
    inserted,
    updated,
    rows_read: rowsRead,
    rows_written: rowsWritten,
    detail_required: detailRequired,
  };
}

type VerifiedGenericCheckpointJob = {
  id: string;
  event_id: string;
  candidate_json: string;
  normalized_json: string | null;
  attempt_count: number;
  expires_at: string;
};

type VerifiedGenericCandidateState = {
  candidate_id: string;
  source_key: string;
  decision_state: AutonomousDecision;
  source_candidate_id: string | null;
  title_snapshot: string | null;
  start_date_snapshot: string | null;
  end_date_snapshot: string | null;
  venue_snapshot: string | null;
  official_url_snapshot: string | null;
};

const koreaDayWindow = (at: string) => {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
  const start = new Date(`${day}T00:00:00+09:00`).toISOString();
  return {
    start,
    end: new Date(Date.parse(start) + 86400_000).toISOString(),
  };
};

/**
 * The generic checkpoint has no separate daily-ledger migration. Its durable
 * terminal record is sufficient for new-path publications; event creation is
 * included as a crash-safe conservative fallback for a write that completed
 * before its checkpoint could be terminalized.
 */
const verifiedGenericPublicationMutationsToday = async (
  db: Env["DB"],
  at: string,
) => {
  const { start, end } = koreaDayWindow(at);
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM (
       SELECT event_id FROM municipal_detail_jobs
        WHERE safe_error_category='candidate_registration_public'
          AND updated_at>=? AND updated_at<?
       UNION
       SELECT e.id FROM events e
        JOIN sources s ON s.id=e.primary_source_id
        WHERE e.id LIKE 'municipal-%' AND s.kind='municipality'
          AND e.created_at>=? AND e.created_at<?
     )`,
    )
    .bind(start, end, start, end)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
};

const verifiedGenericRetryAt = (
  job: VerifiedGenericCheckpointJob,
  at: string,
) => {
  const delayMinutes = Math.min(
    24 * 60,
    2 ** Math.min(job.attempt_count + 1, 10),
  );
  return new Date(
    Math.min(
      Date.parse(job.expires_at),
      Date.parse(at) + delayMinutes * 60_000,
    ),
  ).toISOString();
};

/**
 * Promotes exactly one retained, detail-verified generic candidate. The
 * checkpoint itself is leased through available_at; publication is idempotent
 * through the existing event/source/evidence/alert contracts.
 */
export async function runVerifiedGenericMunicipalPublicationOne(
  env: Env,
  at = new Date().toISOString(),
): Promise<{ id: string; stage: string } | null> {
  const job = await env.DB.prepare(
    `SELECT id,event_id,candidate_json,normalized_json,attempt_count,expires_at FROM municipal_detail_jobs
     WHERE stage='DONE' AND safe_error_category IN ('candidate_core_verified','candidate_registration_retry')
       AND available_at<=? AND expires_at>?
     ORDER BY available_at,id LIMIT 1`,
  )
    .bind(at, at)
    .first<VerifiedGenericCheckpointJob>();
  if (!job) return null;

  const leaseUntil = new Date(Date.parse(at) + 60_000).toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE municipal_detail_jobs SET available_at=?,updated_at=?
     WHERE id=? AND stage='DONE' AND safe_error_category IN ('candidate_core_verified','candidate_registration_retry')
       AND available_at<=? AND expires_at>?`,
  )
    .bind(leaseUntil, at, job.id, at, at)
    .run();
  if (!(claimed.meta.changes ?? 0)) return null;

  try {
    const candidate = JSON.parse(job.candidate_json) as MunicipalCandidate;
    const checkpoint = JSON.parse(job.normalized_json ?? "null") as {
      candidate_verification?: {
        status?: string;
        title?: boolean;
        schedule?: boolean;
        venue?: boolean;
      };
      candidate_snapshot?: Pick<
        MunicipalCandidate,
        "title" | "start_date" | "end_date" | "venue" | "official_url"
      >;
    } | null;
    const snapshot = checkpoint?.candidate_snapshot;
    const source = SOURCES.find((item) => item.key === candidate.source);
    const identity = source
      ? await resolveImprovedGenericIdentity(
          env,
          source,
          candidate,
          "generic_html",
          candidateId(
            candidate.source,
            candidate.source_candidate_id,
            candidate.start_date,
          ),
        )
      : null;
    const currentState = identity
      ? await env.DB.prepare(
          `SELECT candidate_id,source_key,decision_state,source_candidate_id,title_snapshot,start_date_snapshot,end_date_snapshot,venue_snapshot,official_url_snapshot
             FROM municipal_candidate_state WHERE candidate_id=?`,
        )
          .bind(identity.id)
          .first<VerifiedGenericCandidateState>()
      : null;
    if (
      checkpoint?.candidate_verification?.status !== "verified" ||
      !checkpoint.candidate_verification.title ||
      !checkpoint.candidate_verification.schedule ||
      !checkpoint.candidate_verification.venue ||
      !snapshot ||
      snapshot.title !== candidate.title ||
      snapshot.start_date !== candidate.start_date ||
      snapshot.end_date !== candidate.end_date ||
      snapshot.venue !== candidate.venue ||
      snapshot.official_url !== candidate.official_url ||
      !source ||
      !municipalSourceAllowsUrl(source, candidate.official_url) ||
      !identity ||
      identity.id !== job.event_id ||
      !currentState ||
      !["AUTO_RETRY", "AUTO_PUBLISH"].includes(currentState.decision_state) ||
      currentState.source_key !== candidate.source ||
      currentState.source_candidate_id !== candidate.source_candidate_id ||
      currentState.title_snapshot !== snapshot.title ||
      currentState.start_date_snapshot !== snapshot.start_date ||
      currentState.end_date_snapshot !== snapshot.end_date ||
      currentState.venue_snapshot !== snapshot.venue ||
      currentState.official_url_snapshot !== snapshot.official_url
    ) {
      await env.DB.prepare(
        "UPDATE municipal_detail_jobs SET safe_error_category='candidate_registration_hold',available_at=?,updated_at=? WHERE id=?",
      )
        .bind(at, at, job.id)
        .run();
      return { id: job.id, stage: "HOLD" };
    }

    const result = await runMunicipalCandidateOne(env, {
      candidate,
      mode: "generic_html",
      now: at,
      koreaToday: today(),
      publishMutations: await verifiedGenericPublicationMutationsToday(
        env.DB,
        at,
      ),
      maxPublishMutations: DEFAULT_MAX_PUBLISH_MUTATIONS,
      verifiedGenericCore: true,
    });
    const category =
      result.decision === "AUTO_PUBLISH"
        ? "candidate_registration_public"
        : result.decision === "AUTO_EXCLUDE"
          ? "candidate_registration_exclude"
          : result.decision === "EXPIRED"
            ? "candidate_registration_expired"
            : "candidate_registration_retry";
    if (result.decision === "AUTO_RETRY") {
      const retryAt = verifiedGenericRetryAt(job, at);
      await env.DB.prepare(
        `UPDATE municipal_detail_jobs
            SET safe_error_category='candidate_registration_retry',available_at=?,retry_at=?,attempt_count=attempt_count+1,updated_at=?
          WHERE id=? AND stage='DONE'`,
      )
        .bind(retryAt, retryAt, at, job.id)
        .run();
    } else
      await env.DB.prepare(
        "UPDATE municipal_detail_jobs SET safe_error_category=?,available_at=?,retry_at=NULL,updated_at=? WHERE id=? AND stage='DONE'",
      )
        .bind(category, at, at, job.id)
        .run();
    return { id: job.id, stage: result.decision };
  } catch {
    // Do not terminalize a checkpoint after an interrupted attempt. Once the
    // short lease expires it is safely retried; existing INSERT OR IGNORE and
    // evidence upserts make a post-write retry harmless.
    await env.DB.prepare(
      "UPDATE municipal_detail_jobs SET available_at=?,updated_at=? WHERE id=? AND stage='DONE' AND safe_error_category='candidate_core_verified'",
    )
      .bind(at, at, job.id)
      .run();
    return { id: job.id, stage: "RETRY" };
  }
}

export const MUNICIPAL_SCAN_CANDIDATE_MAX = 25;
export const MUNICIPAL_SCAN_BATCH_MAX_BYTES = 128 * 1024;
type MunicipalScanStage =
  "LIST_PENDING" | "CANDIDATE_PENDING" | "DONE" | "RETRY";
type MunicipalScanJob = {
  id: string;
  operating_date: string;
  source_key: string;
  page_url: string;
  page_identity: string;
  page_index: number;
  stage: MunicipalScanStage;
  retry_stage: "LIST_PENDING" | "CANDIDATE_PENDING" | null;
  candidate_batch_json: string | null;
  candidate_cursor: number;
  candidate_count: number;
  attempt_count: number;
  source_finalized_at: string | null;
  observed_identities_json: string | null;
  safe_error_category: string | null;
  available_at: string;
  retry_at: string | null;
  expires_at: string;
};
type MunicipalScanDb = Env["DB"];

export function serializeMunicipalScanBatch(
  batch: Array<{ candidate: MunicipalCandidate; mode: MunicipalCandidateMode }>,
) {
  if (batch.length > MUNICIPAL_SCAN_CANDIDATE_MAX)
    throw new Error("candidate_batch_too_large");
  const json = JSON.stringify(batch);
  if (
    new TextEncoder().encode(json).byteLength > MUNICIPAL_SCAN_BATCH_MAX_BYTES
  )
    throw new Error("candidate_batch_too_large");
  return json;
}

/** Idempotently creates a single official list-page checkpoint. */
export async function enqueueMunicipalListPage(
  db: MunicipalScanDb,
  input: {
    operatingDate: string;
    sourceKey: string;
    pageIndex: number;
    now?: string;
  },
) {
  const source = SOURCES.find((item) => item.key === input.sourceKey);
  const urls = source ? municipalSourcePageUrls(source) : null;
  if (
    !source ||
    !urls ||
    !Number.isInteger(input.pageIndex) ||
    !urls[input.pageIndex - 1]
  )
    throw new Error("municipal_scan_invalid_page");
  const pageUrl = urls[input.pageIndex - 1];
  if (!municipalSourceAllowsUrl(source, pageUrl))
    throw new Error("municipal_scan_invalid_url");
  const now = input.now ?? new Date().toISOString();
  const identity = `page:${input.pageIndex}:${new URL(pageUrl).pathname}${new URL(pageUrl).search}`;
  const id = `municipal-scan-${(await hash([input.operatingDate, input.sourceKey, identity])).slice(0, 32)}`;
  await db
    .prepare(
      `INSERT OR IGNORE INTO municipal_scan_jobs
    (id,operating_date,source_key,page_url,page_identity,page_index,stage,retry_stage,candidate_batch_json,candidate_cursor,candidate_count,attempt_count,available_at,created_at,updated_at,expires_at)
    VALUES(?,?,?,?,?,?,'LIST_PENDING',NULL,NULL,0,0,0,?,?,?,?)`,
    )
    .bind(
      id,
      input.operatingDate,
      input.sourceKey,
      pageUrl,
      identity,
      input.pageIndex,
      now,
      now,
      now,
      new Date(Date.parse(now) + 14 * 86400000).toISOString(),
    )
    .run();
  return db
    .prepare("SELECT * FROM municipal_scan_jobs WHERE id=?")
    .bind(id)
    .first<MunicipalScanJob>();
}

/**
 * Seeds one registry source per invocation. The caller owns the cursor so a
 * future daily trigger can stay within the Free Worker execution budget.
 */
export async function seedMunicipalDailyScanOne(
  db: MunicipalScanDb,
  input: { operatingDate: string; sourceCursor: number; now?: string },
) {
  const cursor = Math.max(0, Math.trunc(input.sourceCursor));
  const source = SOURCES[cursor];
  if (!source)
    return {
      stage: "DONE" as const,
      source_key: null,
      next_cursor: null,
      seeded_pages: 0,
    };
  const urls = municipalSourcePageUrls(source);
  if (!urls) throw new Error("municipal_scan_invalid_pagination");
  for (let pageIndex = 1; pageIndex <= urls.length; pageIndex += 1)
    await enqueueMunicipalListPage(db, {
      operatingDate: input.operatingDate,
      sourceKey: source.key,
      pageIndex,
      now: input.now,
    });
  return {
    stage: "DAILY_SCAN_SEED" as const,
    source_key: source.key,
    next_cursor: cursor + 1 < SOURCES.length ? cursor + 1 : null,
    seeded_pages: urls.length,
  };
}

const claimMunicipalScanJob = async (
  db: MunicipalScanDb,
  stage: "LIST_PENDING" | "CANDIDATE_PENDING",
  now: string,
) => {
  const candidateGuard =
    stage === "CANDIDATE_PENDING"
      ? " AND source_finalized_at IS NOT NULL AND page_index=1"
      : "";
  const row = await db
    .prepare(
      `SELECT * FROM municipal_scan_jobs WHERE
    (stage=? OR (stage='RETRY' AND retry_stage=?)) AND available_at<=? AND expires_at>?${candidateGuard} ORDER BY available_at,created_at,id LIMIT 1`,
    )
    .bind(stage, stage, now, now)
    .first<MunicipalScanJob>();
  if (!row) return null;
  const lease = new Date(Date.parse(now) + 120000).toISOString();
  const claimed = await db
    .prepare(
      `UPDATE municipal_scan_jobs SET stage=CASE WHEN stage='RETRY' THEN retry_stage ELSE stage END,retry_stage=NULL,available_at=?,attempt_count=attempt_count+1,updated_at=?
    WHERE id=? AND available_at<=? AND (stage=? OR (stage='RETRY' AND retry_stage=?))${candidateGuard}`,
    )
    .bind(lease, now, row.id, now, stage, stage)
    .run();
  if (!(claimed.meta.changes ?? 0)) return null;
  return {
    ...row,
    stage,
    retry_stage: null,
    available_at: lease,
    attempt_count: row.attempt_count + 1,
  };
};

const retryMunicipalScanJob = async (
  db: MunicipalScanDb,
  row: MunicipalScanJob,
  from: "LIST_PENDING" | "CANDIDATE_PENDING",
  category: string,
  now: string,
) => {
  const delayMinutes = Math.min(24 * 60, 2 ** Math.min(row.attempt_count, 10));
  await db
    .prepare(
      `UPDATE municipal_scan_jobs SET stage='RETRY',retry_stage=?,candidate_batch_json=CASE WHEN ?='LIST_PENDING' THEN NULL ELSE candidate_batch_json END,
    observed_identities_json=CASE WHEN ?='LIST_PENDING' THEN NULL ELSE observed_identities_json END,
    safe_error_category=?,retry_at=?,available_at=?,updated_at=? WHERE id=? AND available_at=?`,
    )
    .bind(
      from,
      from,
      from,
      category.slice(0, 64),
      new Date(Date.parse(now) + delayMinutes * 60000).toISOString(),
      new Date(Date.parse(now) + delayMinutes * 60000).toISOString(),
      now,
      row.id,
      row.available_at,
    )
    .run();
};

/** Fetches and parses one official list page, then stores only bounded normalized candidates. */
export async function runMunicipalListPageOne(
  db: MunicipalScanDb,
  options: {
    now?: string;
    fetchPage?: (url: string) => Promise<{ html: string; finalUrl: string }>;
  } = {},
) {
  const now = options.now ?? new Date().toISOString();
  const job = await claimMunicipalScanJob(db, "LIST_PENDING", now);
  if (!job) return null;
  const source = SOURCES.find((item) => item.key === job.source_key);
  try {
    if (!source || !municipalSourceAllowsUrl(source, job.page_url))
      throw new Error("invalid_source_url");
    const budget: MunicipalFetchBudget = {
      used: 0,
      limit: 3,
      activeLimit: 3,
      readerUsed: 0,
      readerLimit: 0,
      readerSucceeded: 0,
      readerFailures: 0,
      readerFailureReasons: {},
    };
    const fetched = await (
      options.fetchPage ?? ((url) => officialResponse(url, budget))
    )(job.page_url);
    if (!municipalSourceAllowsUrl(source, fetched.finalUrl))
      throw new Error("final_url_not_allowed");
    const health = assessMunicipalSourceDocument(source, fetched.html);
    if (health.status === "unparseable")
      throw new Error("list_health_check_failed");
    const extraction = extractMunicipalCandidates(source, fetched.html);
    if (extraction.mode === "retry")
      throw new Error("list_parse_requires_fallback");
    if (extraction.partialCandidates?.length)
      throw new Error("list_parse_requires_fallback");
    const mode = extraction.mode as MunicipalCandidateMode;
    const pageCandidates = extraction.candidates.map((candidate) => ({
      candidate,
      mode,
    }));
    // Keep only a deterministic per-page frontier. For paginated sources this
    // uses the same ordering and first-observation dedupe as the legacy merge,
    // so no item outside this frontier can enter the final source-wide top 25.
    const batch = source.pagination
      ? mergePaginatedMunicipalCandidates(
          pageCandidates,
          job.operating_date,
        ).slice(0, MUNICIPAL_SCAN_CANDIDATE_MAX)
      : selectBoundedMunicipalCandidates(
          pageCandidates,
          job.operating_date,
          MUNICIPAL_SCAN_CANDIDATE_MAX,
        );
    // An earlier page can contain an identity outside its top-25 frontier.
    // Keep its compact identity set so a later duplicate cannot replace the
    // first-page observation during source finalization.
    const identities = JSON.stringify([
      ...new Set(
        extraction.candidates.map((candidate) => candidate.source_candidate_id),
      ),
    ]);
    if (
      new TextEncoder().encode(identities).byteLength >
      MUNICIPAL_SCAN_BATCH_MAX_BYTES
    )
      throw new Error("candidate_batch_too_large");
    const json = serializeMunicipalScanBatch(batch);
    // Candidate work is released only by source finalization, after every
    // pagination page has been observed.
    const nextStage = "DONE";
    const result = await db
      .prepare(
        `UPDATE municipal_scan_jobs SET stage=?,retry_stage=NULL,candidate_batch_json=?,observed_identities_json=?,candidate_cursor=0,candidate_count=?,safe_error_category=NULL,retry_at=NULL,available_at=?,updated_at=? WHERE id=? AND stage IN ('LIST_PENDING','RETRY') AND available_at=?`,
      )
      .bind(
        nextStage,
        json,
        identities,
        batch.length,
        now,
        now,
        job.id,
        job.available_at,
      )
      .run();
    if (!(result.meta.changes ?? 0)) return null;
    return {
      job_id: job.id,
      stage: nextStage,
      candidate_count: batch.length,
      candidate_batch_bytes: new TextEncoder().encode(json).byteLength,
      raw_html_stored: false,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "list_page_error";
    await retryMunicipalScanJob(
      db,
      job,
      "LIST_PENDING",
      /invalid_source_url|final_url_not_allowed/.test(msg)
        ? "unsafe_url"
        : msg === "candidate_batch_too_large"
          ? msg
          : "list_page_failed",
      now,
    );
    return {
      job_id: job.id,
      stage: "RETRY" as const,
      safe_error_category:
        msg === "candidate_batch_too_large" ? msg : "list_page_failed",
    };
  }
}

/**
 * Finalizes one fully parsed source into the legacy source-wide candidate
 * frontier. The canonical first-page row is the only row released to the
 * candidate worker; all other page payloads are discarded atomically.
 */
export async function runMunicipalSourceFinalizeOne(
  db: MunicipalScanDb,
  options: { now?: string } = {},
) {
  const now = options.now ?? new Date().toISOString();
  const canonical = await db
    .prepare(
      `SELECT * FROM municipal_scan_jobs WHERE page_index=1 AND stage='DONE'
       AND candidate_batch_json IS NOT NULL AND safe_error_category IS NULL
       AND source_finalized_at IS NULL AND available_at<=? AND expires_at>?
       ORDER BY available_at,created_at,id LIMIT 1`,
    )
    .bind(now, now)
    .first<MunicipalScanJob>();
  if (!canonical) return null;
  const source = SOURCES.find((item) => item.key === canonical.source_key);
  const urls = source ? municipalSourcePageUrls(source) : null;
  if (!source || !urls) return null;

  const lease = new Date(Date.parse(now) + 120000).toISOString();
  const claimed = await db
    .prepare(
      `UPDATE municipal_scan_jobs SET available_at=?,updated_at=? WHERE id=?
       AND page_index=1 AND stage='DONE' AND source_finalized_at IS NULL AND available_at<=?`,
    )
    .bind(lease, now, canonical.id, now)
    .run();
  if (!(claimed.meta.changes ?? 0)) return null;

  const pages = await db
    .prepare(
      `SELECT * FROM municipal_scan_jobs WHERE operating_date=? AND source_key=?
       ORDER BY page_index`,
    )
    .bind(canonical.operating_date, canonical.source_key)
    .all<MunicipalScanJob>();
  const rows = pages.results;
  const failedPage = rows.find((row) =>
    row.safe_error_category?.startsWith("terminal_"),
  );
  if (failedPage) {
    const terminal = await db
      .prepare(
        `UPDATE municipal_scan_jobs SET candidate_batch_json=NULL,observed_identities_json=NULL,candidate_count=0,
         safe_error_category='terminal_source_page_expired',updated_at=? WHERE id=? AND stage='DONE'
         AND source_finalized_at IS NULL AND available_at=?`,
      )
      .bind(now, canonical.id, lease)
      .run();
    return (terminal.meta.changes ?? 0) > 0
      ? {
          job_id: canonical.id,
          stage: "SOURCE_SKIPPED" as const,
          source_key: canonical.source_key,
          candidate_count: 0,
        }
      : null;
  }
  const complete =
    rows.length === urls.length &&
    rows.every(
      (row, index) =>
        row.page_index === index + 1 &&
        row.stage === "DONE" &&
        row.candidate_batch_json !== null &&
        row.observed_identities_json !== null &&
        row.expires_at > now,
    );
  if (!complete) {
    await db
      .prepare(
        "UPDATE municipal_scan_jobs SET available_at=?,updated_at=? WHERE id=? AND available_at=?",
      )
      .bind(now, now, canonical.id, lease)
      .run();
    return null;
  }

  try {
    const seen = new Set<string>();
    const all = rows.flatMap((row) => {
      const batch = JSON.parse(row.candidate_batch_json ?? "[]") as Array<{
        candidate: MunicipalCandidate;
        mode: MunicipalCandidateMode;
      }>;
      const identities = JSON.parse(
        row.observed_identities_json ?? "[]",
      ) as string[];
      if (batch.length > MUNICIPAL_SCAN_CANDIDATE_MAX)
        throw new Error("candidate_batch_too_large");
      const frontier = batch.filter(
        (item) => !seen.has(item.candidate.source_candidate_id),
      );
      for (const identity of identities) seen.add(identity);
      return frontier;
    });
    const finalBatch = source.pagination
      ? mergePaginatedMunicipalCandidates(all, canonical.operating_date).slice(
          0,
          MUNICIPAL_SCAN_CANDIDATE_MAX,
        )
      : selectBoundedMunicipalCandidates(
          all,
          canonical.operating_date,
          MUNICIPAL_SCAN_CANDIDATE_MAX,
        );
    const json = serializeMunicipalScanBatch(finalBatch);
    const canonicalStage = finalBatch.length ? "CANDIDATE_PENDING" : "DONE";
    const statements = [
      db
        .prepare(
          `UPDATE municipal_scan_jobs SET stage=?,retry_stage=NULL,candidate_batch_json=?,candidate_cursor=0,candidate_count=?,source_finalized_at=?,available_at=?,updated_at=?
           WHERE id=? AND stage='DONE' AND source_finalized_at IS NULL AND available_at=?`,
        )
        .bind(
          canonicalStage,
          json,
          finalBatch.length,
          now,
          now,
          now,
          canonical.id,
          lease,
        ),
      db
        .prepare(
          `UPDATE municipal_scan_jobs SET candidate_batch_json=NULL,observed_identities_json=NULL,candidate_cursor=0,candidate_count=0,updated_at=?
           WHERE operating_date=? AND source_key=? AND page_index<>1 AND stage='DONE' AND source_finalized_at IS NULL`,
        )
        .bind(now, canonical.operating_date, canonical.source_key),
    ];
    const results = await db.batch(statements);
    if (!((results[0].meta.changes ?? 0) > 0)) return null;
    return {
      job_id: canonical.id,
      stage: "SOURCE_FINALIZED" as const,
      source_key: canonical.source_key,
      candidate_count: finalBatch.length,
    };
  } catch (error) {
    await db
      .prepare(
        "UPDATE municipal_scan_jobs SET available_at=?,updated_at=? WHERE id=? AND available_at=?",
      )
      .bind(now, now, canonical.id, lease)
      .run();
    throw error;
  }
}

/** Processes exactly one checkpoint candidate and advances the cursor only after success. */
export async function runMunicipalCandidateCheckpointOne(
  env: Env,
  options: {
    now?: string;
    koreaToday?: string;
    publishMutations?: number;
    maxPublishMutations?: number;
  } = {},
) {
  const db = env.DB;
  const now = options.now ?? new Date().toISOString();
  const job = await claimMunicipalScanJob(db, "CANDIDATE_PENDING", now);
  if (!job) return null;
  try {
    if (
      !job.candidate_batch_json ||
      new TextEncoder().encode(job.candidate_batch_json).byteLength >
        MUNICIPAL_SCAN_BATCH_MAX_BYTES
    )
      throw new Error("candidate_batch_invalid");
    const batch = JSON.parse(job.candidate_batch_json) as Array<{
      candidate: MunicipalCandidate;
      mode: MunicipalCandidateMode;
    }>;
    if (
      batch.length !== job.candidate_count ||
      job.candidate_cursor >= batch.length
    )
      throw new Error("candidate_cursor_invalid");
    const item = batch[job.candidate_cursor];
    const result = await runMunicipalCandidateOne(env, {
      ...item,
      now,
      koreaToday: options.koreaToday,
      publishMutations: options.publishMutations ?? 0,
      maxPublishMutations: options.maxPublishMutations ?? 10,
    });
    const next = job.candidate_cursor + 1;
    const done = next >= batch.length;
    const transition = await db
      .prepare(
        `UPDATE municipal_scan_jobs SET candidate_cursor=?,stage=?,retry_stage=NULL,available_at=?,updated_at=?,safe_error_category=NULL,retry_at=NULL WHERE id=? AND stage='CANDIDATE_PENDING' AND candidate_cursor=? AND available_at=?`,
      )
      .bind(
        next,
        done ? "DONE" : "CANDIDATE_PENDING",
        now,
        now,
        job.id,
        job.candidate_cursor,
        job.available_at,
      )
      .run();
    if (!(transition.meta.changes ?? 0))
      throw new Error("candidate_checkpoint_transition_conflict");
    return {
      job_id: job.id,
      candidate_cursor_before: job.candidate_cursor,
      candidate_cursor_after: next,
      stage: done ? "DONE" : "CANDIDATE_PENDING",
      ...result,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "candidate_one_failed";
    await retryMunicipalScanJob(
      db,
      job,
      "CANDIDATE_PENDING",
      msg === "candidate_batch_invalid" || msg === "candidate_cursor_invalid"
        ? msg
        : "candidate_one_failed",
      now,
    );
    return {
      job_id: job.id,
      stage: "RETRY" as const,
      safe_error_category:
        msg === "candidate_batch_invalid" || msg === "candidate_cursor_invalid"
          ? msg
          : "candidate_one_failed",
    };
  }
}

export async function cleanupExpiredMunicipalScanJobs(
  db: MunicipalScanDb,
  now = new Date().toISOString(),
) {
  const retainUntil = new Date(Date.parse(now) + 14 * 86400000).toISOString();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE municipal_scan_jobs SET stage='DONE',retry_stage=NULL,candidate_batch_json=NULL,
       observed_identities_json=NULL,candidate_count=0,safe_error_category='terminal_'||COALESCE(safe_error_category,'expired'),
       retry_at=NULL,expires_at=?,updated_at=? WHERE expires_at<=? AND
       (stage<>'DONE' OR (source_finalized_at IS NULL AND candidate_batch_json IS NOT NULL))`,
      )
      .bind(retainUntil, now, now),
    db
      .prepare(
        "DELETE FROM municipal_scan_jobs WHERE stage='DONE' AND expires_at<=?",
      )
      .bind(now),
  ]);
  return {
    meta: {
      changes: results.reduce(
        (count, result) => count + (result.meta.changes ?? 0),
        0,
      ),
    },
  };
}
