import {
  createEnrichmentCandidate,
  hasMunicipalDetailCoreConflict,
  type MunicipalCandidate,
} from "../../shared/municipal-discovery";
import { extractMunicipalRichDetail, type MunicipalRichDetail } from "../../shared/municipal-rich-detail";
import { fetchOfficialPageViaReader } from "../../shared/official-reader-fallback";
import type { Env } from "../env";
import { persistMunicipalRichDetail } from "./municipal-rich-detail";
import {
  enrichFromVerifiedPoster,
  fetchFailureReason,
  fetchOfficialDetailPage,
  fieldCount,
  inferredSourceKind,
  markAttempt,
  markPosterSuccess,
  meaningfulHtmlProgram,
  meaningfulHtmlSummary,
  needsPosterRichDetailFallback,
  pageHasPositiveCoreSignal,
  recoveryReferer,
  recoveryUrlCandidates,
  retryableFetchFailure,
  selectOfficialDetailRecoveryCandidates,
  sourceId,
  type RecoveryPage,
  type RecoveryRow,
} from "./official-detail-recovery";

export const OFFICIAL_DETAIL_RAW_HTML_MAX_BYTES = 300 * 1024;
export const OFFICIAL_DETAIL_NORMALIZED_MAX_BYTES = 64 * 1024;
export const OFFICIAL_DETAIL_JOB_TTL_MS = 24 * 60 * 60_000;
const LEASE_MS = 5 * 60_000;
const MAX_STAGE_RETRIES = 3;
type WorkStage = "FETCH_PENDING" | "READER_PENDING" | "PARSE_PENDING" | "POSTER_PENDING" | "PERSIST_PENDING";
export type OfficialDetailJobStage = WorkStage | "RETRY" | "DONE";
type Job = {
  event_id: string;
  generation: number;
  candidate_json: string;
  stage: OfficialDetailJobStage;
  retry_stage: WorkStage | null;
  raw_html: string | null;
  raw_html_sha256: string | null;
  final_url: string | null;
  normalized_json: string | null;
  attempt_count: number;
  available_at: string;
  retry_at: string | null;
  safe_error_category: string | null;
  lease_token: string | null;
  created_at: string;
  expires_at: string;
};
type PosterResult = Awaited<ReturnType<typeof enrichFromVerifiedPoster>>;
type Checkpoint = {
  status: "detail" | "failure";
  reason?: string;
  detail?: MunicipalRichDetail;
  poster?: NonNullable<PosterResult>;
};
export type OfficialDetailMicroResult = { stage: string; status: string; job_id: string | null };
export type OfficialDetailMicroDeps = {
  fetchPage?: (url: string, referer: string | null) => Promise<RecoveryPage>;
  fetchReader?: (url: string, referer: string | null) => Promise<RecoveryPage>;
  recoverPoster?: (env: Env, row: RecoveryRow, at: string) => Promise<PosterResult>;
};

const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const digest = async (value: string) => Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
  (byte) => byte.toString(16).padStart(2, "0"),
).join("");
const plus = (at: string, ms: number) => new Date(Date.parse(at) + ms).toISOString();
const safeCategory = (error: unknown) => {
  const reason = fetchFailureReason(error);
  return /^(?:official_detail_[a-z_0-9]+|network_error|timeout|fetch_failed)$/.test(reason)
    ? reason : "official_detail_failed";
};
const checkpointJson = (value: Checkpoint) => {
  const json = JSON.stringify(value);
  return bytes(json) <= OFFICIAL_DETAIL_NORMALIZED_MAX_BYTES ? json : null;
};
const candidate = (job: Job) => JSON.parse(job.candidate_json) as RecoveryRow;

