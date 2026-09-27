import assert from "node:assert/strict";
import test from "node:test";
import { MUNICIPAL_SOURCE_REGISTRY } from "../shared/municipal-source-registry";
import {
  MUNICIPAL_DAILY_SHARD_COUNT,
  municipalRunPlan,
} from "../shared/municipal-run-plan";

test("daily municipal plan covers all 35 Registry sources exactly once", () => {
  const keys = MUNICIPAL_SOURCE_REGISTRY.map((source) => source.key);
  const plans = Array.from({ length: MUNICIPAL_DAILY_SHARD_COUNT }, (_, index) =>
    municipalRunPlan(keys, index),
  );
  const flattened = plans.flatMap((plan) => plan.sourceKeys);

  assert.deepEqual(plans.map((plan) => plan.sourceKeys.length), [12, 12, 11]);
  assert.equal(flattened.length, 35);
  assert.equal(new Set(flattened).size, 35);
  assert.deepEqual(flattened, keys);
});

test("daily municipal plan preserves the global mutation breaker and bounded fetches", () => {
  const keys = MUNICIPAL_SOURCE_REGISTRY.map((source) => source.key);
  const plans = Array.from({ length: MUNICIPAL_DAILY_SHARD_COUNT }, (_, index) =>
    municipalRunPlan(keys, index),
  );

  assert.equal(
    plans.reduce((total, plan) => total + plan.maxPublishMutations, 0),
    10,
  );
  assert(plans.every((plan) => plan.maxExternalFetches === 35));
  assert.deepEqual(
    plans.map((plan) => plan.maxDetailFetches),
    [12, 12, 11],
  );
  assert(plans.every((plan) => plan.maxRetryCandidates <= 4));
});

test("municipal plan rejects invalid shard indexes", () => {
  const keys = MUNICIPAL_SOURCE_REGISTRY.map((source) => source.key);
  assert.throws(() => municipalRunPlan(keys, -1));
  assert.throws(() => municipalRunPlan(keys, MUNICIPAL_DAILY_SHARD_COUNT));
});
