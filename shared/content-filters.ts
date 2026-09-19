import { FACT_TAG_RULES, type FactTag } from "./fact-tags";

/** User-facing content filters. queryValue remains the existing API contract. */
export const USER_CONTENT_FILTERS = [
  { queryValue: "food", label: "먹거리", factTags: ["food"] },
  { queryValue: "fireworks", label: "불꽃", factTags: ["fireworks"] },
  {
    queryValue: "flowers",
    label: "꽃",
    factTags: ["flower_garden"],
  },
  { queryValue: "experience", label: "체험", factTags: ["experience"] },
  {
    queryValue: "performance",
    label: "공연",
    factTags: ["performance"],
  },
] as const satisfies ReadonlyArray<{
  queryValue: string;
  label: string;
  factTags: readonly FactTag[];
}>;

export const USER_CONTENT_FILTER_BY_QUERY = Object.fromEntries(
  USER_CONTENT_FILTERS.map((filter) => [filter.queryValue, filter]),
);

export function isFactTag(value: string): value is FactTag {
  return value in FACT_TAG_RULES;
}