/** Only the legacy selector decides when a candidate is due. A DONE row can be reused. */
export async function officialDetailEnqueueOne(db: D1Database, at = new Date().toISOString()): Promise<OfficialDetailMicroResult | null> {
  // Give expiry cleanup its turn before admitting another due candidate.
  // Otherwise a continuously populated selector could strand an old job.
  const expired = await db.prepare(
    "SELECT 1 AS pending FROM official_detail_jobs WHERE stage<>'DONE' AND expires_at<=? LIMIT 1",
  ).bind(at).first<{ pending: number }>();
  if (expired) return null;
  const rows = await selectOfficialDetailRecoveryCandidates(db, new Date(at), 40);
  for (const row of rows) {
    const old = await db.prepare("SELECT generation,stage FROM official_detail_jobs WHERE event_id=?")
      .bind(row.id).first<{ generation: number; stage: OfficialDetailJobStage }>();
    if (old && old.stage !== "DONE") continue;
    const result = old
      ? await db.prepare(
        `UPDATE official_detail_jobs SET generation=generation+1,candidate_json=?,stage='FETCH_PENDING',retry_stage=NULL,
         raw_html=NULL,raw_html_sha256=NULL,final_url=NULL,normalized_json=NULL,attempt_count=0,
         available_at=?,retry_at=NULL,safe_error_category=NULL,lease_token=NULL,created_at=?,updated_at=?,expires_at=?
         WHERE event_id=? AND generation=? AND stage='DONE'`,
      ).bind(JSON.stringify(row), at, at, at, plus(at, OFFICIAL_DETAIL_JOB_TTL_MS), row.id, old.generation).run()
      : await db.prepare(
        `INSERT INTO official_detail_jobs(event_id,generation,candidate_json,stage,available_at,created_at,updated_at,expires_at)
         VALUES(?,1,?,'FETCH_PENDING',?,?,?,?) ON CONFLICT(event_id) DO NOTHING`,
      ).bind(row.id, JSON.stringify(row), at, at, at, plus(at, OFFICIAL_DETAIL_JOB_TTL_MS)).run();
    if (result.meta.changes) return { stage: "ENQUEUE_ONE", status: "enqueued", job_id: row.id };
  }
  return null;
}

async function claim(db: D1Database, stage: WorkStage | "RETRY", at: string): Promise<Job | null> {
  const job = await db.prepare(
    `SELECT * FROM official_detail_jobs WHERE stage=? AND available_at<=? AND expires_at>?
     ORDER BY available_at,event_id LIMIT 1`,
  ).bind(stage, at, at).first<Job>();
  if (!job) return null;
  const token = crypto.randomUUID();
  const result = await db.prepare(
    `UPDATE official_detail_jobs SET lease_token=?,available_at=?,updated_at=?
     WHERE event_id=? AND generation=? AND stage=? AND available_at<=? AND expires_at>?`,
  ).bind(token, plus(at, LEASE_MS), at, job.event_id, job.generation, stage, at, at).run();
  return result.meta.changes ? { ...job, lease_token: token } : null;
}

async function transition(
  db: D1Database, job: Job, stage: OfficialDetailJobStage, at: string,
  extra: { rawHtml?: string | null; rawHash?: string | null; finalUrl?: string | null; normalized?: string | null; reason?: string | null; retryStage?: WorkStage | null; retryAt?: string | null } = {},
) {
  const result = await db.prepare(
    `UPDATE official_detail_jobs SET stage=?,retry_stage=?,raw_html=?,raw_html_sha256=?,final_url=?,
     normalized_json=?,safe_error_category=?,retry_at=?,available_at=?,lease_token=NULL,updated_at=?
     WHERE event_id=? AND generation=? AND stage=? AND lease_token=?`,
  ).bind(
    stage, extra.retryStage ?? null, extra.rawHtml ?? null, extra.rawHash ?? null,
    extra.finalUrl === undefined ? job.final_url : extra.finalUrl,
    extra.normalized ?? null, extra.reason ?? null, extra.retryAt ?? null,
    extra.retryAt ?? at, at, job.event_id, job.generation, job.stage, job.lease_token,
  ).run();
  return Boolean(result.meta.changes);
}

