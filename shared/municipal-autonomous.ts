import type { SelectionGate } from "./municipal-discovery";

export type AutonomousDecision = "AUTO_PUBLISH" | "AUTO_RETRY" | "AUTO_EXCLUDE" | "POLICY_SKIP" | "EXPIRED";
export type AutonomousInput = {
  gate: SelectionGate; duplicate: "DUPLICATE" | "LIKELY_DUPLICATE" | "NEW" | "REVIEW";
  temporal: "UPCOMING" | "ACTIVE" | "EXPIRED"; trusted: boolean; coreValid: boolean;
  parserError?: boolean; detailError?: boolean; coreConflict?: boolean;
};

export function decideAutonomousMunicipal(input: AutonomousInput): { state: AutonomousDecision; reason: string } {
  if (input.temporal === "EXPIRED") return { state: "EXPIRED", reason: "end_date_before_today" };
  if (input.gate === "EXCLUDE" || input.duplicate === "DUPLICATE") return { state: "AUTO_EXCLUDE", reason: input.gate === "EXCLUDE" ? "selection_exclude" : "confirmed_duplicate" };
  if (input.gate === "NEARBY_ONLY") return { state: "POLICY_SKIP", reason: "main_publication_policy" };
  if (!input.trusted) return { state: "AUTO_RETRY", reason: "untrusted_source_adapter" };
  if (input.gate !== "MAIN") return { state: "AUTO_RETRY", reason: "selection_not_conclusive" };
  if (input.duplicate !== "NEW") return { state: "AUTO_RETRY", reason: "duplicate_not_conclusive" };
  if (!input.coreValid || input.parserError || input.detailError || input.coreConflict)
    return { state: "AUTO_RETRY", reason: input.coreConflict ? "core_conflict" : "official_core_not_verified" };
  return { state: "AUTO_PUBLISH", reason: "trusted_main_new_verified_core" };
}
