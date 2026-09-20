import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("public UI does not render or generate the cost filter", () => {
  const source = readFileSync("src/App.tsx", "utf8");
  assert.equal(source.includes('aria-label="비용"'), false);
  assert.equal(source.includes("USER_COST_FILTERS"), false);
  assert.equal(source.includes("setCost"), false);
  assert.equal(source.includes("cost ? COST_STATUS_LABELS"), false);
});
