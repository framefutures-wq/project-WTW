import type { Env } from "../env";
import { MUNICIPAL_SOURCE_REGISTRY } from "../../shared/municipal-source-registry";
import { runMunicipalMicroJobOne } from "./municipal-micro-scheduler";
import { seedMunicipalDailyScanOne } from "./municipal";

type Cycle = {
  id: string;
  operating_date: string;
  status: "ACTIVE" | "WAITING" | "DONE";
  source_cursor: number;
  source_count: number;
  lease_until: string | null;
  seed_attempt_count: number;
};

export const municipalOperatingDate = (at: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));

/** Future retries are active: source advancement waits for completion or expiry. */
export async function hasActiveMunicipalMicroWork(db: Env["DB"], at: string) {
  const scan = await db.prepare(
    `SELECT 1 AS active FROM municipal_scan_jobs
     WHERE (stage IN ('LIST_PENDING','CANDIDATE_PENDING','RETRY') OR
       (page_index=1 AND stage='DONE' AND source_finalized_at IS NULL
        AND candidate_batch_json IS NOT NULL AND safe_error_category IS NULL))
       AND expires_at>? LIMIT 1`,
  ).bind(at).first();
  if (scan) return true;
  const detail = await db.prepare(
    `SELECT 1 AS active FROM municipal_detail_jobs
     WHERE stage IN ('FETCH_PENDING','PARSE_PENDING','PERSIST_PENDING','RETRY') AND expires_at>? LIMIT 1`,
  ).bind(at).first();
  return Boolean(detail);
}

export type MunicipalContinuousCycleResult =
  | { stage: "MICRO"; unit: string; status: string; job_id: string | null }
  | { stage: "WAITING_RETRY" | "WAITING_CYCLE" | "NO_OP" | "CYCLE_DONE"; operating_date: string | null }
  | { stage: "SOURCE_SEED" | "SOURCE_SKIPPED"; operating_date: string; source_key: string | null; source_cursor: number };

type ContinuousCycleDependencies = {
  runMicro: typeof runMunicipalMicroJobOne;
  seedOne: typeof seedMunicipalDailyScanOne;
};
const productionDependencies: ContinuousCycleDependencies = {
  runMicro: runMunicipalMicroJobOne,
  seedOne: seedMunicipalDailyScanOne,
};

/** One invocation performs one micro unit, one source seed, or one cycle transition. */
export async function runMunicipalContinuousCycleOne(
  env: Env,
  at = new Date().toISOString(),
  dependencies: ContinuousCycleDependencies = productionDependencies,
): Promise<MunicipalContinuousCycleResult> {
  const micro = await dependencies.runMicro(env);
  if (micro.stage !== "NO_OP")
    return { stage: "MICRO", unit: micro.stage, status: micro.status, job_id: micro.job_id };

  const db = env.DB;
  if (await hasActiveMunicipalMicroWork(db, at)) {
    await db.prepare(
      "UPDATE municipal_scan_cycles SET status='WAITING',updated_at=? WHERE status='ACTIVE'",
    ).bind(at).run();
    return { stage: "WAITING_RETRY", operating_date: null };
  }

  const today = municipalOperatingDate(at);
  let cycle = await db.prepare(
    "SELECT * FROM municipal_scan_cycles WHERE status IN ('ACTIVE','WAITING') ORDER BY created_at,id LIMIT 1",
  ).first<Cycle>();
  if (!cycle) {
    const existing = await db.prepare(
      "SELECT * FROM municipal_scan_cycles WHERE operating_date=?",
    ).bind(today).first<Cycle>();
    if (existing?.status === "DONE") return { stage: "NO_OP", operating_date: today };
    if (existing) cycle = existing;
    else {
      const id = `municipal-cycle-${today}`;
      await db.prepare(
        `INSERT OR IGNORE INTO municipal_scan_cycles
         (id,operating_date,status,source_cursor,source_count,created_at,updated_at)
         VALUES(?,?,'ACTIVE',0,?,?,?)`,
      ).bind(id, today, MUNICIPAL_SOURCE_REGISTRY.length, at, at).run();
      cycle = await db.prepare("SELECT * FROM municipal_scan_cycles WHERE id=?")
        .bind(id).first<Cycle>();
      if (!cycle) throw new Error("municipal_cycle_create_failed");
    }
  }

  const lease = new Date(Date.parse(at) + 120_000).toISOString();
  const claimed = await db.prepare(
    `UPDATE municipal_scan_cycles SET lease_until=?,status='ACTIVE',updated_at=?
     WHERE id=? AND source_cursor=? AND status IN ('ACTIVE','WAITING')
       AND (lease_until IS NULL OR lease_until<=?)`,
  ).bind(lease, at, cycle.id, cycle.source_cursor, at).run();
  if (!(claimed.meta.changes ?? 0))
    return { stage: "WAITING_CYCLE", operating_date: cycle.operating_date };

  if (cycle.source_cursor >= cycle.source_count) {
    await db.prepare(
      `UPDATE municipal_scan_cycles SET status='DONE',lease_until=NULL,completed_at=?,updated_at=?
       WHERE id=? AND source_cursor=? AND lease_until=?`,
    ).bind(at, at, cycle.id, cycle.source_cursor, lease).run();
    return { stage: "CYCLE_DONE", operating_date: cycle.operating_date };
  }

  try {
    const seeded = await dependencies.seedOne(db, {
      operatingDate: cycle.operating_date,
      sourceCursor: cycle.source_cursor,
      now: at,
    });
    const advanced = await db.prepare(
      `UPDATE municipal_scan_cycles SET source_cursor=source_cursor+1,seed_attempt_count=0,
       lease_until=NULL,last_error_category=NULL,updated_at=?
       WHERE id=? AND source_cursor=? AND lease_until=?`,
    ).bind(at, cycle.id, cycle.source_cursor, lease).run();
    if (!(advanced.meta.changes ?? 0)) throw new Error("municipal_cycle_advance_failed");
    return {
      stage: "SOURCE_SEED",
      operating_date: cycle.operating_date,
      source_key: seeded.source_key,
      source_cursor: cycle.source_cursor,
    };
  } catch (error) {
    const attempts = cycle.seed_attempt_count + 1;
    await db.prepare(
      `UPDATE municipal_scan_cycles SET source_cursor=source_cursor+?,seed_attempt_count=?,
       last_error_category='source_seed_failed',lease_until=NULL,updated_at=?
       WHERE id=? AND source_cursor=? AND lease_until=?`,
    ).bind(attempts >= 3 ? 1 : 0, attempts >= 3 ? 0 : attempts, at, cycle.id, cycle.source_cursor, lease).run();
    if (attempts < 3) throw error;
    return {
      stage: "SOURCE_SKIPPED",
      operating_date: cycle.operating_date,
      source_key: MUNICIPAL_SOURCE_REGISTRY[cycle.source_cursor]?.key ?? null,
      source_cursor: cycle.source_cursor,
    };
  }
}
