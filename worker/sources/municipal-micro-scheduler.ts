import type { Env } from "../env";
import {
  cleanupExpiredMunicipalDetailJobs,
  detailFetchOne,
  detailParseOne,
  detailPersistOne,
} from "./municipal-detail-jobs";
import {
  cleanupExpiredMunicipalScanJobs,
  runMunicipalCandidateCheckpointOne,
  runMunicipalListPageOne,
  runMunicipalSourceFinalizeOne,
  runVerifiedGenericMunicipalPublicationOne,
} from "./municipal";

type MicroResult = { id?: string; job_id?: string; stage: string } | null;
type CleanupResult = { meta?: { changes?: number } };

export type MunicipalMicroSchedulerResult = {
  stage:
    | "DETAIL_PERSIST"
    | "DETAIL_PARSE"
    | "DETAIL_FETCH"
    | "VERIFIED_GENERIC_PUBLICATION"
    | "SOURCE_FINALIZE"
    | "CANDIDATE_PENDING"
    | "LIST_PENDING"
    | "CLEANUP_DETAIL"
    | "CLEANUP_SCAN"
    | "NO_OP";
  status: string;
  job_id: string | null;
};

export type MunicipalMicroSchedulerDependencies = {
  candidateFastPathReady: (db: Env["DB"]) => Promise<boolean>;
  detailPersistOne: (db: Env["DB"]) => Promise<MicroResult>;
  detailParseOne: (db: Env["DB"]) => Promise<MicroResult>;
  detailFetchOne: (db: Env["DB"]) => Promise<MicroResult>;
  runMunicipalCandidateCheckpointOne: (env: Env) => Promise<MicroResult>;
  runVerifiedGenericMunicipalPublicationOne: (env: Env) => Promise<MicroResult>;
  runMunicipalSourceFinalizeOne: (db: Env["DB"]) => Promise<MicroResult>;
  runMunicipalListPageOne: (db: Env["DB"]) => Promise<MicroResult>;
  cleanupExpiredMunicipalDetailJobs: (db: Env["DB"]) => Promise<CleanupResult>;
  cleanupExpiredMunicipalScanJobs: (db: Env["DB"]) => Promise<CleanupResult>;
};

const productionDependencies: MunicipalMicroSchedulerDependencies = {
  candidateFastPathReady: municipalCandidateFastPathReady,
  detailPersistOne,
  detailParseOne,
  detailFetchOne,
  runMunicipalCandidateCheckpointOne,
  runVerifiedGenericMunicipalPublicationOne,
  runMunicipalSourceFinalizeOne,
  runMunicipalListPageOne,
  cleanupExpiredMunicipalDetailJobs,
  cleanupExpiredMunicipalScanJobs,
};

/**
 * A candidate cursor commonly stays ready for many consecutive invocations.
 * In that case the normal priority probe sequence would reread every empty
 * detail/publication/finalize queue before it reaches the same candidate
 * claim. This is deliberately only an eligibility check: the established
 * candidate claim still performs the lease and cursor transition.
 */
export async function municipalCandidateFastPathReady(db: Env["DB"], at = new Date().toISOString()) {
  const row = await db.prepare(
    `SELECT 1 AS ready
     FROM municipal_scan_jobs candidate
     WHERE (candidate.stage='CANDIDATE_PENDING' OR
            (candidate.stage='RETRY' AND candidate.retry_stage='CANDIDATE_PENDING'))
       AND candidate.available_at<=?
       AND candidate.expires_at>?
       AND candidate.source_finalized_at IS NOT NULL
       AND candidate.page_index=1
       AND NOT EXISTS (
         SELECT 1 FROM municipal_detail_jobs detail
         WHERE (detail.stage IN ('PERSIST_PENDING','PARSE_PENDING','FETCH_PENDING') OR
                (detail.stage='RETRY' AND detail.retry_stage IN ('PERSIST_PENDING','PARSE_PENDING','FETCH_PENDING')))
           AND detail.available_at<=? AND detail.expires_at>?
       )
       AND NOT EXISTS (
         SELECT 1 FROM municipal_detail_jobs verified
         WHERE verified.stage='DONE'
           AND verified.safe_error_category IN ('candidate_core_verified','candidate_registration_retry')
           AND verified.available_at<=? AND verified.expires_at>?
       )
       AND NOT EXISTS (
         SELECT 1 FROM municipal_scan_jobs finalize
         WHERE finalize.page_index=1 AND finalize.stage='DONE'
           AND finalize.candidate_batch_json IS NOT NULL
           AND finalize.safe_error_category IS NULL
           AND finalize.source_finalized_at IS NULL
           AND finalize.available_at<=? AND finalize.expires_at>?
       )
     LIMIT 1`,
  ).bind(at, at, at, at, at, at, at, at).first<{ ready: number }>();
  return Boolean(row?.ready);
}

const completed = (
  stage: Exclude<MunicipalMicroSchedulerResult["stage"], "CLEANUP_DETAIL" | "CLEANUP_SCAN" | "NO_OP">,
  result: Exclude<MicroResult, null>,
): MunicipalMicroSchedulerResult => ({
  stage,
  status: result.stage,
  job_id: result.id ?? result.job_id ?? null,
});

/**
 * Runs exactly one durable municipal checkpoint. This is deliberately not
 * wired into runScheduled until a separate production cutover task.
 */
export async function runMunicipalMicroJobOne(
  env: Env,
  dependencies = productionDependencies,
): Promise<MunicipalMicroSchedulerResult> {
  // Keep the existing durable priority, but bypass its five empty probes for
  // the repeated candidate-cursor case. The candidate runner still claims
  // atomically and falls through to the full sequence if its claim is lost.
  if (await dependencies.candidateFastPathReady(env.DB)) {
    const candidate = await dependencies.runMunicipalCandidateCheckpointOne(env);
    if (candidate) return completed("CANDIDATE_PENDING", candidate);
  }

  const persist = await dependencies.detailPersistOne(env.DB);
  if (persist) return completed("DETAIL_PERSIST", persist);

  const parse = await dependencies.detailParseOne(env.DB);
  if (parse) return completed("DETAIL_PARSE", parse);

  const fetch = await dependencies.detailFetchOne(env.DB);
  if (fetch) return completed("DETAIL_FETCH", fetch);

  const verifiedPublication = await dependencies.runVerifiedGenericMunicipalPublicationOne(env);
  if (verifiedPublication) return completed("VERIFIED_GENERIC_PUBLICATION", verifiedPublication);

  const finalize = await dependencies.runMunicipalSourceFinalizeOne(env.DB);
  if (finalize) return completed("SOURCE_FINALIZE", finalize);

  const candidate = await dependencies.runMunicipalCandidateCheckpointOne(env);
  if (candidate) return completed("CANDIDATE_PENDING", candidate);

  const list = await dependencies.runMunicipalListPageOne(env.DB);
  if (list) return completed("LIST_PENDING", list);

  const detailCleanup = await dependencies.cleanupExpiredMunicipalDetailJobs(env.DB);
  if ((detailCleanup.meta?.changes ?? 0) > 0)
    return { stage: "CLEANUP_DETAIL", status: "cleaned", job_id: null };

  const scanCleanup = await dependencies.cleanupExpiredMunicipalScanJobs(env.DB);
  if ((scanCleanup.meta?.changes ?? 0) > 0)
    return { stage: "CLEANUP_SCAN", status: "cleaned", job_id: null };

  return { stage: "NO_OP", status: "empty", job_id: null };
}
