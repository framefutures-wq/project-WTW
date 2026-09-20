import assert from "node:assert/strict";
import test from "node:test";
import { MUNICIPAL_EVENTS, buildSql } from "../scripts/register-municipal-events.mjs";

test("municipal registration manifest is closed, MAIN-only and idempotent", () => {
  assert.equal(MUNICIPAL_EVENTS.length, 3);
  assert.ok(MUNICIPAL_EVENTS.every((event) => event.gate === "MAIN" && event.id.startsWith("municipal-")));
  assert.ok(MUNICIPAL_EVENTS.every((event) => event.source.url.startsWith("https://")));
  assert.doesNotMatch(buildSql(), /DELETE FROM|DROP TABLE|INSERT OR REPLACE/i);
  assert.match(buildSql(), /ON CONFLICT\(id\) DO UPDATE/);
});