async function failOrRetry(db: D1Database, job: Job, stage: WorkStage, at: string, reason: string) {
  const attempts = job.attempt_count + 1;
  if (attempts >= MAX_STAGE_RETRIES || plus(job.created_at, OFFICIAL_DETAIL_JOB_TTL_MS) <= at) {
    // A poster failure retains verified HTML facts. A failed persistence write
    // must terminate instead of looping over the same broken D1 operation.
    const finalStage = stage === "PERSIST_PENDING" ? "DONE" : "PERSIST_PENDING";
    const failure = stage === "POSTER_PENDING"
      ? job.normalized_json
      : stage === "PERSIST_PENDING" ? null : checkpointJson({ status: "failure", reason });
    const result = await db.prepare(
      `UPDATE official_detail_jobs SET attempt_count=?,stage=?,retry_stage=NULL,
       raw_html=NULL,raw_html_sha256=NULL,normalized_json=?,safe_error_category=?,available_at=?,
       retry_at=NULL,lease_token=NULL,updated_at=?
       WHERE event_id=? AND generation=? AND stage=? AND lease_token=?`,
    ).bind(attempts, finalStage, failure, reason, at, at, job.event_id, job.generation, job.stage, job.lease_token).run();
    return result.meta.changes ? finalStage : "lost_claim";
  }
  const retryAt = plus(at, Math.min(60, 5 * 2 ** attempts) * 60_000);
  const result = await db.prepare(
    `UPDATE official_detail_jobs SET attempt_count=?,stage='RETRY',retry_stage=?,raw_html=NULL,
     raw_html_sha256=NULL,normalized_json=?,safe_error_category=?,retry_at=?,available_at=?,
     lease_token=NULL,updated_at=? WHERE event_id=? AND generation=? AND stage=? AND lease_token=?`,
  ).bind(attempts, stage, stage === "POSTER_PENDING" || stage === "PERSIST_PENDING" ? job.normalized_json : null,
    reason, retryAt, retryAt, at, job.event_id, job.generation, job.stage, job.lease_token).run();
  return result.meta.changes ? "RETRY" : "lost_claim";
}

const outcome = (job: Job, stage: string, status: string): OfficialDetailMicroResult => ({ stage, status, job_id: job.event_id });

export async function officialDetailFetchOne(env: Env, at = new Date().toISOString(), deps: OfficialDetailMicroDeps = {}) {
  const job = await claim(env.DB, "FETCH_PENDING", at);
  if (!job) return null;
  const row = candidate(job);
  let page: RecoveryPage | null = null;
  let lastError: unknown = null;
  const referer = recoveryReferer(row);
  for (const url of recoveryUrlCandidates(row)) {
    try {
      page = deps.fetchPage ? await deps.fetchPage(url, referer) : await fetchOfficialDetailPage(url, referer);
      break;
    } catch (error) { lastError = error; }
  }
  if (page && bytes(page.html) <= OFFICIAL_DETAIL_RAW_HTML_MAX_BYTES) {
    const changed = await transition(env.DB, job, "PARSE_PENDING", at, {
      rawHtml: page.html, rawHash: await digest(page.html), finalUrl: page.finalUrl,
    });
    return outcome(job, "FETCH_PENDING", changed ? "parse_pending" : "lost_claim");
  }
  if (page) lastError = new Error("official_detail_too_large");
  const reason = safeCategory(lastError);
  const next = retryableFetchFailure(lastError) || reason === "official_detail_too_large"
    ? "READER_PENDING" : "PERSIST_PENDING";
  const changed = await transition(env.DB, job, next, at, {
    normalized: next === "PERSIST_PENDING" ? checkpointJson({ status: "failure", reason }) : null,
    reason,
  });
  return outcome(job, "FETCH_PENDING", changed ? next.toLowerCase() : "lost_claim");
}

