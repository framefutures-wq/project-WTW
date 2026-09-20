import assert from "node:assert/strict";
import test from "node:test";
import { runMunicipalAutonomous } from "../worker/sources/municipal.ts";

test("persisted retry publishes from its detail snapshot when discovery no longer contains it", async () => {
  const writes = [], originalFetch = globalThis.fetch;
  const retry = { candidate_id: "municipal-paju-940", source_key: "paju", source_candidate_id: "940", title_snapshot: "2026 문산거리축제", start_date_snapshot: "2026-10-03", end_date_snapshot: "2026-10-04", venue_snapshot: "문산천", locality_snapshot: "파주", official_url_snapshot: "https://detail.test/paju", first_seen_at: "2026-09-20T00:00:00.000Z", retry_until: "2026-10-20T00:00:00.000Z", last_payload_hash: "old" };
  const db = { prepare(sql) { const statement = { args: [], bind(...args) { this.args = args; return this; }, async all() { if (sql.includes("FROM municipal_candidate_state WHERE decision_state='AUTO_RETRY'")) return { results: [retry], meta: { rows_read: 1 } }; return { results: [], meta: { rows_read: 0 } }; }, async first() { return null; }, async run() { writes.push(sql); return { meta: { changes: 1 } }; } }; return statement; }, async batch(statements) { writes.push(...statements.map(() => "publish")); return statements.map(() => ({ meta: { changes: 1 } })); } };
  globalThis.fetch = async (url) => new Response(String(url).includes("detail.test") ? "2026 문산거리축제 행사 : 2026-10-03 ~ 2026-10-04 장소: 문산천" : "list-info", { status: 200 });
  try {
    const result = await runMunicipalAutonomous({ DB: db, APP_MODE: "production", TOUR_API_ENABLED: "false", ASSETS: {} });
    assert.equal(result.AUTO_PUBLISH, 1);
    assert.ok(writes.includes("publish"));
  } finally { globalThis.fetch = originalFetch; }
});
