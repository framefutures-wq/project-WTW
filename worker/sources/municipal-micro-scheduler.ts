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
