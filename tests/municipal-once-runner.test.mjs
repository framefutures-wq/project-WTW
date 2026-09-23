import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("municipal one-shot is nonce-protected and invokes only municipal autonomous ingestion", () => {
  const worker = readFileSync("scripts/municipal-once-worker.ts", "utf8");
  assert.match(worker, /request\.method !== "POST"/);
  assert.match(worker, /x-manual-municipal-nonce/);
  assert.match(worker, /runMunicipalAutonomous\(env\)/);
  assert.doesNotMatch(worker, /runScheduled|runDetailScheduled|runTourApi|runPrivate/);
});

test("municipal one-shot preserves production D1 and AI configuration while disabling TourAPI", () => {
  const runner = readFileSync("scripts/run-municipal-once.mjs", "utf8");
  assert.match(runner, /d1_databases: config\.d1_databases/);
  assert.match(runner, /ai: config\.ai/);
  assert.match(runner, /vars: \{ \.\.\.config\.vars, TOUR_API_ENABLED: "false"/);
  assert.match(runner, /--preview-alias/);
  assert.match(runner, /--remote/);
  assert.match(runner, /missingObservedSourceKeys/);
});
