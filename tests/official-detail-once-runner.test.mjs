import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("official detail one-shot is nonce-protected and bounded", () => {
  const worker = readFileSync("scripts/official-detail-once-worker.ts", "utf8");
  const runner = readFileSync("scripts/run-official-detail-once.mjs", "utf8");
  assert.match(worker, /x-manual-official-detail-nonce/);
  assert.match(worker, /rawLimit > 20/);
  assert.match(worker, /runOfficialDetailRecovery/);
  assert.match(runner, /--passes=1\.\.10/);
  assert.match(runner, /--limit=1\.\.20/);
  assert.match(runner, /--preview-alias/);
  assert.match(runner, /x-manual-official-detail-nonce/);
});
