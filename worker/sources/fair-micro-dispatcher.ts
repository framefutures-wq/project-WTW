import type { Env } from "../env";
import { hasActiveMunicipalMicroWork, municipalOperatingDate, runMunicipalContinuousCycleOne } from "./municipal-continuous-cycle";
import { runOfficialDetailMicroJobOne } from "./official-detail-jobs";
import { selectOfficialDetailRecoveryCandidates } from "./official-detail-recovery";
import { runTourApiDetailMicroJobOne } from "./tourapi-detail-jobs";
import { selectTourApiDetailCandidates } from "./tourapi-detail";

export const FAIR_DISPATCHER_LEASE_MS = 5 * 60_000;
export const FAIR_DISPATCHER_MAX_GAP = 12;
const MUNICIPAL_BASE_SHARE_DENOMINATOR = 4;
const MUNICIPAL_BASE_SHARE_NUMERATOR = 3;
const DISPATCHER_STAGE_LOG_EVENT = "fair_micro_dispatcher_stage";

// Keep these names fixed and payload-free: scheduled CPU termination can stop
// execution before cleanup, so the final emitted stage is the diagnostic.
const dispatcherStage = (stage:
  | "LEASE_CLAIMED"
  | "READINESS_STARTED"
  | "READINESS_DUE_JOBS_STARTED"
  | "READINESS_CANDIDATES_STARTED"
  | "READINESS_MUNICIPAL_ACTIVE_STARTED"
  | "READINESS_MUNICIPAL_CYCLE_STARTED"
  | "READINESS_COMPLETED"
  | "LANE_MUNICIPAL_SELECTED"
  | "LANE_OFFICIAL_SELECTED"
  | "LANE_TOURAPI_SELECTED"
  | "LANE_MUNICIPAL_STARTED"
  | "LANE_OFFICIAL_STARTED"
  | "LANE_TOURAPI_STARTED"
  | "LANE_MUNICIPAL_FINISHED"
  | "LANE_OFFICIAL_FINISHED"
  | "LANE_TOURAPI_FINISHED"
  | "MUNICIPAL_MICRO_STARTED",
) => console.log(DISPATCHER_STAGE_LOG_EVENT, { stage });

export type FairMicroLane = "municipal" | "official" | "tourapi";
type LaneReady = Record<FairMicroLane, number>;
type DispatcherState = {
  lease_token: string | null;
  lease_until: string | null;
  dispatch_count: number;
  cursor: number;
  municipal_last_dispatch: number;
  official_last_dispatch: number;
  tourapi_last_dispatch: number;
};
type MicroResult = { stage: string; status: string; job_id: string | null };
export type FairMicroDispatcherResult =
  | { status: "BUSY" | "NO_OP"; lane: null; stage: null; job_id: null }
  | { status: "FAILED"; lane: null; stage: null; job_id: null }
  | { status: "DONE" | "FAILED"; lane: FairMicroLane; stage: string; job_id: string | null };
export type FairMicroDispatcherDependencies = {
  ready: (env: Env, at: string) => Promise<LaneReady>;
  municipal: (env: Env, at: string) => Promise<MicroResult>;
  official: (env: Env, at: string) => Promise<MicroResult>;
  tourapi: (env: Env, at: string) => Promise<MicroResult>;
};

const plus = (at: string, milliseconds: number) => new Date(Date.parse(at) + milliseconds).toISOString();
const lanes: FairMicroLane[] = ["municipal", "official", "tourapi"];
const columnFor = (lane: FairMicroLane) => `${lane}_last_dispatch` as const;
const laneStage = (lane: FairMicroLane, state: "selected" | "started" | "finished") => {
  if (lane === "municipal") {
    dispatcherStage(state === "selected" ? "LANE_MUNICIPAL_SELECTED" : state === "started" ? "LANE_MUNICIPAL_STARTED" : "LANE_MUNICIPAL_FINISHED");
  } else if (lane === "official") {
    dispatcherStage(state === "selected" ? "LANE_OFFICIAL_SELECTED" : state === "started" ? "LANE_OFFICIAL_STARTED" : "LANE_OFFICIAL_FINISHED");
  } else {
    dispatcherStage(state === "selected" ? "LANE_TOURAPI_SELECTED" : state === "started" ? "LANE_TOURAPI_STARTED" : "LANE_TOURAPI_FINISHED");
  }
};

async function count(db: D1Database, sql: string, at: string) {
  return (await db.prepare(sql).bind(at, at).first<{ count: number }>())?.count ?? 0;
}

