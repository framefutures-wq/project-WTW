import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("municipal one-shot is nonce-protected and requires an explicit production shard plan", () => {
  const worker = readFileSync("scripts/municipal-once-worker.ts", "utf8");
  assert.match(worker, /request\.method !== "POST"/);
  assert.match(worker, /x-manual-municipal-nonce/);
  assert.match(worker, /x-manual-municipal-shard/);
  assert.match(worker, /x-manual-municipal-source/);
  assert.match(worker, /decodeURIComponent\(rawSource\)/);
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
  assert.match(runner, /--source=/);
  assert.match(runner, /requestedSource/);
  assert.match(runner, /x-manual-municipal-source:/);
  assert.match(runner, /encodeURIComponent\(sourceKey\)/);
  assert.match(runner, /for \(const shardIndex of requestedShards\)/);
  assert.match(runner, /postShard\(url, shardIndex\)/);
  assert.match(runner, /spawnSync\(\s*"curl"/);
  assert.match(runner, /--max-time/);
  assert.match(runner, /x-manual-municipal-shard:/);
  assert.doesNotMatch(runner, /AbortSignal\.timeout\(14 \* 60_000\)/);
  assert.match(runner, /manual shard coverage mismatch/);
  assert.match(runner, /registrySourceCount/);
  assert.doesNotMatch(
    runner,
    /const registryKeys = \["paju", "suwon", "goyang"/,
  );
});


test("municipal manual verification is read-only and avoids dynamic LIKE patterns", () => {
  const runner = readFileSync("scripts/run-municipal-once.mjs", "utf8");
  const verifier = readFileSync(
    "scripts/verify-municipal-manual.mjs",
    "utf8",
  );

  assert.doesNotMatch(
    runner,
    /events\.primary_source_id LIKE\s*\n?\s*['"]municipal-source-municipal-/,
  );
  assert.match(runner, /instr\(\s*events\.primary_source_id/);

  assert.match(verifier, /mode: "read-only"/);
  assert.match(verifier, /--remote/);
  assert.match(verifier, /instr\(\s*events\.primary_source_id/);
  assert.match(verifier, /달빛 한가위 마당/);
  assert.doesNotMatch(
    verifier,
    /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i,
  );
});


test("municipal one-shot preserves structured preview-worker failure details", () => {
  const worker = readFileSync("scripts/municipal-once-worker.ts", "utf8");
  const runner = readFileSync("scripts/run-municipal-once.mjs", "utf8");

  assert.match(worker, /manual_municipal_shard_failed/);
  assert.match(worker, /error: \{\s*message,\s*stack/);
  assert.match(runner, /parsed\?\.error\?\.message/);
  assert.match(runner, /\[curl\]/);
});
