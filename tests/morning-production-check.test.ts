import assert from "node:assert/strict";
import test from "node:test";
import { MUNICIPAL_SOURCE_REGISTRY } from "../shared/municipal-source-registry";
import {
  municipalStateSql,
  productionMunicipalKeys,
  summarizeMunicipalSourceOutcomes,
} from "../scripts/morning-production-check-lib.mjs";

test("morning production verifier covers every municipal Registry source", () => {
  assert.deepEqual(
    [...productionMunicipalKeys].sort(),
    MUNICIPAL_SOURCE_REGISTRY.map((source) => source.key).sort(),
  );
  assert.equal(productionMunicipalKeys.length, 35);
});

test("all-source municipal SQL stays read-only and includes every Registry key", () => {
  const sql = municipalStateSql("2026-09-27T01:00:00.000Z");
  assert.match(sql, /^WITH\b/i);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b/i);
  for (const key of productionMunicipalKeys) assert.ok(sql.includes(key), key);
});

test("source outcome summary reports ok, errors, and missing Registry sources", () => {
  const [okKey, errorKey] = productionMunicipalKeys;
  const summary = summarizeMunicipalSourceOutcomes({
    municipal: {
      source_outcomes: [
        { source: okKey, status: "ok", candidates: 3 },
        { source: errorKey, status: "error", candidates: 0, reason: "network_or_timeout" },
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
  assert.ok(summary.missing.includes(productionMunicipalKeys.at(-1)));
});
