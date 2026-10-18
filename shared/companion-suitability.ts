export const COMPANION_CLASSIFIER = "deterministic_rule" as const;
export const COMPANION_RULE_VERSION = "companion_rules_v1" as const;

export type CompanionType = "child" | "couple" | "parents" | "pet";
export type SuitabilityState = "fit" | "allowed" | "conditional" | "unknown";
type Fact = {
  tag: string;
  rule_id: string | null;
  evidence_source: string | null;
  field: string | null;
};
export type CompanionSuitability = {
  companion_type: CompanionType;
  suitability_state: SuitabilityState;
  positive_reason_codes: string[];
  caution_reason_codes: string[];
  source_fact_tags: Array<{
    tag: string;
    rule_id: string | null;
    evidence_source: string | null;
    evidence_field: string | null;
  }>;
  rule_id: string;
  rule_version: typeof COMPANION_RULE_VERSION;
};

const childCombos = [
  ["experience", "education"],
  ["experience", "nature_scenery"],
  ["exhibition", "education"],
  ["traditional_history", "experience"],
  ["sports", "experience"],
];
const couplePairs = [
  [["flower_garden", "photo_spot"], "couple.flower_photo"],
  [["night_light", "photo_spot"], "couple.night_photo"],
  [["fireworks", "night_light"], "couple.fireworks_night"],
  [["nature_scenery", "photo_spot"], "couple.nature_photo"],
  [["performance", "night_light"], "couple.performance_night"],
  [["exhibition", "photo_spot"], "couple.exhibition_photo"],
  [["food", "local_specialty"], "couple.food_local"],
] as const;
const parentContent = new Set([
  "traditional_history",
  "nature_scenery",
  "performance",
  "exhibition",
  "local_specialty",
  "food",
  "flower_garden",
]);
const parentComfort = new Set([
  "seated_viewing",
  "accessibility",
  "shuttle",
  "indoor",
]);

export function classifyCompanionSuitability(
  facts: readonly Fact[],
): CompanionSuitability[] {
  const byTag = new Map(facts.map((fact) => [fact.tag, fact]));
  const has = (tag: string) => byTag.has(tag);
  const sourceFacts = (tags: string[]) =>
    tags.map((tag) => {
      const fact = byTag.get(tag);
      return {
        tag,
        rule_id: fact?.rule_id ?? null,
        evidence_source: fact?.evidence_source ?? null,
        evidence_field: fact?.field ?? null,
      };
    });
  const row = (
    companion_type: CompanionType,
    suitability_state: SuitabilityState,
    positive: string | null,
    caution: string | null,
    tags: string[],
    rule_id: string,
  ): CompanionSuitability => ({
    companion_type,
    suitability_state,
    positive_reason_codes: positive ? [positive] : [],
    caution_reason_codes: caution ? [caution] : [],
    source_fact_tags: sourceFacts(tags),
    rule_id,
    rule_version: COMPANION_RULE_VERSION,
  });

  const childFamily = has("family_program");
  const childActivity = [
    "experience",
    "education",
    "sports",
    "exhibition",
    "nature_scenery",
  ].find(has);
  const childCombo = childCombos.find((pair) => pair.every(has));
  const child = has("children_program")
    ? row(
        "child",
        "fit",
        "child.direct_children_program",
        null,
        ["children_program"],
        "companion.child.strong_children_program.v1",
      )
    : childFamily && childActivity
      ? row(
          "child",
          "fit",
          "child.family_activity_combo",
          null,
          ["family_program", childActivity],
          "companion.child.family_activity.v1",
        )
      : childFamily
        ? row(
            "child",
            "unknown",
            null,
            "child.activity_specificity_missing",
            ["family_program"],
            "companion.child.unknown_family_only.v1",
          )
        : childCombo
          ? row(
              "child",
              "unknown",
              null,
              "child.direct_audience_missing",
              childCombo,
              "companion.child.unknown_combo_without_audience.v1",
            )
          : row(
              "child",
              "unknown",
              null,
              "child.insufficient_audience_evidence",
              [],
              "companion.child.unknown.v1",
            );

  const couplePair = couplePairs.find(([pair]) => pair.every(has));
  const coupleAxes = [
    "flower_garden",
    "night_light",
    "fireworks",
    "photo_spot",
    "nature_scenery",
    "performance",
    "exhibition",
    "food",
    "local_specialty",
  ].filter(has);
  const couple =
    couplePair?.[1] === "couple.food_local"
      ? row(
          "couple",
          "unknown",
          null,
          "couple.couple_specificity_missing",
          [...couplePair[0]],
          "companion.couple.unknown_weak_combination.v1",
        )
      : couplePair
        ? row(
            "couple",
            "fit",
            couplePair[1],
            null,
            [...couplePair[0]],
            "companion.couple.combination.v1",
          )
        : coupleAxes.length === 1
          ? row(
              "couple",
              "unknown",
              null,
              "couple.multi_axis_evidence_missing",
              coupleAxes,
              "companion.couple.unknown_single_axis.v1",
            )
          : row(
              "couple",
              "unknown",
              null,
              "couple.insufficient_complementary_evidence",
              [],
              "companion.couple.unknown.v1",
            );

  const content = [...parentContent].filter(has);
  const comfort = [...parentComfort].filter(has);
  const parents =
    content.length && comfort.length
      ? row(
          "parents",
          "fit",
          "parents.content_plus_comfort",
          null,
          [content[0], comfort[0]],
          "companion.parents.content_comfort.v1",
        )
      : content.length
        ? row(
            "parents",
            "unknown",
            null,
            "parents.comfort_evidence_missing",
            [content[0]],
            "companion.parents.unknown_content_without_comfort.v1",
          )
        : row(
            "parents",
            "unknown",
            null,
            "parents.insufficient_content_evidence",
            [],
            "companion.parents.unknown.v1",
          );

  const pet = has("pet_allowed")
    ? row(
        "pet",
        "allowed",
        "pet.explicit_pet_allowed",
        null,
        ["pet_allowed"],
        "companion.pet.explicit_allowed.v1",
      )
    : row(
        "pet",
        "unknown",
        null,
        "pet.explicit_permission_missing",
        [],
        "companion.pet.unknown.v1",
      );
  return [child, couple, parents, pet];
}

export const audienceCompanionFilter = {
  kids: { companion_type: "child", suitability_state: "fit" },
  couple: { companion_type: "couple", suitability_state: "fit" },
  parents: { companion_type: "parents", suitability_state: "fit" },
  pets: { companion_type: "pet", suitability_state: "allowed" },
} as const;