/** Read-only readiness deliberately excludes future retries, so they cannot occupy a turn. */
export async function fairMicroLaneReadiness(env: Env, at: string): Promise<LaneReady> {
  const db = env.DB;
  dispatcherStage("READINESS_STARTED");
  dispatcherStage("READINESS_DUE_JOBS_STARTED");
  const [officialJobs, tourapiJobs] = await Promise.all([
    count(db, "SELECT COUNT(*) AS count FROM official_detail_jobs WHERE stage<>'DONE' AND (expires_at<=? OR available_at<=?)", at),
    count(db, "SELECT COUNT(*) AS count FROM tourapi_detail_jobs WHERE stage<>'DONE' AND (expires_at<=? OR available_at<=?)", at),
  ]);
  // A due checkpoint is already sufficient to make its lane selectable. Do
  // not run the legacy whole-candidate selectors on every minute while it is
  // waiting: they are only needed to discover work when the checkpoint lane
  // itself is empty.
  dispatcherStage("READINESS_CANDIDATES_STARTED");
  const [officialCandidates, tourapiCandidates] = await Promise.all([
    officialJobs ? [] : selectOfficialDetailRecoveryCandidates(db, new Date(at), 1),
    tourapiJobs ? [] : selectTourApiDetailCandidates(db, new Date(at), 1),
  ]);
  dispatcherStage("READINESS_MUNICIPAL_ACTIVE_STARTED");
  const activeMunicipal = await hasActiveMunicipalMicroWork(db, at);
  let municipal = 0;
  if (!activeMunicipal) {
    dispatcherStage("READINESS_MUNICIPAL_CYCLE_STARTED");
    const today = municipalOperatingDate(at);
    const [cycle, done, verifiedPublication] = await Promise.all([
      db.prepare(
        "SELECT 1 AS pending FROM municipal_scan_cycles WHERE operating_date=? AND status<>'DONE' AND (lease_until IS NULL OR lease_until<=?) LIMIT 1",
      ).bind(today, at).first(),
      db.prepare(
        "SELECT 1 AS done FROM municipal_scan_cycles WHERE operating_date=? AND status='DONE' LIMIT 1",
      ).bind(today).first(),
      db.prepare(
        "SELECT 1 AS pending FROM municipal_detail_jobs WHERE stage='DONE' AND safe_error_category IN ('candidate_core_verified','candidate_registration_retry') AND available_at<=? AND expires_at>? LIMIT 1",
      ).bind(at, at).first(),
    ]);
    municipal = cycle || !done || verifiedPublication ? 1 : 0;
  } else {
    // `hasActiveMunicipalMicroWork` has already found a due checkpoint. The
    // dispatcher only needs a non-zero readiness value to choose this lane;
    // recounting every scan/detail row here duplicates that work immediately
    // before the one-unit municipal runner. In particular, a candidate batch
    // would pay a full UNION/COUNT on every cursor advance under Free's CPU
    // budget. Keep municipal's bounded base share and starvation guarantee,
    // while leaving per-lane backlog sizing out of this hot path.
    municipal = 1;
  }
  dispatcherStage("READINESS_COMPLETED");
  return { municipal, official: officialJobs + officialCandidates.length, tourapi: tourapiJobs + tourapiCandidates.length };
}

const productionDependencies: FairMicroDispatcherDependencies = {
  ready: fairMicroLaneReadiness,
  municipal: async (env, at) => {
    const value = await runMunicipalContinuousCycleOne(env, at);
    return { stage: value.stage, status: "status" in value ? value.status : value.stage.toLowerCase(), job_id: "job_id" in value ? value.job_id : null };
  },
  official: runOfficialDetailMicroJobOne,
  tourapi: runTourApiDetailMicroJobOne,
};

/**
 * Gives municipal three base turns per four while it is due. Other due lanes
 * receive a hard turn within FAIR_DISPATCHER_MAX_GAP dispatches; any unused
 * share is immediately reassigned to currently due work.
 */
export function chooseFairMicroLane(state: DispatcherState, ready: LaneReady): FairMicroLane | null {
  const available = lanes.filter((lane) => ready[lane] > 0);
  if (!available.length) return null;
  const overdue = available.filter((lane) => state.dispatch_count - state[columnFor(lane)] >= FAIR_DISPATCHER_MAX_GAP);
  const candidates = overdue.length ? overdue : available;
  if (!overdue.length && candidates.includes("municipal")
    && state.dispatch_count % MUNICIPAL_BASE_SHARE_DENOMINATOR < MUNICIPAL_BASE_SHARE_NUMERATOR)
    return "municipal";
  const highest = Math.max(...candidates.map((lane) => ready[lane]));
  const tied = candidates.filter((lane) => ready[lane] === highest);
  for (let offset = 0; offset < lanes.length; offset++) {
    const lane = lanes[(state.cursor + offset) % lanes.length];
    if (tied.includes(lane)) return lane;
  }
  return tied[0] ?? null;
}

