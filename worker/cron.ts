import { koreaDate } from "../shared/domain";
import type { Env } from "./env";
import { tourApiReadiness, syncTourApi } from "./sources/tourapi";
import { enrichTourApiDetails } from "./sources/tourapi-detail";
import { runMunicipalAutonomous } from "./sources/municipal";
import { runPrivateOfficialSources } from "./sources/private-official";
import { processPushDeliveries } from "./push";
import { trustedPrivateLkgSources } from "../shared/private-official-sources";
const privateLkgClause = (alias: string) => {
  const entries = trustedPrivateLkgSources();
  if (!entries.length) return "0";
  return entries
    .map(
      (source) =>
        `(${alias}.kind='organizer' AND ${alias}.id LIKE '${source.sourceIdPrefix}%' AND (${source.allowedHosts.map((host) => `${alias}.url LIKE 'https://${host}/%'`).join(" OR ")}))`,
    )
    .join(" OR ");
};
const LKG_PRIMARY_SOURCE = `(ms.kind='municipality' OR (${privateLkgClause("ms")}))`;
export const BASE_SYNC_CRON = "0 1 * * *";
export const DETAIL_SYNC_CRON = "0 2 * * *";

export type ScheduledDependencies = {
  syncTourApi: typeof syncTourApi;
  enrichTourApiDetails: typeof enrichTourApiDetails;
  runMunicipalAutonomous: typeof runMunicipalAutonomous;
  runPrivateOfficialSources: typeof runPrivateOfficialSources;
  processPushDeliveries: typeof processPushDeliveries;
};
const productionDependencies: ScheduledDependencies = {
  syncTourApi,
  enrichTourApiDetails,
  runMunicipalAutonomous,
  runPrivateOfficialSources,
  processPushDeliveries,
};
function baseWindow(now: Date) {
  // A KST operating date starts at 10:00 KST (01:00 UTC); ISO timestamps sort safely in D1.
  const start = new Date(`${koreaDate(now)}T01:00:00.000Z`);
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 3600_000).toISOString(),
  };
}
async function startRun(
  env: Env,
  provider: "tourapi" | "tourapi-detail",
  now: string,
) {
  const id = crypto.randomUUID();
  const started = await env.DB.prepare(
    "INSERT INTO sync_runs(id,started_at,status,provider) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM sync_runs WHERE provider=? AND status='running' AND started_at>?)",
  )
    .bind(
      id,
      now,
      "running",
      provider,
      provider,
      new Date(Date.parse(now) - 3600_000).toISOString(),
    )
    .run();
  return started.meta.changes ? id : null;
}

