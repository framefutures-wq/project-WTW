export type DuplicateCandidate = {
  id: string;
  title: string;
  region: string;
  start_date: string;
  end_date: string;
  venue: string;
  address: string;
};

export type DuplicateDecision = "DUPLICATE" | "LIKELY_DUPLICATE" | "NEW" | "REVIEW";

export function normalizeMunicipalTitle(title: string) {
  return title
    .trim()
    .replace(/^20\d{2}(?:년)?\s*/, "")
    .replace(/제\s*\d+\s*회\s*/g, "")
    .replace(/[<>《》「」'"()\[\],.!·]/g, " ")
    .replace(/\s+/g, "")
    .toLowerCase();
}

const normalizePlace = (value: string) =>
  value.replace(/[\s(),.-]/g, "").toLowerCase();

export function decideMunicipalDuplicate(
  candidate: DuplicateCandidate,
  exactMatches: DuplicateCandidate[],
  regionalDateMatches: DuplicateCandidate[],
): DuplicateDecision {
  if (exactMatches.some((match) => match.id !== candidate.id)) return "DUPLICATE";
  const sameTitle = regionalDateMatches.filter(
    (match) =>
      match.id !== candidate.id &&
      normalizeMunicipalTitle(match.title) === normalizeMunicipalTitle(candidate.title),
  );
  if (!sameTitle.length) return "NEW";
  const samePlace = sameTitle.some(
    (match) =>
      normalizePlace(match.venue) === normalizePlace(candidate.venue) ||
      normalizePlace(match.address) === normalizePlace(candidate.address),
  );
  if (samePlace) return "LIKELY_DUPLICATE";
  return "REVIEW";
}

export function canRegisterMunicipalEvent(
  gate: "MAIN" | "NEARBY_ONLY" | "EXCLUDE" | "REVIEW",
  decision: DuplicateDecision,
  id: string,
) {
  return gate === "MAIN" && decision === "NEW" && !id.startsWith("tourapi-");
}