export async function officialDetailReaderOne(env: Env, at = new Date().toISOString(), deps: OfficialDetailMicroDeps = {}) {
  const job = await claim(env.DB, "READER_PENDING", at);
  if (!job) return null;
  const row = candidate(job);
  let page: RecoveryPage | null = null;
  for (const url of recoveryUrlCandidates(row).slice(0, 4)) {
    try {
      page = deps.fetchReader
        ? await deps.fetchReader(url, recoveryReferer(row))
        : await fetchOfficialPageViaReader(url, { refererUrl: recoveryReferer(row), timeoutMs: 25_000 });
      break;
    } catch { /* The direct failure remains the cooldown reason if all Reader URLs fail. */ }
  }
  if (page && bytes(page.html) <= OFFICIAL_DETAIL_RAW_HTML_MAX_BYTES) {
    const changed = await transition(env.DB, job, "PARSE_PENDING", at, {
      rawHtml: page.html, rawHash: await digest(page.html), finalUrl: page.finalUrl,
    });
    return outcome(job, "READER_PENDING", changed ? "parse_pending" : "lost_claim");
  }
  const reason = page ? "official_reader_too_large" : job.safe_error_category ?? "official_reader_failed";
  const changed = await transition(env.DB, job, "PERSIST_PENDING", at, {
    normalized: checkpointJson({ status: "failure", reason }), reason,
  });
  return outcome(job, "READER_PENDING", changed ? "persist_pending" : "lost_claim");
}

export async function officialDetailParseOne(env: Env, at = new Date().toISOString()) {
  const job = await claim(env.DB, "PARSE_PENDING", at);
  if (!job) return null;
  const row = candidate(job);
  let checkpoint: Checkpoint;
  if (!job.raw_html || !job.final_url || await digest(job.raw_html) !== job.raw_html_sha256) {
    checkpoint = { status: "failure", reason: "invalid_raw_checkpoint" };
  } else {
    const candidateRow: MunicipalCandidate = {
      source: "official-detail-recovery", source_candidate_id: row.id,
      title: row.title, start_date: row.start_date, end_date: row.end_date,
      region: row.region, locality: row.region, venue: row.venue,
      official_url: job.final_url, category: null, snippet: null, image_candidate: null,
    };
    const validation = createEnrichmentCandidate(candidateRow, job.raw_html);
    if (validation.parse_error) checkpoint = { status: "failure", reason: validation.parse_error };
    else if (hasMunicipalDetailCoreConflict(candidateRow, job.raw_html)) checkpoint = { status: "failure", reason: "core_conflict" };
    else if (!pageHasPositiveCoreSignal(row, job.raw_html)) checkpoint = { status: "failure", reason: "insufficient_core_signal" };
    else {
      try {
        const extracted = extractMunicipalRichDetail(job.final_url, job.raw_html);
        checkpoint = { status: "detail", detail: {
          ...extracted,
          summary: meaningfulHtmlSummary(row.title, extracted.summary) ? extracted.summary : null,
        } };
      } catch { checkpoint = { status: "failure", reason: "extract_failed" }; }
    }
  }
  let next: WorkStage = "PERSIST_PENDING";
  if (checkpoint.status === "detail" && checkpoint.detail && needsPosterRichDetailFallback(row.title, checkpoint.detail))
    next = "POSTER_PENDING";
  let normalized = checkpointJson(checkpoint);
  if (!normalized) {
    next = "PERSIST_PENDING";
    normalized = checkpointJson({ status: "failure", reason: "normalized_detail_too_large" });
  }
  const changed = await transition(env.DB, job, next, at, {
    rawHtml: null, rawHash: null, normalized, reason: checkpoint.status === "failure" ? checkpoint.reason : null,
  });
  return outcome(job, "PARSE_PENDING", changed ? next.toLowerCase() : "lost_claim");
}

