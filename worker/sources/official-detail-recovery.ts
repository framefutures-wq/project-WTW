import { koreaDate } from "../../shared/domain";
import {
  createEnrichmentCandidate,
  hasMunicipalDetailCoreConflict,
  type MunicipalCandidate,
} from "../../shared/municipal-discovery";
import {
  extractMunicipalRichDetail,
  municipalRichText,
  type MunicipalRichDetail,
} from "../../shared/municipal-rich-detail";
import {
  MUNICIPAL_SOURCE_REGISTRY,
  municipalSourceAllowsUrl,
  municipalSourceByKey,
} from "../../shared/municipal-source-registry";
import type { Env } from "../env";
import { persistMunicipalRichDetail } from "./municipal-rich-detail";
import { fetchOfficialPageViaReader } from "../../shared/official-reader-fallback";
import { municipalPosterAI } from "../env";
import { transcribeMunicipalPosterImage } from "../../shared/municipal-document-fallback";
import { posterMatchesVerifiedEvent, parseMunicipalPosterRichDetail } from "../../shared/municipal-poster-rich-detail";

export const OFFICIAL_DETAIL_RECOVERY_LIMIT = 12;
export const OFFICIAL_DETAIL_RETRY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const OFFICIAL_DETAIL_SUCCESS_IMAGE_RETRY_MS = 2 * 60 * 1000;
export const OFFICIAL_DETAIL_TRANSIENT_RETRY_MS = 30 * 60 * 1000;
const MAX_HTML_BYTES = 2_000_000;
const MAX_REDIRECTS = 4;

type SourceKind = "municipality" | "organizer";
type RecoveryRow = {
  id: string;
  title: string;
  region: string;
  venue: string;
  start_date: string;
  end_date: string;
  official_url: string;
  link_source_id: string;
  link_source_kind: string;
  primary_source_kind: string;
  source_key: string | null;
  source_rank: number;
  image_missing: number;
};

export type OfficialDetailRecoveryResult = {
  candidates: number;
  attempted: number;
  fetched: number;
  recovered: number;
  images_recovered: number;
  detail_recovered: number;
  title_mismatch: number;
  core_conflict: number;
  insufficient_core_signal: number;
  empty: number;
  fetch_failed: number;
  fetch_failure_reasons: Record<string, number>;
  reader_attempts: number;
  reader_successes: number;
  reader_failures: number;
  reader_failure_reasons: Record<string, number>;
};

type RecoveryPage = { html: string; finalUrl: string };
type RecoveryOptions = {
  limit?: number;
  fetchPage?: (url: string) => Promise<RecoveryPage>;
  targetEventId?: string;
};

const sourceId = (eventId: string) => `official-detail-${eventId}`;

function hostFamily(hostname: string) {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  if (/\.(?:go|or|co|ne|re)\.kr$/.test(host))
    return labels.slice(-3).join(".");
  return labels.slice(-2).join(".");
}

function safeOfficialUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      host === "localhost" ||
      host.startsWith("[") ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
      !host.includes(".")
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

async function readBoundedHtml(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let total = 0;
  let html = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new Error("official_detail_too_large");
    }
    html += decoder.decode(value, { stream: true });
  }
  html += decoder.decode();
  return html;
}

function browserLikeHeaders(refererUrl?: string | null) {
  const headers = new Headers({
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.5",
    "cache-control": "no-cache",
    pragma: "no-cache",
    "upgrade-insecure-requests": "1",
  });
  if (refererUrl) headers.set("referer", refererUrl);
  return headers;
}

