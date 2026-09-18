import type { Env } from "./env";
import { tourApiReadiness } from "./sources/tourapi";
export async function runScheduled(env: Env) {
  const id = crypto.randomUUID(),
    now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO sync_runs(id,started_at,status,provider) VALUES(?,?,?,?)",
  )
    .bind(id, now, "running", "maintenance")
    .run();
  try {
    const cutoff = new Date(Date.now() - 72 * 3600_000).toISOString();
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO event_changes(event_id,reason,before_json,after_json)
        SELECT id, '근거 확인 후 72시간 경과', '{"verification":"verified"}', '{"verification":"stale"}'
        FROM events WHERE is_sample=0 AND verification='verified' AND checked_at < ?`,
      ).bind(cutoff),
      env.DB.prepare(
        "UPDATE events SET verification='stale',updated_at=? WHERE is_sample=0 AND verification='verified' AND checked_at < ?",
      ).bind(now, cutoff),
    ]);
    await env.DB.prepare(
      "UPDATE sync_runs SET status='skipped', finished_at=?,message=?,stale_count=? WHERE id=?",
    )
      .bind(
        new Date().toISOString(),
        tourApiReadiness(env),
        results[1].meta.changes,
        id,
      )
      .run();
  } catch (error) {
    console.error("cron_failed", {
      runId: id,
      error: error instanceof Error ? error.name : "unknown",
    });
    await env.DB.prepare(
      "UPDATE sync_runs SET status='failed',finished_at=?,message=? WHERE id=?",
    )
      .bind(
        new Date().toISOString(),
        "정기 점검 실패. Worker 로그를 확인하세요.",
        id,
      )
      .run();
    throw error;
  }
}