export async function officialDetailPosterOne(env: Env, at = new Date().toISOString(), deps: OfficialDetailMicroDeps = {}) {
  const job = await claim(env.DB, "POSTER_PENDING", at);
  if (!job) return null;
  const row = candidate(job);
  const checkpoint = JSON.parse(job.normalized_json ?? "null") as Checkpoint | null;
  if (!checkpoint || checkpoint.status !== "detail" || !checkpoint.detail) {
    const changed = await transition(env.DB, job, "PERSIST_PENDING", at, {
      normalized: checkpointJson({ status: "failure", reason: "invalid_normalized_checkpoint" }),
      reason: "invalid_normalized_checkpoint",
    });
    return outcome(job, "POSTER_PENDING", changed ? "persist_pending" : "lost_claim");
  }
  try {
    const poster = deps.recoverPoster
      ? await deps.recoverPoster(env, row, at)
      : await enrichFromVerifiedPoster(env, row, at, { timeoutMs: 25_000 });
    if (poster) {
      const html = checkpoint.detail;
      const posterDetail = poster.detail;
      checkpoint.detail = {
        ...html,
        summary: posterDetail.summary ?? (meaningfulHtmlSummary(row.title, html.summary) ? html.summary : null),
        operating_hours: html.operating_hours.length ? html.operating_hours : posterDetail.operating_hours,
        programs: posterDetail.programs.length ? posterDetail.programs : html.programs.filter((value) => meaningfulHtmlProgram(value.name)),
        price_text: html.price_text ?? posterDetail.price_text,
        contact_phone: html.contact_phone ?? posterDetail.contact_phone,
      };
      checkpoint.poster = poster;
    }
    const normalized = checkpointJson(checkpoint);
    // A very long OCR transcription is not worth discarding already verified
    // HTML facts or storing an unbounded D1 checkpoint.
    const retainedHtml = normalized ?? job.normalized_json;
    const changed = await transition(env.DB, job, "PERSIST_PENDING", at, {
      normalized: retainedHtml,
      reason: normalized ? null : "poster_checkpoint_too_large",
    });
    return outcome(job, "POSTER_PENDING", changed ? "persist_pending" : "lost_claim");
  } catch (error) {
    return outcome(job, "POSTER_PENDING", await failOrRetry(env.DB, job, "POSTER_PENDING", at, safeCategory(error)));
  }
}

export async function officialDetailPersistOne(env: Env, at = new Date().toISOString()) {
  const job = await claim(env.DB, "PERSIST_PENDING", at);
  if (!job) return null;
  const row = candidate(job);
  const sourceKind = inferredSourceKind(row);
  try {
    const checkpoint = JSON.parse(job.normalized_json ?? "null") as Checkpoint | null;
    if (!checkpoint || checkpoint.status === "failure" || !checkpoint.detail) {
      await markAttempt(env.DB, row, sourceKind, at, checkpoint?.reason ?? "invalid_normalized_checkpoint");
    } else {
      let detail = checkpoint.detail;
      if (!meaningfulHtmlSummary(row.title, detail.summary)) detail = { ...detail, summary: null };
      if (!detail.summary) {
        const old = await env.DB.prepare(
          `SELECT en.source_id,en.summary,s.priority FROM event_enrichments en
           JOIN sources s ON s.id=en.source_id WHERE en.event_id=?`,
        ).bind(row.id).all<{ source_id: string; summary: string; priority: number }>();
        const incomingPriority = sourceKind === "organizer" ? 1 : 2;
        for (const value of old.results)
          if (value.priority >= incomingPriority && !meaningfulHtmlSummary(row.title, value.summary))
            await env.DB.prepare("DELETE FROM event_enrichments WHERE event_id=? AND source_id=?")
              .bind(row.id, value.source_id).run();
      }
      if (fieldCount(detail) === 0) {
        await markAttempt(env.DB, row, sourceKind, at, "empty");
      } else {
        if (checkpoint.poster && !detail.programs.length) {
          const old = await env.DB.prepare(
            `SELECT p.id,p.program_name FROM event_programs p JOIN sources s ON s.id=p.source_id
             WHERE p.event_id=? AND s.priority>=?`,
          ).bind(row.id, sourceKind === "organizer" ? 1 : 2).all<{ id: string; program_name: string }>();
          for (const value of old.results)
            if (!meaningfulHtmlProgram(value.program_name))
              await env.DB.prepare("DELETE FROM event_programs WHERE id=?").bind(value.id).run();
        }
        await persistMunicipalRichDetail(env.DB, {
          eventId: row.id, startDate: row.start_date, endDate: row.end_date,
          sourceId: sourceId(row.id),
          sourceName: sourceKind === "organizer" ? "행사 공식 상세 안내" : "지자체 공식 상세 안내",
          sourceUrl: job.final_url ?? row.official_url, checkedAt: at, detail, sourceKind,
          ...(checkpoint.poster ? { posterUrl: checkpoint.poster.posterUrl } : {}),
        });
        if (checkpoint.poster && !checkpoint.poster.cached)
          await markPosterSuccess(env.DB, row, at, checkpoint.poster.posterUrl, checkpoint.poster.text, checkpoint.poster.posterHash);
        await env.DB.prepare(
          `INSERT INTO event_official_links(event_id,source_id,url,checked_at) VALUES(?,?,?,?)
           ON CONFLICT(event_id,source_id) DO UPDATE SET url=excluded.url,checked_at=excluded.checked_at`,
        ).bind(row.id, row.link_source_id, job.final_url ?? row.official_url, at).run();
      }
    }
    const changed = await transition(env.DB, job, "DONE", at, {
      rawHtml: null, rawHash: null, normalized: null,
      reason: checkpoint?.status === "failure" ? checkpoint.reason : null,
    });
    return outcome(job, "PERSIST_PENDING", changed ? "done" : "lost_claim");
  } catch (error) {
    return outcome(job, "PERSIST_PENDING", await failOrRetry(env.DB, job, "PERSIST_PENDING", at, safeCategory(error)));
  }
}