export async function runBaseScheduled(
  env: Env,
  now = new Date(),
  dependencies = productionDependencies,
) {
  let municipalAttempted = false;
  const startedAt = now.toISOString();
  const id = await startRun(env, "tourapi", startedAt);
  if (!id) {
    try {
      await dependencies.processPushDeliveries(env);
    } catch (error) {
      console.error("push_delivery_failed", {
        runId: id,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
    return { skipped: "base_already_running" };
  }
  try {
    const cutoff = new Date(now.getTime() - 72 * 3600_000).toISOString();
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO event_changes(event_id,reason,before_json,after_json)
        SELECT id, '근거 확인 후 72시간 경과', '{"verification":"verified"}', '{"verification":"stale"}'
        FROM events WHERE is_sample=0 AND verification='verified' AND checked_at < ? AND NOT EXISTS (SELECT 1 FROM sources ms WHERE ms.id=events.primary_source_id AND ${LKG_PRIMARY_SOURCE})`,
      ).bind(cutoff),
      env.DB.prepare(
        `UPDATE events SET verification='stale',updated_at=? WHERE is_sample=0 AND verification='verified' AND checked_at < ? AND NOT EXISTS (SELECT 1 FROM sources ms WHERE ms.id=events.primary_source_id AND ${LKG_PRIMARY_SOURCE})`,
      ).bind(startedAt, cutoff),
    ]);
    const imported = await dependencies.syncTourApi(env, id);
    municipalAttempted = true;
    const municipal = await dependencies.runMunicipalAutonomous(env);
    const privateOfficial = await dependencies.runPrivateOfficialSources(env);
    const baseStatus = imported ? "success" : "skipped";
    await env.DB.prepare(
      "UPDATE sync_runs SET status=?, finished_at=?,message=?,stale_count=? WHERE id=?",
    )
      .bind(
        baseStatus,
        new Date().toISOString(),
        JSON.stringify({
          tourapi: imported ?? tourApiReadiness(env),
          municipal,
          private: privateOfficial,
        }),
        results[1].meta.changes,
        id,
      )
      .run();

    let detailHandoff:
      | Awaited<ReturnType<typeof runDetailScheduled>>
      | { status: "failed"; reason: "subsystem_error" }
      | { skipped: "base_not_successful" } = {
      skipped: "base_not_successful",
    };
    if (baseStatus === "success") {
      try {
        // Do not wait for the 11:00 watchdog. Start the bounded detail pass as soon
        // as the 10:00 base run has committed its success marker.
        detailHandoff = await runDetailScheduled(
          env,
          now,
          dependencies,
          "base_handoff",
        );
      } catch (error) {
        // Detail is an isolated subsystem: its failure must never turn a
        // successfully completed base ingestion into a failed base run.
        console.error("tourapi_detail_handoff_failed", {
          baseRunId: id,
          error: error instanceof Error ? error.name : "unknown",
        });
        detailHandoff = { status: "failed", reason: "subsystem_error" };
      }
    }
    return { id, status: baseStatus, detail_handoff: detailHandoff };
  } catch (error) {
    // Municipal sources are independently bounded; a TourAPI outage must not stop their daily retry/publish cycle.
    const municipal = municipalAttempted
      ? { skipped: "already_attempted" }
      : ((municipalAttempted = true),
        await dependencies.runMunicipalAutonomous(env));
    const privateOfficial = await dependencies.runPrivateOfficialSources(env);
    const message =
      error instanceof Error && error.message.startsWith("TourAPI ")
        ? error.message
        : "정기 점검 실패. Worker 로그를 확인하세요.";
    console.error("cron_failed", {
      runId: id,
      error: error instanceof Error ? error.name : "unknown",
    });
    await env.DB.prepare(
      "UPDATE sync_runs SET status='failed',finished_at=?,message=? WHERE id=?",
    )
      .bind(
        new Date().toISOString(),
        JSON.stringify({
          tourapi: message,
          municipal,
          private: privateOfficial,
        }),
        id,
      )
      .run();
    // An upstream error must not be rethrown with a potentially secret-bearing URL.
    throw new Error("Scheduled synchronization failed");
  } finally {
    // Notification transport must never decide whether official event ingestion succeeds.
    try {
      await dependencies.processPushDeliveries(env);
    } catch (error) {
      console.error("push_delivery_failed", {
        runId: id,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
}

export async function runDetailScheduled(
  env: Env,
  now = new Date(),
  dependencies = productionDependencies,
  trigger: "base_handoff" | "watchdog" = "watchdog",
) {
  const window = baseWindow(now);
  const base = await env.DB.prepare(
    "SELECT id,status,started_at,finished_at FROM sync_runs WHERE provider='tourapi' AND started_at>=? AND started_at<? ORDER BY started_at DESC LIMIT 1",
  )
    .bind(window.start, window.end)
    .first<{
      id: string;
      status: string;
      started_at: string;
      finished_at: string | null;
    }>();
  const id = crypto.randomUUID();
  const skipped = async (reason: string) => {
    await env.DB.prepare(
      "INSERT INTO sync_runs(id,started_at,finished_at,status,provider,message) VALUES(?,?,?,?,?,?)",
    )
      .bind(
        id,
        now.toISOString(),
        now.toISOString(),
        "skipped",
        "tourapi-detail",
        JSON.stringify({
          trigger,
          reason,
          base_run: base ?? null,
          candidates: 0,
          requested: 0,
          enriched: 0,
          empty: 0,
          failed: 0,
        }),
      )
      .run();
    return { id, status: "skipped", reason };
  };
  if (!base) return skipped("base_run_missing");
  if (base.status === "running") return skipped("base_run_running");
  if (base.status !== "success" || !base.finished_at)
    return skipped("base_run_not_successful");
  const started = await startRun(env, "tourapi-detail", now.toISOString());
  if (!started) return skipped("detail_already_running");
  try {
    const detail = await dependencies.enrichTourApiDetails(env);
    await env.DB.prepare(
      "UPDATE sync_runs SET status='success',finished_at=?,message=? WHERE id=?",
    )
      .bind(
        new Date().toISOString(),
        JSON.stringify({ trigger, base_run: base.id, ...detail }),
        started,
      )
      .run();
    return { id: started, status: "success", detail };
  } catch (error) {
    console.error("tourapi_detail_subsystem_failed", {
      runId: started,
      error: error instanceof Error ? error.name : "unknown",
    });
    await env.DB.prepare(
      "UPDATE sync_runs SET status='failed',finished_at=?,message=? WHERE id=?",
    )
      .bind(
        new Date().toISOString(),
        JSON.stringify({
          trigger,
          base_run: base.id,
          candidates: 0,
          requested: 0,
          enriched: 0,
          empty: 0,
          failed: 1,
          reason: "subsystem_error",
        }),
        started,
      )
      .run();
    throw new Error("TourAPI detail enrichment failed");
  }
}

export async function runScheduled(
  env: Env,
  cron: string,
  now = new Date(),
  dependencies = productionDependencies,
) {
  if (cron === BASE_SYNC_CRON) return runBaseScheduled(env, now, dependencies);
  if (cron === DETAIL_SYNC_CRON)
    return runDetailScheduled(env, now, dependencies, "watchdog");
  console.warn("unknown_scheduled_cron", { cron });
  return { skipped: "unknown_cron" };
}
