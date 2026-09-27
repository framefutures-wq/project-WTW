import assert from "node:assert/strict";
import test from "node:test";
import { MUNICIPAL_SOURCE_REGISTRY } from "../shared/municipal-source-registry.ts";
import {
  assertReadOnlySql,
  parseWranglerD1Rows,
  municipalStateSql,
  municipalPublishedSql,
  detailBacklogSql,
  productionMunicipalKeys,
  summarizeMunicipalSourceOutcomes,
  summarizeMunicipalRichDetail,
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

test("morning production verifier covers every municipal Registry source", () => {
  assert.deepEqual(
    [...productionMunicipalKeys].sort(),
    MUNICIPAL_SOURCE_REGISTRY.map((source) => source.key).sort(),
  );
  assert.equal(productionMunicipalKeys.length, 35);
});

test("morning production SQL stays bounded to deployed municipal sources", () => {
  const startedAt = "2026-09-27T01:00:00.000Z";
  const state = municipalStateSql(startedAt);
  const published = municipalPublishedSql(startedAt);
  const backlog = detailBacklogSql();
  for (const key of productionMunicipalKeys) {
    assert(state.includes(key));
    assert(published.includes(key));
  }
  assert(state.includes("municipal_candidate_state"));
  assert(published.includes("published_or_revalidated"));
  assert(published.includes("municipal_candidate_state"));
  assert(published.includes("events.id=state.candidate_id"));
  assert.doesNotMatch(published, /\b(?:LIKE|GLOB)\b/i);
  assert(backlog.includes("tourapi_detail_state"));
  assert(backlog.includes("retry_due"));
});

test("source outcome summary reports ok, errors, and missing Registry sources", () => {
  const [okKey, errorKey] = productionMunicipalKeys;
  const summary = summarizeMunicipalSourceOutcomes({
    municipal: {
      source_outcomes: [
        { source: okKey, status: "ok", candidates: 3 },
        {
          source: errorKey,
          status: "error",
          candidates: 0,
          reason: "network_or_timeout",
        },
        { source: "not-registered", status: "ok", candidates: 9 },
      ],
    },
  });
  assert.equal(summary.expected, 35);
  assert.equal(summary.reported, 2);
  assert.equal(summary.ok, 1);
  assert.equal(summary.error, 1);
  assert.deepEqual(summary.errors, [
    { source: errorKey, candidates: 0, reason: "network_or_timeout" },
  ]);
  assert.equal(summary.missing.length, 33);
  assert.ok(
    summary.missing.includes(
      productionMunicipalKeys[productionMunicipalKeys.length - 1],
    ),
  );
});

test("morning production SQL rejects an invalid sync timestamp", () => {
  assert.throws(() => municipalStateSql("2026-09-25'; DELETE FROM events; --"));
});


test("source outcome summary merges municipal shard messages", () => {
  const [first, second, third] = productionMunicipalKeys;
  const summary = summarizeMunicipalSourceOutcomes([
    {
      municipal: {
        source_outcomes: [{ source: first, status: "ok", candidates: 3 }],
      },
    },
    {
      municipal: {
        source_outcomes: [
          { source: second, status: "ok", candidates: 2 },
          {
            source: third,
            status: "error",
            candidates: 0,
            reason: "network_or_timeout",
          },
        ],
      },
    },
  ]);

  assert.equal(summary.reported, 3);
  assert.equal(summary.ok, 2);
  assert.equal(summary.error, 1);
  assert.equal(summary.missing.length, 32);
  assert.deepEqual(summary.errors, [
    { source: third, candidates: 0, reason: "network_or_timeout" },
  ]);
});


test("morning production summary aggregates municipal rich-detail shard metrics", () => {
  const [first, second] = productionMunicipalKeys;
  const summary = summarizeMunicipalRichDetail([
    {
      municipal: {
        rich_detail_attempted: 4,
        rich_detail_candidates: 3,
        rich_detail_persisted: 3,
        rich_detail_errors: 1,
        rich_detail_by_source: { [first]: 2, "not-registered": 9 },
      },
    },
    {
      municipal: {
        rich_detail_attempted: 2,
        rich_detail_candidates: 2,
        rich_detail_persisted: 1,
        rich_detail_errors: 0,
        rich_detail_by_source: { [first]: 1, [second]: 1 },
      },
    },
  ]);

  assert.deepEqual(summary, {
    attempted: 6,
    candidates: 5,
    persisted: 4,
    errors: 1,
    by_source: { [first]: 3, [second]: 1 },
  });
});