export async function officialDetailRetryOne(db: D1Database, at = new Date().toISOString()) {
  const job = await claim(db, "RETRY", at);
  if (!job) return null;
  const next = job.retry_stage ?? "FETCH_PENDING";
  const changed = await transition(db, job, next, at, {
    finalUrl: next === "FETCH_PENDING" ? null : job.final_url,
    normalized: next === "POSTER_PENDING" || next === "PERSIST_PENDING" ? job.normalized_json : null,
    reason: job.safe_error_category,
  });
  return outcome(job, "RETRY", changed ? next.toLowerCase() : "lost_claim");
}

/** One expired checkpoint per call; terminal failures still enter the legacy cooldown ledger. */
export async function cleanupExpiredOfficialDetailJobs(db: D1Database, at = new Date().toISOString()) {
  const job = await db.prepare(
    `SELECT * FROM official_detail_jobs WHERE stage<>'DONE' AND expires_at<=?
     ORDER BY expires_at,event_id LIMIT 1`,
  ).bind(at).first<Job>();
  if (job) {
    const result = await db.prepare(
      `UPDATE official_detail_jobs SET stage='DONE',retry_stage=NULL,raw_html=NULL,raw_html_sha256=NULL,
       normalized_json=NULL,lease_token=NULL,safe_error_category='expired',updated_at=?
       WHERE event_id=? AND generation=? AND stage=? AND expires_at<=?`,
    ).bind(at, job.event_id, job.generation, job.stage, at).run();
    if (result.meta.changes) {
      const row = candidate(job);
      await markAttempt(db, row, inferredSourceKind(row), at, "expired");
      return outcome(job, "CLEANUP", "expired");
    }
  }
  return null;
}

/** Dormant entry point. Exactly one selected stage (or enqueue/cleanup) per call. */
export async function runOfficialDetailMicroJobOne(env: Env, at = new Date().toISOString(), deps: OfficialDetailMicroDeps = {}): Promise<OfficialDetailMicroResult> {
  for (const stage of [
    () => officialDetailPersistOne(env, at),
    () => officialDetailPosterOne(env, at, deps),
    () => officialDetailParseOne(env, at),
    () => officialDetailReaderOne(env, at, deps),
    () => officialDetailFetchOne(env, at, deps),
    () => officialDetailRetryOne(env.DB, at),
    () => officialDetailEnqueueOne(env.DB, at),
    () => cleanupExpiredOfficialDetailJobs(env.DB, at),
  ]) {
    const result = await stage();
    if (result) return result;
  }
  return { stage: "NO_OP", status: "empty", job_id: null };
}
