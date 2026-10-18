import type { TourApiRow } from "./tourapi";
import type { Env } from "../env";
import {
  classifyDetailFailure,
  detailRetryAt,
  fetchTourApiDetailEndpointOne,
  saveTourApiDetailFailure,
  saveTourApiDetailSuccess,
  selectTourApiDetailCandidates,
  type TourApiDetailCandidate,
  type TourApiDetailPayload,
} from "./tourapi-detail";

const CHECKPOINT_MAX_BYTES = 64 * 1024;
const JOB_TTL_MS = 24 * 60 * 60_000;
const LEASE_MS = 5 * 60_000;
const MAX_STAGE_RETRIES = 3;
type WorkStage = "FETCH_COMMON" | "FETCH_INTRO" | "FETCH_INFO" | "PERSIST_ONE";
type Stage = WorkStage | "RETRY" | "DONE";
type Job = {
  event_id: string; generation: number; candidate_json: string; stage: Stage;
  retry_stage: WorkStage | null; checkpoint_json: string | null; attempt_count: number;
  available_at: string; retry_at: string | null; safe_error_category: string | null;
  lease_token: string | null; created_at: string; expires_at: string;
};
type Checkpoint = { common?: TourApiRow; intro?: TourApiRow; info?: TourApiRow[] };
export type TourApiDetailMicroResult = { stage: string; status: string; job_id: string | null };
export type TourApiDetailMicroDeps = {
  fetchEndpoint?: (endpoint: "detailCommon2" | "detailIntro2" | "detailInfo2", contentId: string) => Promise<TourApiRow[]>;
};

const plus = (at: string, ms: number) => new Date(Date.parse(at) + ms).toISOString();
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const safeReason = (error: unknown) => {
  const reason = classifyDetailFailure(error);
  return /^(network_or_timeout|http_429|http_5xx|provider_error|content_id_mismatch|response_bound|other)$/.test(reason)
    ? reason : "other";
};
const checkpoint = (value: Checkpoint) => {
  const json = JSON.stringify(value);
  return bytes(json) <= CHECKPOINT_MAX_BYTES ? json : null;
};
const candidate = (job: Job) => JSON.parse(job.candidate_json) as TourApiDetailCandidate;
const result = (job: Job, stage: string, status: string): TourApiDetailMicroResult => ({ stage, status, job_id: job.event_id });

async function claim(db: D1Database, stage: WorkStage | "RETRY", at: string) {
  const job = await db.prepare(
    "SELECT * FROM tourapi_detail_jobs WHERE stage=? AND available_at<=? AND expires_at>? ORDER BY available_at,event_id LIMIT 1",
  ).bind(stage, at, at).first<Job>();
  if (!job) return null;
  const lease = crypto.randomUUID();
  const changed = await db.prepare(
    `UPDATE tourapi_detail_jobs SET lease_token=?,available_at=?,updated_at=?
     WHERE event_id=? AND generation=? AND stage=? AND available_at<=? AND expires_at>?`,
  ).bind(lease, plus(at, LEASE_MS), at, job.event_id, job.generation, stage, at, at).run();
  return changed.meta.changes ? { ...job, lease_token: lease } : null;
}

async function transition(db: D1Database, job: Job, stage: Stage, at: string, values: {
  checkpointJson?: string | null; retryStage?: WorkStage | null; retryAt?: string | null; reason?: string | null;
} = {}) {
  const changed = await db.prepare(
    `UPDATE tourapi_detail_jobs SET stage=?,retry_stage=?,checkpoint_json=?,retry_at=?,safe_error_category=?,
     available_at=?,lease_token=NULL,updated_at=?
     WHERE event_id=? AND generation=? AND stage=? AND lease_token=?`,
  ).bind(stage, values.retryStage ?? null, values.checkpointJson ?? null, values.retryAt ?? null,
    values.reason ?? null, values.retryAt ?? at, at, job.event_id, job.generation, job.stage, job.lease_token).run();
  return Boolean(changed.meta.changes);
}

