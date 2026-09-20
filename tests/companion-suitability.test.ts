import assert from "node:assert/strict";
import test from "node:test";
import {
  audienceCompanionFilter,
  classifyCompanionSuitability,
} from "../shared/companion-suitability";

const facts = (...tags: string[]) =>
  tags.map((tag) => ({
    tag,
    rule_id: `fact.${tag}.v1`,
    evidence_source: "tourapi-source",
    field: "program",
  }));
const result = (tags: string[], companion: string) =>
  classifyCompanionSuitability(facts(...tags)).find(
    (row) => row.companion_type === companion,
  )!;

test("companion_rules_v1 preserves the Phase 4-1 positive evidence rules", () => {
  const child = result(["children_program"], "child");
  assert.equal(child.suitability_state, "fit");
  assert.deepEqual(child.positive_reason_codes, [
    "child.direct_children_program",
  ]);

  const couple = result(["performance", "night_light"], "couple");
  assert.equal(couple.suitability_state, "fit");
  assert.deepEqual(couple.positive_reason_codes, ["couple.performance_night"]);

  const parents = result(["exhibition", "indoor"], "parents");
  assert.equal(parents.suitability_state, "fit");
  assert.deepEqual(
    parents.source_fact_tags.map((fact) => fact.tag),
    ["exhibition", "indoor"],
  );

  const pet = result(["pet_allowed"], "pet");
  assert.equal(pet.suitability_state, "allowed");
  assert.deepEqual(pet.positive_reason_codes, ["pet.explicit_pet_allowed"]);
});

test("unknown and conditional states are not audience filter positives", () => {
  assert.equal(
    result(["food", "local_specialty"], "couple").suitability_state,
    "unknown",
  );
  assert.equal(result(["nature_scenery"], "pet").suitability_state, "unknown");
  assert.deepEqual(audienceCompanionFilter, {
    kids: { companion_type: "child", suitability_state: "fit" },
    couple: { companion_type: "couple", suitability_state: "fit" },
    parents: { companion_type: "parents", suitability_state: "fit" },
    pets: { companion_type: "pet", suitability_state: "allowed" },
  });
});
