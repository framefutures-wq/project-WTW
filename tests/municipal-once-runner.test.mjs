import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("municipal one-shot is nonce-protected and requires an explicit production shard plan", () => {
  const worker = readFileSync("scripts/municipal-once-worker.ts", "utf8");
  assert.match(worker, /request\.method !== "POST"/);
  assert.match(worker, /x-manual-municipal-nonce/);
  assert.match(worker, /x-manual-municipal-shard/);
  assert.match(worker, /MUNICIPAL_DAILY_SHARD_COUNT/);
  assert.match(worker, /municipalRunPlan\(registryKeys, shardIndex\)/);
  assert.match(worker, /runMunicipalAutonomous\(env, plan\)/);
  assert.doesNotMatch(worker, /runMunicipalAutonomous\(env\)/);
  assert.doesNotMatch(
    worker,
    /runScheduled|runDetailScheduled|runTourApi|runPrivate/,
  );
});

test("municipal one-shot preserves production D1 and AI configuration while disabling TourAPI", () => {
  const runner = readFileSync("scripts/run-municipal-once.mjs", "utf8");
  assert.match(runner, /d1_databases: config\.d1_databases/);
  assert.match(runner, /ai: config\.ai/);
  assert.match(
    runner,
    /vars: \{[\s\S]*TOUR_API_ENABLED: "false"[\s\S]*MANUAL_MUNICIPAL_NONCE: nonce/,
  );
  assert.match(runner, /--preview-alias/);
  assert.match(runner, /--remote/);
  assert.match(runner, /missingObservedSourceKeys/);
  assert.match(runner, /richDetailBackfilledEvents/);
  assert.match(runner, /municipal_rich_detail\.contact_phone/);
});

test("municipal one-shot defaults to three isolated shard requests and supports targeted retry", () => {
  const runner = readFileSync("scripts/run-municipal-once.mjs", "utf8");
  assert.match(runner, /: \[0, 1, 2\]/);
  assert.match(runner, /--shard=/);
  assert.match(runner, /for \(const shardIndex of requestedShards\)/);
  assert.match(runner, /"x-manual-municipal-shard": String\(shardIndex\)/);
  assert.match(runner, /manual shard coverage mismatch/);
  assert.match(runner, /registrySourceCount/);
  assert.doesNotMatch(
    runner,
    /const registryKeys = \["paju", "suwon", "goyang"/,
  );
});
