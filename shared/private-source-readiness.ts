export type PrivateReadinessGate = "discovery" | "identity" | "date" | "venue" | "parserHealth" | "weekendSuitability";

export type PrivateSourceReadiness = {
  sourceKey: string;
  sourceName: string;
  currentUpcomingCandidates: number;
  stableIdentityCoverage: "complete" | "partial" | "none";
  requestCount: number;
  gates: Record<PrivateReadinessGate, boolean>;
};

export const PRIVATE_READINESS_GATES: PrivateReadinessGate[] = [
  "discovery", "identity", "date", "venue", "parserHealth", "weekendSuitability",
];

export function isPrivateSourceReady(source: PrivateSourceReadiness) {
  return PRIVATE_READINESS_GATES.every((gate) => source.gates[gate]);
}

/** The documented Phase 13B tie-break; no brand or popularity input. */
export function selectPrivateSourceWinner(sources: PrivateSourceReadiness[]) {
  return sources
    .filter(isPrivateSourceReady)
    .sort((left, right) =>
      right.currentUpcomingCandidates - left.currentUpcomingCandidates ||
      Number(right.stableIdentityCoverage === "complete") - Number(left.stableIdentityCoverage === "complete") ||
      left.requestCount - right.requestCount ||
      left.sourceName.localeCompare(right.sourceName, "ko"),
    )[0] ?? null;
}
