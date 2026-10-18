import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("municipal source diagnostic is read-only and bounded to the deployed batch", () => {
  const script = readFileSync("scripts/municipal-source-diagnostic.mjs", "utf8");
  for (const key of ["gyeonggi-과천", "gyeonggi-하남", "gyeongbuk-상주"]) {
    assert.match(script, new RegExp(key));
  }
  assert.doesNotMatch(script, /wrangler\s+d1|env\.DB|INSERT|UPDATE|DELETE|runMunicipalAutonomous|manual ingestion/i);
  assert.match(script, /AbortSignal\.timeout/);
  assert.match(script, /production_write:\s*false/);
  assert.match(script, /d1_access:\s*false/);
});
