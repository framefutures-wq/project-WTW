import type { Env } from "./env";
import { tourApiReadiness, syncTourApi } from "./sources/tourapi";
import { runMunicipalAutonomous } from "./sources/municipal";
import { processPushDeliveries } from "./push";
export async function runScheduled(env: Env) {
  let municipalAttempted = false;
  const id = crypto.randomUUID(),
    now = new Date().toISOString();
  const started = await env.DB.prepare(
    "INSERT INTO sync_runs(id,started_at,status,provider) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM sync_runs WHERE status='running' AND started_at>?)",
  )
    .bind(
      id,
      now,
      "running",
      env.TOUR_API_ENABLED === "true" ? "tourapi" : "maintenance",
      new Date(Date.now() - 3600_000).toISOString(),
    )
    .run();
  if (!started.meta.changes) {
    try { await processPushDeliveries(env); }
    catch (error) { console.error("push_delivery_failed", { runId: id, error: error instanceof Error ? error.name : "unknown" }); }
    return;
  }
  try {
    const cutoff = new Date(Date.now() - 72 * 3600_000).toISOString();
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO event_changes(event_id,reason,before_json,after_json)
        SELECT id, '근거 확인 후 72시간 경과', '{"verification":"verified"}', '{"verification":"stale"}'
        FROM events WHERE is_sample=0 AND verification='verified' AND checked_at < ? AND NOT EXISTS (SELECT 1 FROM sources ms WHERE ms.id=events.primary_source_id AND ms.kind='municipality')`,
      ).bind(cutoff),
      env.DB.prepare(
        "UPDATE events SET verification='stale',updated_at=? WHERE is_sample=0 AND verification='verified' AND checked_at < ? AND NOT EXISTS (SELECT 1 FROM sources ms WHERE ms.id=events.primary_source_id AND ms.kind='municipality')",
      ).bind(now, cutoff),
    ]);
    const imported = await syncTourApi(env, id);
    municipalAttempted = true;
    const municipal = await runMunicipalAutonomous(env);
    await env.DB.prepare(
      "UPDATE sync_runs SET status=?, finished_at=?,message=?,stale_count=? WHERE id=?",
    )
      .bind(
        imported ? "success" : "skipped",
        new Date().toISOString(),
        JSON.stringify({ tourapi: imported ?? tourApiReadiness(env), municipal }),
        results[1].meta.changes,
        id,
      )
      .run();
  } catch (error) {
    // Municipal sources are independently bounded; a TourAPI outage must not stop their daily retry/publish cycle.
    const municipal = municipalAttempted ? { skipped: "already_attempted" } : (municipalAttempted = true, await runMunicipalAutonomous(env));
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
      .bind(new Date().toISOString(), JSON.stringify({ tourapi: message, municipal }), id)
      .run();
    // An upstream error must not be rethrown with a potentially secret-bearing URL.
    throw new Error("Scheduled synchronization failed");
  } finally {
    // Notification transport must never decide whether official event ingestion succeeds.
    try { await processPushDeliveries(env); }
    catch (error) { console.error("push_delivery_failed", { runId: id, error: error instanceof Error ? error.name : "unknown" }); }
  }
}