async function retryOrTerminal(db: D1Database, job: Job, workStage: WorkStage, at: string, reason: string) {
  const attempts = job.attempt_count + 1;
  if (attempts >= MAX_STAGE_RETRIES || plus(job.created_at, JOB_TTL_MS) <= at) {
    await saveTourApiDetailFailure(db, candidate(job), at);
    const done = await db.prepare(
      `UPDATE tourapi_detail_jobs SET attempt_count=?,stage='DONE',retry_stage=NULL,checkpoint_json=NULL,
       retry_at=NULL,safe_error_category=?,available_at=?,lease_token=NULL,updated_at=?
       WHERE event_id=? AND generation=? AND stage=? AND lease_token=?`,
    ).bind(attempts, reason, at, at, job.event_id, job.generation, job.stage, job.lease_token).run();
    return done.meta.changes ? "DONE" : "lost_claim";
  }
  const retryAt = plus(at, Math.min(60, 5 * 2 ** attempts) * 60_000);
  const changed = await db.prepare(
    `UPDATE tourapi_detail_jobs SET attempt_count=?,stage='RETRY',retry_stage=?,retry_at=?,available_at=?,
     safe_error_category=?,lease_token=NULL,updated_at=? WHERE event_id=? AND generation=? AND stage=? AND lease_token=?`,
  ).bind(attempts, workStage, retryAt, retryAt, reason, at, job.event_id, job.generation, job.stage, job.lease_token).run();
  return changed.meta.changes ? "RETRY" : "lost_claim";
}

/** Enqueues exactly one candidate selected with the legacy ordering and TTL/retry predicates. */
export async function enqueueTourApiDetailOne(db: D1Database, at = new Date().toISOString()) {
  const expired = await db.prepare("SELECT 1 FROM tourapi_detail_jobs WHERE stage<>'DONE' AND expires_at<=? LIMIT 1").bind(at).first();
  if (expired) return null;
  const candidates = await selectTourApiDetailCandidates(db, new Date(at), 25);
  for (const item of candidates) {
    const old = await db.prepare("SELECT generation,stage FROM tourapi_detail_jobs WHERE event_id=?").bind(item.id).first<{ generation: number; stage: Stage }>();
    if (old && old.stage !== "DONE") continue;
    const write = old
      ? await db.prepare(`UPDATE tourapi_detail_jobs SET generation=generation+1,candidate_json=?,stage='FETCH_COMMON',retry_stage=NULL,
          checkpoint_json=NULL,attempt_count=0,available_at=?,retry_at=NULL,safe_error_category=NULL,lease_token=NULL,
          created_at=?,updated_at=?,expires_at=? WHERE event_id=? AND generation=? AND stage='DONE'`)
        .bind(JSON.stringify(item), at, at, at, plus(at, JOB_TTL_MS), item.id, old.generation).run()
      : await db.prepare(`INSERT INTO tourapi_detail_jobs(event_id,generation,candidate_json,stage,available_at,created_at,updated_at,expires_at)
          VALUES(?,1,?,'FETCH_COMMON',?,?,?,?) ON CONFLICT(event_id) DO NOTHING`)
        .bind(item.id, JSON.stringify(item), at, at, at, plus(at, JOB_TTL_MS)).run();
    if (write.meta.changes) return { stage: "ENQUEUE_ONE", status: "enqueued", job_id: item.id } satisfies TourApiDetailMicroResult;
  }
  return null;
}