/** One global lease and exactly one existing micro-engine call per invocation. */
export async function runFairMicroDispatcherOne(
  env: Env,
  at = new Date().toISOString(),
  dependencies: FairMicroDispatcherDependencies = productionDependencies,
): Promise<FairMicroDispatcherResult> {
  const db = env.DB;
  const token = crypto.randomUUID();
  const leaseUntil = plus(at, FAIR_DISPATCHER_LEASE_MS);
  const claimed = await db.prepare(
    `UPDATE fair_micro_dispatcher_state SET lease_token=?,lease_until=?,updated_at=?
     WHERE id=1 AND (lease_until IS NULL OR lease_until<=?)`,
  ).bind(token, leaseUntil, at, at).run();
  if (!(claimed.meta.changes ?? 0)) return { status: "BUSY", lane: null, stage: null, job_id: null };
  dispatcherStage("LEASE_CLAIMED");

  const state = await db.prepare("SELECT * FROM fair_micro_dispatcher_state WHERE id=1 AND lease_token=?")
    .bind(token).first<DispatcherState>();
  if (!state) return { status: "BUSY", lane: null, stage: null, job_id: null };
  let ready: LaneReady;
  try {
    ready = await dependencies.ready(env, at);
  } catch {
    // Readiness is not a dispatched turn. Release only our lease so the next
    // scheduled invocation can retry without changing fairness accounting.
    await db.prepare(
      "UPDATE fair_micro_dispatcher_state SET last_lane=NULL,last_stage='FAILED',last_status='failed',last_error_category='readiness_failed',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=1 AND lease_token=?",
    ).bind(at, token).run();
    return { status: "FAILED", lane: null, stage: null, job_id: null };
  }
  const lane = chooseFairMicroLane(state, ready);
  if (!lane) {
    await db.prepare("UPDATE fair_micro_dispatcher_state SET lease_token=NULL,lease_until=NULL,last_lane=NULL,last_stage='NO_OP',last_status='empty',last_error_category=NULL,updated_at=? WHERE id=1 AND lease_token=?")
      .bind(at, token).run();
    return { status: "NO_OP", lane: null, stage: null, job_id: null };
  }

  try {
    laneStage(lane, "selected");
    laneStage(lane, "started");
    if (lane === "municipal") dispatcherStage("MUNICIPAL_MICRO_STARTED");
    const result = await dependencies[lane](env, at);
    laneStage(lane, "finished");
    const changed = await db.prepare(
      `UPDATE fair_micro_dispatcher_state SET dispatch_count=dispatch_count+1,cursor=?,${columnFor(lane)}=dispatch_count+1,
       last_lane=?,last_stage=?,last_status=?,last_error_category=NULL,lease_token=NULL,lease_until=NULL,updated_at=?
       WHERE id=1 AND lease_token=?`,
    ).bind((lanes.indexOf(lane) + 1) % lanes.length, lane, result.stage, result.status, at, token).run();
    if (!(changed.meta.changes ?? 0)) return { status: "BUSY", lane: null, stage: null, job_id: null };
    return { status: "DONE", lane, stage: result.stage, job_id: result.job_id };
  } catch {
    // Engine errors can include provider URLs or response details; persist only a stable category.
    const category = "micro_engine_failed";
    await db.prepare(
      "UPDATE fair_micro_dispatcher_state SET dispatch_count=dispatch_count+1,cursor=?,last_lane=?,last_stage='FAILED',last_status='failed',last_error_category=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=1 AND lease_token=?",
    ).bind((lanes.indexOf(lane) + 1) % lanes.length, lane, category, at, token).run();
    return { status: "FAILED", lane, stage: "FAILED", job_id: null };
  }
}

/** Conservative capacity arithmetic for the cutover review; this does not promise an SLO. */
export function fairMicroThroughput(invocationsPerDay: number, municipalDue = true) {
  const municipalMinimum = municipalDue ? Math.floor(invocationsPerDay * MUNICIPAL_BASE_SHARE_NUMERATOR / MUNICIPAL_BASE_SHARE_DENOMINATOR) : 0;
  return {
    invocationsPerDay,
    municipalMinimum,
    municipalMaximumWhenOtherLanesIdle: municipalDue ? invocationsPerDay : 0,
    eachNonMunicipalMinimumWhenDue: Math.floor(invocationsPerDay / FAIR_DISPATCHER_MAX_GAP),
    maxDispatchGapPerDueLane: FAIR_DISPATCHER_MAX_GAP,
  };
}
