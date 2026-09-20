import assert from "node:assert/strict";
import test from "node:test";
import { decideAutonomousMunicipal } from "../shared/municipal-autonomous";

const valid = { gate: "MAIN" as const, duplicate: "NEW" as const, temporal: "UPCOMING" as const, trusted: true, coreValid: true };
test("autonomous decision publishes only complete trusted MAIN + NEW candidates", () => {
  assert.equal(decideAutonomousMunicipal(valid).state, "AUTO_PUBLISH");
  assert.equal(decideAutonomousMunicipal({ ...valid, parserError: true }).state, "AUTO_RETRY");
  assert.equal(decideAutonomousMunicipal({ ...valid, coreConflict: true }).state, "AUTO_RETRY");
  assert.equal(decideAutonomousMunicipal({ ...valid, duplicate: "LIKELY_DUPLICATE" }).state, "AUTO_RETRY");
  assert.equal(decideAutonomousMunicipal({ ...valid, gate: "EXCLUDE" }).state, "AUTO_EXCLUDE");
  assert.equal(decideAutonomousMunicipal({ ...valid, gate: "NEARBY_ONLY" }).state, "POLICY_SKIP");
  assert.equal(decideAutonomousMunicipal({ ...valid, temporal: "EXPIRED" }).state, "EXPIRED");
});