async function fetchOne(env: Env, at: string, stage: Exclude<WorkStage, "PERSIST_ONE">, deps: TourApiDetailMicroDeps) {
  const job = await claim(env.DB, stage, at);
  if (!job) return null;
  const endpoint = stage === "FETCH_COMMON" ? "detailCommon2" : stage === "FETCH_INTRO" ? "detailIntro2" : "detailInfo2";
  try {
    if (!env.TOUR_API_KEY) throw new Error("TourAPI missing API key");
    const contentId = candidate(job).id.slice("tourapi-".length);
    const rows = deps.fetchEndpoint
      ? await deps.fetchEndpoint(endpoint, contentId)
      : await fetchTourApiDetailEndpointOne(env.TOUR_API_KEY, endpoint, contentId);
    if (rows.some((row) => String(row.contentid ?? "") !== contentId || String(row.contenttypeid ?? "") !== "15"))
      throw new Error("TourAPI detail content_id_mismatch");
    if ((endpoint === "detailCommon2" || endpoint === "detailIntro2") && rows.length > 1)
      throw new Error("TourAPI detail response exceeds bound");
    if (endpoint === "detailInfo2" && rows.length > 20)
      throw new Error("TourAPI detail response exceeds bound");
    const existing = JSON.parse(job.checkpoint_json ?? "{}") as Checkpoint;
    const next = stage === "FETCH_COMMON" ? "FETCH_INTRO" : stage === "FETCH_INTRO" ? "FETCH_INFO" : "PERSIST_ONE";
    const saved = checkpoint({ ...existing, ...(stage === "FETCH_COMMON" ? { common: rows[0] ?? {} } : stage === "FETCH_INTRO" ? { intro: rows[0] ?? {} } : { info: rows }) });
    if (!saved) return result(job, stage, await retryOrTerminal(env.DB, job, stage, at, "response_bound"));
    const changed = await transition(env.DB, job, next, at, { checkpointJson: saved });
    return result(job, stage, changed ? next.toLowerCase() : "lost_claim");
  } catch (error) {
    return result(job, stage, await retryOrTerminal(env.DB, job, stage, at, safeReason(error)));
  }
}

export async function persistTourApiDetailOne(env: Env, at = new Date().toISOString()) {
  const job = await claim(env.DB, "PERSIST_ONE", at);
  if (!job) return null;
  try {
    const stored = JSON.parse(job.checkpoint_json ?? "{}") as Checkpoint;
    if (!stored.common || !stored.intro || !stored.info) throw new Error("invalid_checkpoint");
    await saveTourApiDetailSuccess(env.DB, candidate(job), { common: stored.common, intro: stored.intro, info: stored.info }, at);
    const changed = await transition(env.DB, job, "DONE", at, { checkpointJson: null });
    return result(job, "PERSIST_ONE", changed ? "done" : "lost_claim");
  } catch (error) {
    return result(job, "PERSIST_ONE", await retryOrTerminal(env.DB, job, "PERSIST_ONE", at, safeReason(error)));
  }
}

export async function retryTourApiDetailOne(db: D1Database, at = new Date().toISOString()) {
  const job = await claim(db, "RETRY", at);
  if (!job) return null;
  const next = job.retry_stage ?? "FETCH_COMMON";
  const changed = await transition(db, job, next, at, { checkpointJson: job.checkpoint_json, reason: job.safe_error_category });
  return result(job, "RETRY", changed ? next.toLowerCase() : "lost_claim");
}

export async function cleanupExpiredTourApiDetailOne(db: D1Database, at = new Date().toISOString()) {
  const job = await db.prepare("SELECT * FROM tourapi_detail_jobs WHERE stage<>'DONE' AND expires_at<=? ORDER BY expires_at,event_id LIMIT 1").bind(at).first<Job>();
  if (!job) return null;
  await saveTourApiDetailFailure(db, candidate(job), at);
  const changed = await db.prepare(
    `UPDATE tourapi_detail_jobs SET stage='DONE',retry_stage=NULL,checkpoint_json=NULL,safe_error_category='expired',
     lease_token=NULL,updated_at=? WHERE event_id=? AND generation=? AND stage=? AND expires_at<=?`,
  ).bind(at, job.event_id, job.generation, job.stage, at).run();
  return changed.meta.changes ? result(job, "CLEANUP", "expired") : null;
}

/** Dormant entry point: one selected checkpoint, endpoint, retry, enqueue, or cleanup only. */
export async function runTourApiDetailMicroJobOne(env: Env, at = new Date().toISOString(), deps: TourApiDetailMicroDeps = {}): Promise<TourApiDetailMicroResult> {
  for (const run of [
    () => persistTourApiDetailOne(env, at),
    () => fetchOne(env, at, "FETCH_INFO", deps),
    () => fetchOne(env, at, "FETCH_INTRO", deps),
    () => fetchOne(env, at, "FETCH_COMMON", deps),
    () => retryTourApiDetailOne(env.DB, at),
    () => enqueueTourApiDetailOne(env.DB, at),
    () => cleanupExpiredTourApiDetailOne(env.DB, at),
  ]) {
    const value = await run();
    if (value) return value;
  }
  return { stage: "NO_OP", status: "empty", job_id: null };
}
