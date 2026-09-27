import { koreaDate } from "../../shared/domain";
import {
  createEnrichmentCandidate,
  hasMunicipalDetailCoreConflict,
  type MunicipalCandidate,
} from "../../shared/municipal-discovery";
import {
  extractMunicipalRichDetail,
  type MunicipalRichDetail,
} from "../../shared/municipal-rich-detail";
import type { Env } from "../env";
import { persistMunicipalRichDetail } from "./municipal-rich-detail";

export const OFFICIAL_DETAIL_RECOVERY_LIMIT = 12;
export const OFFICIAL_DETAIL_RETRY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
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
  empty: number;
  fetch_failed: number;
};

type RecoveryPage = { html: string; finalUrl: string };
type RecoveryOptions = {
  limit?: number;
  fetchPage?: (url: string) => Promise<RecoveryPage>;
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

export async function fetchOfficialDetailPage(
  rawUrl: string,
): Promise<RecoveryPage> {
  const initial = safeOfficialUrl(rawUrl);
  if (!initial) throw new Error("official_detail_invalid_url");
  const family = hostFamily(initial.hostname);
  let current = initial;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetch(current.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "user-agent": "GalteumOfficialDetail/1.0",
        accept: "text/html,application/xhtml+xml",
      },
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
    return { html: await readBoundedHtml(response), finalUrl: current.toString() };
  }
  throw new Error("official_detail_redirect_failed");
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
) {
  const today = koreaDate(now);
  const retryBefore = new Date(
    now.getTime() - OFFICIAL_DETAIL_RETRY_TTL_MS,
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
         CASE
           WHEN ei.event_id IS NULL OR ei.image_url IS NULL OR ei.image_status!='ok'
           THEN 1 ELSE 0
         END AS image_missing
       FROM events e
       JOIN ranked r ON r.event_id=e.id AND r.rn=1
       JOIN sources ps ON ps.id=e.primary_source_id
       LEFT JOIN event_images ei ON ei.event_id=e.id AND ei.is_primary=1
       LEFT JOIN sources attempt ON attempt.id='official-detail-' || e.id
       WHERE e.is_sample=0
         AND e.verification='verified'
         AND e.publish_quality_state='PUBLIC'
         AND e.end_date>=?
         AND (
           ei.event_id IS NULL OR ei.image_url IS NULL OR ei.image_status!='ok'
           OR NOT EXISTS (
             SELECT 1 FROM event_enrichments en WHERE en.event_id=e.id
           )
           OR NOT EXISTS (
             SELECT 1 FROM event_operating_hours oh WHERE oh.event_id=e.id
           )
         )
         AND (attempt.id IS NULL OR attempt.fetched_at<?)
       ORDER BY image_missing DESC,e.start_date,e.id
       LIMIT ?`,
    )
    .bind(today, retryBefore, Math.max(1, Math.min(40, limit)))
    .all<RecoveryRow>();
  return rows.results;
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
    empty: 0,
    fetch_failed: 0,
  };
  const fetchPage = options.fetchPage ?? fetchOfficialDetailPage;
  const checkedAt = now.toISOString();

  for (const row of rows) {
    result.attempted += 1;
    const sourceKind = inferredSourceKind(row);
    let page: RecoveryPage;
    try {
      page = await fetchPage(row.official_url);
      result.fetched += 1;
    } catch (error) {
      result.fetch_failed += 1;
      await markAttempt(
        env.DB,
        row,
        sourceKind,
        checkedAt,
        error instanceof Error ? error.message.slice(0, 120) : "fetch_failed",
      );
      continue;
    }

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

    let detail: MunicipalRichDetail;
    try {
      detail = extractMunicipalRichDetail(page.finalUrl, page.html);
    } catch {
      result.empty += 1;
      await markAttempt(env.DB, row, sourceKind, checkedAt, "extract_failed");
      continue;
    }
    if (fieldCount(detail) === 0) {
      result.empty += 1;
      await markAttempt(env.DB, row, sourceKind, checkedAt, "empty");
      continue;
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
    });
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