async function fetchOfficialDetailPageOnce(
  initial: URL,
  refererUrl?: string | null,
): Promise<RecoveryPage> {
  const family = hostFamily(initial.hostname);
  let current = initial;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetch(current.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: browserLikeHeaders(refererUrl),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || redirect === MAX_REDIRECTS)
        throw new Error("official_detail_redirect_failed");
      const next = safeOfficialUrl(new URL(location, current).toString());
      if (!next || hostFamily(next.hostname) !== family)
        throw new Error("official_detail_cross_host_redirect");
      current = next;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`official_detail_http_${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(contentType)) {
      await response.body?.cancel();
      throw new Error("official_detail_unsupported_content");
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_HTML_BYTES) {
      await response.body?.cancel();
      throw new Error("official_detail_too_large");
    }
    return {
      html: await readBoundedHtml(response),
      finalUrl: current.toString(),
    };
  }
  throw new Error("official_detail_redirect_failed");
}

const retryableFetchFailure = (error: unknown) => {
  if (error instanceof TypeError) return true;
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  if (name === "AbortError" || name === "TimeoutError") return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /official_detail_http_(?:429|5\d\d)$/.test(message);
};

export async function fetchOfficialDetailPage(
  rawUrl: string,
  refererUrl?: string | null,
): Promise<RecoveryPage> {
  const initial = safeOfficialUrl(rawUrl);
  if (!initial) throw new Error("official_detail_invalid_url");
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchOfficialDetailPageOnce(initial, refererUrl);
    } catch (error) {
      lastError = error;
      if (attempt > 0 || !retryableFetchFailure(error)) throw error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("official_detail_fetch_failed");
}

function inferredSourceKind(row: RecoveryRow): SourceKind {
  if (row.link_source_kind === "organizer") return "organizer";
  if (row.link_source_kind === "municipality") return "municipality";
  if (row.primary_source_kind === "organizer") return "organizer";
  if (row.primary_source_kind === "municipality") return "municipality";
  try {
    return new URL(row.official_url).hostname.toLowerCase().endsWith(".go.kr")
      ? "municipality"
      : "organizer";
  } catch {
    return "organizer";
  }
}

function recoveryMunicipalSource(row: RecoveryRow) {
  if (row.source_key) {
    const source = municipalSourceByKey(row.source_key);
    if (source) return source;
  }
  // Older exact official links may predate municipal_candidate_state source
  // provenance. Infer only from the registry allowlist; never from arbitrary
  // hostname guessing.
  return (
    MUNICIPAL_SOURCE_REGISTRY.find((source) =>
      municipalSourceAllowsUrl(source, row.official_url),
    ) ?? null
  );
}

function recoveryReferer(row: RecoveryRow) {
  const source = recoveryMunicipalSource(row);
  if (!source) return null;
  try {
    const detail = new URL(row.official_url);
    const referer = new URL(source.url);
    return hostFamily(detail.hostname) === hostFamily(referer.hostname)
      ? referer.toString()
      : null;
  } catch {
    return null;
  }
}

function recoveryUrlCandidates(row: RecoveryRow) {
  const output = [row.official_url];
  const source = recoveryMunicipalSource(row);
  if (!source) return output;
  try {
    const original = new URL(row.official_url);
    for (const host of source.allowedHosts) {
      if (host === original.hostname) continue;
      const alternate = new URL(original.href);
      alternate.hostname = host;
      if (!municipalSourceAllowsUrl(source, alternate.href)) continue;
      output.push(alternate.href);
    }
  } catch {
    return output;
  }
  return [...new Set(output)];
}

function fetchFailureReason(error: unknown) {
  if (error instanceof TypeError) return "network_error";
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  if (name === "AbortError" || name === "TimeoutError") return "timeout";
  if (error instanceof Error && error.message)
    return error.message.slice(0, 120);
  return "fetch_failed";
}

function normalizedCore(value: string) {
  return value.replace(/[\s()\[\]{}.,·ㆍ:：/\\_-]+/g, "").toLowerCase();
}

function pageHasPositiveCoreSignal(row: RecoveryRow, html: string) {
  const text = municipalRichText(html);
  const normalized = normalizedCore(text);
  const venue = normalizedCore(row.venue);
  if (venue.length >= 2 && normalized.includes(venue)) return true;

  for (const date of [row.start_date, row.end_date]) {
    const [year, month, day] = date.split("-");
    const monthNumber = String(Number(month));
    const dayNumber = String(Number(day));
    const signals = [
      date,
      `${year}.${monthNumber}.${dayNumber}`,
      `${year}. ${monthNumber}. ${dayNumber}`,
      `${year}년 ${monthNumber}월 ${dayNumber}일`,
    ];
    if (signals.some((signal) => text.includes(signal))) return true;
  }
  return false;
}

function fieldCount(detail: MunicipalRichDetail) {
  return (
    Number(Boolean(detail.summary)) +
    Number(detail.operating_hours.length > 0) +
    Number(Boolean(detail.price_text)) +
    Number(Boolean(detail.contact_phone)) +
    Number(detail.images.length > 0) +
    Number(detail.programs.length > 0)
  );
}

const genericProgramLabels = [
  "관람시간",
  "공연시간",
  "운영시간",
  "행사시간",
  "이용시간",
  "일시",
  "기간",
  "대표전화",
  "문의전화",
  "문의",
  "문의처",
  "연락처",
  "전화",
  "장소",
  "관람료",
  "입장료",
  "요금",
  "주최",
  "주최기관",
  "주관",
  "주관기관",
  "후원",
  "협찬",
  "운영기관",
  "오시는길",
  "프로그램",
].map((value) => value.replace(/\s+/g, ""));

function meaningfulHtmlProgram(name: string) {
  const normalized = name
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
  return Boolean(normalized) &&
    !genericProgramLabels.some((label) => normalized.startsWith(label));
}

function meaningfulHtmlSummary(eventTitle: string, summary: string | null) {
  const text = summary?.replace(/\s+/g, " ").trim();
  if (!text) return false;
  const promotional =
    /(?:여러분을?\s*(?:초대|환영)(?:합니다)?|환영합니다|관광의\s*메카|아름다운\s*(?:도시|고장))/u.test(text);
  if (!promotional || text.length > 140) return true;

  const genericTitleTerms = new Set([
    "특별전", "전시", "행사", "축제", "페스티벌", "공연", "콘서트", "체험", "개최",
  ]);
  const summaryTerms = new Set((text.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []));
  const eventSpecificTitleTerms = (eventTitle.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((term) => term.length >= 3 && !/^20\d{2}$/u.test(term) && !genericTitleTerms.has(term));
  return eventSpecificTitleTerms.some((term) => summaryTerms.has(term));
}

export function needsPosterRichDetailFallback(
  eventTitle: string,
  detail: Pick<MunicipalRichDetail, "summary" | "programs"> &
    Partial<
      Pick<
        MunicipalRichDetail,
        "price_text" | "contact_phone" | "operating_hours"
      >
    >,
) {
  if (meaningfulHtmlSummary(eventTitle, detail.summary)) return false;
  const meaningfulProgramCount = detail.programs.filter((program) =>
    meaningfulHtmlProgram(program.name),
  ).length;
  if (meaningfulProgramCount >= 2) return false;
  const hasStructuredFact = Boolean(
    detail.price_text?.trim() ||
      detail.contact_phone?.trim() ||
      (detail.operating_hours?.length ?? 0) > 0,
  );
  return !(meaningfulProgramCount === 1 && hasStructuredFact);
}

async function markAttempt(
  db: D1Database,
  row: RecoveryRow,
  sourceKind: SourceKind,
  checkedAt: string,
  status: string,
) {
  const priority = sourceKind === "organizer" ? 1 : 2;
  await db
    .prepare(
      `INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload)
       VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         kind=excluded.kind,
         priority=excluded.priority,
         name=excluded.name,
         url=excluded.url,
         fetched_at=excluded.fetched_at,
         raw_payload=excluded.raw_payload`,
    )
    .bind(
      sourceId(row.id),
      sourceKind,
      priority,
      sourceKind === "organizer" ? "행사 공식 상세 안내" : "지자체 공식 상세 안내",
      row.official_url,
      checkedAt,
      JSON.stringify({
        official_detail_recovery: {
          status,
          link_source_id: row.link_source_id,
          url: row.official_url,
        },
      }),
    )
    .run();
}

export async function selectOfficialDetailRecoveryCandidates(
  db: D1Database,
  now = new Date(),
  limit = OFFICIAL_DETAIL_RECOVERY_LIMIT,
  targetEventId?: string,
) {
  const today = koreaDate(now);
  const retryBefore = new Date(
    now.getTime() - OFFICIAL_DETAIL_RETRY_TTL_MS,
  ).toISOString();
  const successImageRetryBefore = new Date(
    now.getTime() - OFFICIAL_DETAIL_SUCCESS_IMAGE_RETRY_MS,
  ).toISOString();
  const transientRetryBefore = new Date(
    now.getTime() - OFFICIAL_DETAIL_TRANSIENT_RETRY_MS,
  ).toISOString();
  const rows = await db
    .prepare(
      `WITH official_candidates AS (
         SELECT
           ol.event_id,
           ol.url,
           ol.source_id,
           s.kind AS source_kind,
           s.priority AS source_priority,
           ol.checked_at,
           0 AS source_rank
         FROM event_official_links ol
         JOIN sources s ON s.id=ol.source_id
         WHERE ol.url LIKE 'https://%'
         UNION ALL
         SELECT
           a.event_id,
           CASE
             WHEN l.final_url LIKE 'https://%' THEN l.final_url
             ELSE l.url
           END AS url,
           a.origin_source_id AS source_id,
           s.kind AS source_kind,
           s.priority AS source_priority,
           l.checked_at,
           1 AS source_rank
         FROM official_source_audits a
         JOIN official_source_links l ON l.audit_id=a.id
         JOIN sources s ON s.id=a.origin_source_id
         WHERE l.official=1
           AND l.access_status='ok'
           AND (l.final_url LIKE 'https://%' OR l.url LIKE 'https://%')
         UNION ALL
         SELECT
           mcs.candidate_id AS event_id,
           mcs.official_url_snapshot AS url,
           e.primary_source_id AS source_id,
           ps.kind AS source_kind,
           ps.priority AS source_priority,
           mcs.last_seen_at AS checked_at,
           2 AS source_rank
         FROM municipal_candidate_state mcs
         JOIN events e ON e.id=mcs.candidate_id
         JOIN sources ps ON ps.id=e.primary_source_id
         WHERE mcs.official_url_snapshot LIKE 'https://%'
         UNION ALL
         SELECT
           e.id AS event_id,
           ps.url,
           ps.id AS source_id,
           ps.kind AS source_kind,
           ps.priority AS source_priority,
           ps.fetched_at AS checked_at,
           3 AS source_rank
         FROM events e
         JOIN sources ps ON ps.id=e.primary_source_id
         WHERE ps.kind IN ('municipality','organizer')
           AND ps.url LIKE 'https://%'
       ),
       ranked AS (
         SELECT *,
           ROW_NUMBER() OVER (
             PARTITION BY event_id
             ORDER BY source_rank,source_priority,checked_at DESC
           ) AS rn
         FROM official_candidates
       )
       SELECT
         e.id,e.title,e.region,e.venue,e.start_date,e.end_date,
         r.url AS official_url,
         r.source_id AS link_source_id,
         r.source_kind AS link_source_kind,
         ps.kind AS primary_source_kind,
         mcs.source_key,
         r.source_rank,
         CASE
           WHEN ei.event_id IS NULL OR ei.image_url IS NULL OR ei.image_status!='ok'
           THEN 1 ELSE 0
         END AS image_missing
       FROM events e
       JOIN ranked r ON r.event_id=e.id AND r.rn<=4
       JOIN sources ps ON ps.id=e.primary_source_id
       LEFT JOIN event_images ei ON ei.event_id=e.id AND ei.is_primary=1
       LEFT JOIN municipal_candidate_state mcs ON mcs.candidate_id=e.id
       LEFT JOIN sources attempt ON attempt.id='official-detail-' || e.id
       LEFT JOIN sources poster_state ON poster_state.id='official-poster-' || e.id
       WHERE e.is_sample=0
         AND (? IS NULL OR e.id=?)
         AND e.verification='verified'
         AND e.publish_quality_state='PUBLIC'
         AND e.end_date>=?
         AND (
           ? IS NOT NULL
           OR
           ei.event_id IS NULL OR ei.image_url IS NULL OR ei.image_status!='ok'
           OR NOT EXISTS (
             SELECT 1 FROM event_enrichments en WHERE en.event_id=e.id
           )
           OR NOT EXISTS (
             SELECT 1 FROM event_operating_hours oh WHERE oh.event_id=e.id
           )
           OR (
             ei.image_status='ok'
             AND NOT EXISTS (SELECT 1 FROM event_programs p WHERE p.event_id=e.id)
             AND (poster_state.id IS NULL OR (
               poster_state.raw_payload LIKE '%"status":"failed"%'
               AND poster_state.fetched_at<?
             ))
           )
         )
         AND (
           ? IS NOT NULL
           OR
           attempt.id IS NULL
           OR attempt.fetched_at<?
           OR (
             (ei.event_id IS NULL OR ei.image_url IS NULL OR ei.image_status!='ok')
             AND attempt.raw_payload LIKE '%"municipal_rich_detail"%'
             AND attempt.fetched_at<?
           )
           OR (
             attempt.fetched_at<?
             AND (
               attempt.raw_payload LIKE '%"status":"network_error"%'
               OR attempt.raw_payload LIKE '%"status":"timeout"%'
               OR attempt.raw_payload LIKE '%"status":"fetch failed"%'
               OR attempt.raw_payload LIKE '%official_detail_http_429%'
               OR attempt.raw_payload LIKE '%official_detail_http_5%'
             )
           )
         )
       ORDER BY image_missing DESC,r.source_rank,e.start_date,e.id,r.rn
       LIMIT ?`,
    )
    .bind(
      targetEventId ?? null,
      targetEventId ?? null,
      today,
      targetEventId ?? null,
      new Date(now.getTime() - POSTER_FAILURE_RETRY_MS).toISOString(),
      targetEventId ?? null,
      retryBefore,
      successImageRetryBefore,
      transientRetryBefore,
      Math.max(8, Math.min(240, limit * 8)),
    )
    .all<RecoveryRow>();

  const accepted = rows.results.filter((row) => {
    if (row.source_rank < 2) return true;
    if (row.link_source_kind === "organizer") return true;
    if (!row.source_key) return false;
    const source = municipalSourceByKey(row.source_key);
    if (!source || !municipalSourceAllowsUrl(source, row.official_url))
      return false;
    try {
      return new URL(row.official_url).href !== new URL(source.url).href;
    } catch {
      return false;
    }
  });
  const unique = new Map<string, RecoveryRow>();
  for (const row of accepted)
    if (!unique.has(row.id)) unique.set(row.id, row);
  return [...unique.values()].slice(0, Math.max(1, Math.min(40, limit)));
}

const POSTER_PARSER_VERSION = 5;
const POSTER_FAILURE_RETRY_MS = 24 * 60 * 60 * 1000;

type PosterOCRState = {
  latest_attempt?: {
    status: string;
    attempted_at: string;
    parser_version: number;
    error?: string;
  };
  last_success?: {
    poster_url: string;
    poster_hash?: string;
    transcription: string;
    succeeded_at: string;
  };
};

function readPosterOCRState(rawPayload: string | null, fetchedAt: string): PosterOCRState {
  if (!rawPayload) return {};
  try {
    const value = JSON.parse(rawPayload) as Record<string, unknown>;
    const state: PosterOCRState = {};
    const latest = value.latest_attempt;
    if (latest && typeof latest === "object") {
      const attempt = latest as Record<string, unknown>;
      if (typeof attempt.status === "string" && typeof attempt.attempted_at === "string")
        state.latest_attempt = {
          status: attempt.status,
          attempted_at: attempt.attempted_at,
          parser_version: typeof attempt.parser_version === "number" ? attempt.parser_version : POSTER_PARSER_VERSION,
          ...(typeof attempt.error === "string" ? { error: attempt.error } : {}),
        };
    }
    const success = value.last_success;
    if (success && typeof success === "object") {
      const item = success as Record<string, unknown>;
      if (typeof item.poster_url === "string" && typeof item.transcription === "string" && typeof item.succeeded_at === "string")
        state.last_success = {
          poster_url: item.poster_url,
          ...(typeof item.poster_hash === "string" ? { poster_hash: item.poster_hash } : {}),
          transcription: item.transcription,
          succeeded_at: item.succeeded_at,
        };
    }
    // Older deployments kept the last successful OCR at the payload root.
    if (!state.last_success && value.status === "success" &&
      typeof value.poster_url === "string" && typeof value.converted_text === "string" && value.converted_text.trim()) {
      state.last_success = {
        poster_url: value.poster_url,
        transcription: value.converted_text,
        succeeded_at: fetchedAt,
      };
    }
    if (!state.latest_attempt && typeof value.status === "string")
      state.latest_attempt = {
        status: value.status,
        attempted_at: fetchedAt,
        parser_version: typeof value.version === "number" ? value.version : POSTER_PARSER_VERSION,
        ...(typeof value.error === "string" ? { error: value.error } : {}),
      };
    return state;
  } catch {
    return {};
  }
}

async function writePosterOCRState(
  db: D1Database,
  row: RecoveryRow,
  attemptedAt: string,
  posterUrl: string,
  status: string,
  options: { transcription?: string; posterHash?: string; error?: string } = {},
) {
  const id = `official-poster-${row.id}`;
  const previous = await db.prepare("SELECT raw_payload,fetched_at FROM sources WHERE id=?")
    .bind(id).first<{ raw_payload: string | null; fetched_at: string }>();
  const state = readPosterOCRState(previous?.raw_payload ?? null, previous?.fetched_at ?? attemptedAt);
  if (status === "success" && options.transcription) {
    state.last_success = {
      poster_url: posterUrl,
      ...(options.posterHash ? { poster_hash: options.posterHash } : {}),
      transcription: options.transcription,
      succeeded_at: attemptedAt,
    };
  }
  state.latest_attempt = {
    status,
    attempted_at: attemptedAt,
    parser_version: POSTER_PARSER_VERSION,
    ...(options.error ? { error: options.error.slice(0, 180) } : {}),
  };
  // Root fields retain compatibility with existing candidate selection and
  // older readers; successful OCR remains available under last_success.
  const payload = {
    poster_url: posterUrl,
    version: POSTER_PARSER_VERSION,
    status,
    ...(status === "success" && options.transcription ? { converted_text: options.transcription } : {}),
    ...(options.error ? { error: options.error.slice(0, 180) } : {}),
    ...state,
  };
  await db.prepare(
    `INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload)
     VALUES(?, 'municipality', 2, '공식 포스터 판독 상태', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at,raw_payload=excluded.raw_payload,url=excluded.url`,
  ).bind(id, row.official_url, attemptedAt, JSON.stringify(payload)).run();
}

async function enrichFromVerifiedPoster(
  env: Env,
  row: RecoveryRow,
  checkedAt: string,
  options: { bypassFailureRetry?: boolean } = {},
): Promise<{ detail: MunicipalRichDetail; posterUrl: string; text: string; posterHash: string; cached: boolean } | null> {
  const ai = municipalPosterAI(env);
  if (!ai || row.link_source_kind !== "municipality") return null;
  const poster = await env.DB.prepare(
    `SELECT image_url,source_page_url FROM event_images
     WHERE event_id=? AND is_primary=1 AND image_status='ok'
       AND source_type='municipality' LIMIT 1`,
  ).bind(row.id).first<{ image_url: string; source_page_url: string | null }>();
  if (!poster?.image_url || !poster.source_page_url) return null;
  try {
    const detail = new URL(row.official_url);
    const page = new URL(poster.source_page_url);
    const image = new URL(poster.image_url);
    if (
      detail.protocol !== "https:" || image.protocol !== "https:" ||
      hostFamily(detail.hostname) !== hostFamily(page.hostname) ||
      detail.pathname !== page.pathname || detail.search !== page.search ||
      hostFamily(detail.hostname) !== hostFamily(image.hostname)
    ) return null;
  } catch { return null; }

  const stateId = `official-poster-${row.id}`;
  const previous = await env.DB.prepare(
    "SELECT raw_payload,fetched_at FROM sources WHERE id=?",
  ).bind(stateId).first<{ raw_payload: string | null; fetched_at: string }>();
  let posterBytes: Uint8Array | null = null;
  let posterHashChanged = false;
  if (previous?.raw_payload) {
    try {
      const payload = JSON.parse(previous.raw_payload) as { poster_url?: string; version?: number; status?: string; last_success?: { poster_url?: string; poster_hash?: string; transcription?: string } };
      const success = payload.last_success;
      if (success?.poster_hash && success.transcription?.trim()) {
        posterBytes = await fetchPosterBytes(poster.image_url, poster.source_page_url);
        const hash = await sha256Hex(posterBytes);
        posterHashChanged = hash !== success.poster_hash;
        if (hash === success.poster_hash && posterMatchesVerifiedEvent(success.transcription, row)) {
          const detail = parseMunicipalPosterRichDetail(success.transcription);
          if (detail.summary || detail.operating_hours.length || detail.programs.length || detail.price_text || detail.contact_phone)
            return { detail, posterUrl: poster.image_url, text: success.transcription, posterHash: hash, cached: true };
        }
      }
      if (!posterHashChanged && payload.poster_url === poster.image_url && payload.version === POSTER_PARSER_VERSION) {
        if (payload.status === "empty" || payload.status === "core_mismatch")
          return null;
        if (!options.bypassFailureRetry && payload.status !== "success" && new Date(checkedAt).getTime() - new Date(previous.fetched_at).getTime() < POSTER_FAILURE_RETRY_MS)
          return null;
      }
    } catch {}
  }
  const record = (status: string, text?: string, error?: string) =>
    writePosterOCRState(env.DB, row, checkedAt, poster.image_url, status, {
      ...(text ? { transcription: text } : {}),
      ...(error ? { error } : {}),
    });
  try {
    const image = new URL(poster.image_url);
    const extension = image.searchParams.get("ext")?.toLowerCase() || image.pathname.split(".").pop()?.toLowerCase();
    const mimeType = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
    const imageBytes = posterBytes ?? await fetchPosterBytes(poster.image_url, poster.source_page_url);
    const posterHash = await sha256Hex(imageBytes);
    const text = await transcribeMunicipalPosterImage({
      ai,
      attachment: {
        url: poster.image_url,
        name: `official-poster.${extension === "png" || extension === "webp" ? extension : "jpg"}`,
        kind: "image",
        mimeType,
      },
      // Read the same verified official bytes with the source-page Referer.
      fetcher: ((url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url) === poster.image_url)
          return Promise.resolve(new Response(imageBytes.slice().buffer as ArrayBuffer, { status: 200, headers: { "content-type": mimeType } }));
        const headers = new Headers(init?.headers);
        headers.set("Referer", poster.source_page_url!);
        headers.set("Accept-Language", "ko-KR,ko;q=0.9,en-US;q=0.7");
        headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36");
        return fetch(url, { ...init, headers, redirect: "follow" });
      }) as typeof fetch,
    });
    if (!text) { await record("empty"); return null; }
    if (!posterMatchesVerifiedEvent(text, row)) {
      await record("core_mismatch", text);
      return null;
    }
    const detail = parseMunicipalPosterRichDetail(text);
    if (!detail.summary && !detail.operating_hours.length && !detail.programs.length && !detail.price_text && !detail.contact_phone) {
      await record("empty", text);
      return null;
    }
    return { detail, posterUrl: poster.image_url, text, posterHash, cached: false };
  } catch (error) {
    await record("failed", undefined, error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function fetchPosterBytes(url: string, referer: string) {
  const headers = new Headers({ Referer: referer, "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.7", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36" });
  const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`poster_http_${response.status}`);
  if (Number(response.headers.get("content-length") ?? 0) > 5 * 1024 * 1024) throw new Error("poster_too_large");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 5 * 1024 * 1024) throw new Error("poster_too_large");
  return bytes;
}

async function sha256Hex(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer)))
    .map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function markPosterSuccess(db: D1Database, row: RecoveryRow, checkedAt: string, posterUrl: string, text: string, posterHash: string) {
  await writePosterOCRState(db, row, checkedAt, posterUrl, "success", { transcription: text, posterHash });
}

export async function runOfficialDetailRecovery(
  env: Env,
  now = new Date(),
  options: RecoveryOptions = {},
): Promise<OfficialDetailRecoveryResult> {
  const rows = await selectOfficialDetailRecoveryCandidates(
    env.DB,
    now,
    options.limit ?? OFFICIAL_DETAIL_RECOVERY_LIMIT,
    options.targetEventId,
  );
  const result: OfficialDetailRecoveryResult = {
    candidates: rows.length,
    attempted: 0,
    fetched: 0,
    recovered: 0,
    images_recovered: 0,
    detail_recovered: 0,
    title_mismatch: 0,
    core_conflict: 0,
    insufficient_core_signal: 0,
    empty: 0,
    fetch_failed: 0,
    fetch_failure_reasons: {},
    reader_attempts: 0,
    reader_successes: 0,
    reader_failures: 0,
    reader_failure_reasons: {},
  };
  const fetchPage = options.fetchPage ?? fetchOfficialDetailPage;
  const checkedAt = now.toISOString();
  let readerFallbacks = 0;
  let posterConversions = 0;

  for (const row of rows) {
    result.attempted += 1;
    const sourceKind = inferredSourceKind(row);
    let page: RecoveryPage | null = null;
    let lastFetchError: unknown = null;
    const refererUrl = recoveryReferer(row);
    for (const candidateUrl of recoveryUrlCandidates(row)) {
      try {
        page = options.fetchPage
          ? await fetchPage(candidateUrl)
          : await fetchOfficialDetailPage(candidateUrl, refererUrl);
        break;
      } catch (error) {
        lastFetchError = error;
      }
    }
    if (
      !page &&
      lastFetchError &&
      retryableFetchFailure(lastFetchError) &&
      readerFallbacks < 4
    ) {
      for (const readerUrl of recoveryUrlCandidates(row)) {
        if (readerFallbacks >= 4) break;
        readerFallbacks += 1;
        result.reader_attempts += 1;
        try {
          page = await fetchOfficialPageViaReader(readerUrl, {
            refererUrl,
          });
          result.reader_successes += 1;
          break;
        } catch (readerError) {
          result.reader_failures += 1;
          const reason =
            readerError instanceof Error && readerError.message
              ? readerError.message.slice(0, 120)
              : "official_reader_failed";
          result.reader_failure_reasons[reason] =
            (result.reader_failure_reasons[reason] ?? 0) + 1;
        }
      }
      // Preserve the direct official failure reason if all transport fallbacks fail.
    }
    if (!page) {
      if (posterConversions < 1) {
        posterConversions += 1;
        const poster = await enrichFromVerifiedPoster(env, row, checkedAt, {
          bypassFailureRetry: Boolean(options.targetEventId),
        });
        if (poster) {
          await persistMunicipalRichDetail(env.DB, {
            eventId: row.id, startDate: row.start_date, endDate: row.end_date,
            sourceId: sourceId(row.id), sourceName: "지자체 공식 상세 안내",
            sourceUrl: row.official_url, checkedAt, detail: poster.detail,
            sourceKind: "municipality", posterUrl: poster.posterUrl,
          });
          if (!poster.cached) await markPosterSuccess(env.DB, row, checkedAt, poster.posterUrl, poster.text, poster.posterHash);
          result.recovered += 1;
          result.detail_recovered += 1;
          continue;
        }
      }
      result.fetch_failed += 1;
      const reason = fetchFailureReason(lastFetchError);
      result.fetch_failure_reasons[reason] =
        (result.fetch_failure_reasons[reason] ?? 0) + 1;
      await markAttempt(env.DB, row, sourceKind, checkedAt, reason);
      continue;
    }
    result.fetched += 1;

    const candidate: MunicipalCandidate = {
      source: "official-detail-recovery",
      source_candidate_id: row.id,
      title: row.title,
      start_date: row.start_date,
      end_date: row.end_date,
      region: row.region,
      locality: row.region,
      venue: row.venue,
      official_url: page.finalUrl,
      category: null,
      snippet: null,
      image_candidate: null,
    };
    const validation = createEnrichmentCandidate(candidate, page.html);
    if (validation.parse_error) {
      result.title_mismatch += 1;
      await markAttempt(env.DB, row, sourceKind, checkedAt, validation.parse_error);
      continue;
    }
    if (hasMunicipalDetailCoreConflict(candidate, page.html)) {
      result.core_conflict += 1;
      await markAttempt(env.DB, row, sourceKind, checkedAt, "core_conflict");
      continue;
    }
    if (!pageHasPositiveCoreSignal(row, page.html)) {
      result.insufficient_core_signal += 1;
      await markAttempt(
        env.DB,
        row,
        sourceKind,
        checkedAt,
        "insufficient_core_signal",
      );
      continue;
    }

    let detail: MunicipalRichDetail;
    try {
      detail = extractMunicipalRichDetail(page.finalUrl, page.html);
    } catch {
      result.empty += 1;
      await markAttempt(env.DB, row, sourceKind, checkedAt, "extract_failed");
      continue;
    }
    if (!meaningfulHtmlSummary(row.title, detail.summary))
      detail = { ...detail, summary: null };
    let convertedPosterUrl: string | null = null;
    let convertedPosterText: string | null = null;
    let convertedPosterHash: string | null = null;
    let posterWasCached = false;
    // An event-wide time or contact alone does not provide the poster's actual
    // program content. Keep those HTML facts while reading the verified poster.
    if (needsPosterRichDetailFallback(row.title, detail) && posterConversions < 1) {
      posterConversions += 1;
      const poster = await enrichFromVerifiedPoster(env, row, checkedAt, {
        bypassFailureRetry: Boolean(options.targetEventId),
      });
      if (poster) {
        convertedPosterUrl = poster.posterUrl;
        convertedPosterText = poster.text;
        convertedPosterHash = poster.posterHash;
        posterWasCached = poster.cached;
        const usefulHtmlSummary = meaningfulHtmlSummary(row.title, detail.summary)
          ? detail.summary
          : null;
        const usefulHtmlPrograms = detail.programs.filter((program) =>
          meaningfulHtmlProgram(program.name),
        );
        detail = {
          ...detail,
          summary: poster.detail.summary ?? usefulHtmlSummary,
          operating_hours: detail.operating_hours.length
            ? detail.operating_hours : poster.detail.operating_hours,
          programs: poster.detail.programs.length
            ? poster.detail.programs
            : usefulHtmlPrograms,
          price_text: detail.price_text ?? poster.detail.price_text,
          contact_phone: detail.contact_phone ?? poster.detail.contact_phone,
        };
      }
    }
    if (!meaningfulHtmlSummary(row.title, detail.summary))
      detail = { ...detail, summary: null };
    if (!meaningfulHtmlSummary(row.title, detail.summary)) {
      const oldSummaries = await env.DB.prepare(
        `SELECT en.source_id,en.summary,s.priority
         FROM event_enrichments en JOIN sources s ON s.id=en.source_id
         WHERE en.event_id=?`,
      ).bind(row.id).all<{ source_id: string; summary: string; priority: number }>();
      const incomingPriority = sourceKind === "organizer" ? 1 : 2;
      for (const oldSummary of oldSummaries.results)
        if (
          oldSummary.priority >= incomingPriority &&
          !meaningfulHtmlSummary(row.title, oldSummary.summary)
        )
          await env.DB.prepare(
            "DELETE FROM event_enrichments WHERE event_id=? AND source_id=?",
          )
            .bind(row.id, oldSummary.source_id)
            .run();
    }
    if (fieldCount(detail) === 0) {
      result.empty += 1;
      await markAttempt(env.DB, row, sourceKind, checkedAt, "empty");
      continue;
    }
    if (convertedPosterUrl && !detail.programs.length) {
      const oldPrograms = await env.DB.prepare(
        `SELECT p.id,p.program_name
         FROM event_programs p JOIN sources s ON s.id=p.source_id
         WHERE p.event_id=? AND s.priority>=?`,
      ).bind(row.id, sourceKind === "organizer" ? 1 : 2)
        .all<{ id: string; program_name: string }>();
      for (const program of oldPrograms.results)
        if (!meaningfulHtmlProgram(program.program_name))
          await env.DB.prepare("DELETE FROM event_programs WHERE id=?")
            .bind(program.id).run();
    }

    const persisted = await persistMunicipalRichDetail(env.DB, {
      eventId: row.id,
      startDate: row.start_date,
      endDate: row.end_date,
      sourceId: sourceId(row.id),
      sourceName:
        sourceKind === "organizer"
          ? "행사 공식 상세 안내"
          : "지자체 공식 상세 안내",
      sourceUrl: page.finalUrl,
      checkedAt,
      detail,
      sourceKind,
      ...(convertedPosterUrl ? { posterUrl: convertedPosterUrl } : {}),
    });
    if (convertedPosterUrl && convertedPosterText && convertedPosterHash && !posterWasCached)
      await markPosterSuccess(env.DB, row, checkedAt, convertedPosterUrl, convertedPosterText, convertedPosterHash);
    await env.DB.prepare(
      `INSERT INTO event_official_links(event_id,source_id,url,checked_at)
       VALUES(?,?,?,?)
       ON CONFLICT(event_id,source_id) DO UPDATE SET
         url=excluded.url,
         checked_at=excluded.checked_at`,
    )
      .bind(row.id, row.link_source_id, page.finalUrl, checkedAt)
      .run();
    result.recovered += 1;
    if (row.image_missing && persisted.images > 0) result.images_recovered += 1;
    if (
      persisted.summary ||
      persisted.hours > 0 ||
      persisted.price ||
      persisted.contact ||
      persisted.programs > 0
    )
      result.detail_recovered += 1;
  }

  console.log("official_detail_recovery_summary", result);
  return result;
}
