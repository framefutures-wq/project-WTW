import assert from "node:assert/strict";
import test from "node:test";
import {
  assertReadOnlySql,
  parseWranglerD1Rows,
  municipalStateSql,
  municipalPublishedSql,
  detailBacklogSql,
  productionMunicipalKeys,
} from "../scripts/morning-production-check-lib.mjs";

test("morning production check accepts SELECT/WITH and rejects mutations", () => {
  assert.match(assertReadOnlySql("SELECT 1"), /^SELECT/);
  assert.match(assertReadOnlySql("WITH x AS (SELECT 1) SELECT * FROM x"), /^WITH/);
  for (const sql of [
    "UPDATE events SET title='x'",
    "DELETE FROM events",
    "INSERT INTO events(id) VALUES('x')",
    "PRAGMA table_info(events)",
  ]) {
    assert.throws(() => assertReadOnlySql(sql));
  }
});

test("morning production check parses wrangler D1 JSON rows", () => {
  assert.deepEqual(
    parseWranglerD1Rows(JSON.stringify([{ results: [{ status: "success" }] }])),
    [{ status: "success" }],
  );
  assert.throws(() => parseWranglerD1Rows("{}"));
});

test("morning production SQL stays bounded to deployed municipal sources", () => {
  const startedAt = "2026-09-25T01:00:00.000Z";
  const state = municipalStateSql(startedAt);
  const published = municipalPublishedSql(startedAt);
  const backlog = detailBacklogSql();
  for (const key of productionMunicipalKeys) {
    assert(state.includes(key));
    assert(published.includes(key));
  }
  assert(state.includes("municipal_candidate_state"));
  assert(published.includes("published_or_revalidated"));
  assert(backlog.includes("tourapi_detail_state"));
  assert(backlog.includes("retry_due"));
});

test("morning production SQL rejects an invalid sync timestamp", () => {
  assert.throws(() => municipalStateSql("2026-09-25'; DELETE FROM events; --"));
});
