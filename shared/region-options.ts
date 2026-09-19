import { REGIONS } from "./domain";

export const REGION_OPTIONS = REGIONS.map((queryValue) => ({
  queryValue,
  label: queryValue,
})) as ReadonlyArray<{ queryValue: (typeof REGIONS)[number]; label: string }>;

export const REGION_LABELS: Record<string, string> = Object.fromEntries(
  REGION_OPTIONS.map(({ queryValue, label }) => [queryValue, label]),
);

export function regionLabel(value: string): string {
  return REGION_LABELS[value] ?? value;
}
