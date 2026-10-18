import { createHash } from "node:crypto";
import type { SelectionGate } from "./municipal-discovery";

export type ApprovalCandidate = { candidate_id: string; title: string; start_date: string | null; end_date: string | null; venue: string | null; official_url: string; selection_gate: SelectionGate; duplicate_status: string; ready_for_review: boolean };
export type TemporalStatus = "UPCOMING" | "ACTIVE" | "EXPIRED";
export const seoulToday = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
export const temporalStatus = (candidate: Pick<ApprovalCandidate, "start_date" | "end_date">, today: string): TemporalStatus => !candidate.end_date || candidate.end_date < today ? "EXPIRED" : candidate.start_date && candidate.start_date > today ? "UPCOMING" : "ACTIVE";
export const stableMunicipalCandidateId = (source: string, sourceId: string, startDate: string | null) => `municipal-${source}-${sourceId}-${startDate?.slice(0, 4) ?? "unknown"}`;
export const manifestFingerprint = (candidates: ApprovalCandidate[]) => createHash("sha256").update(JSON.stringify(candidates.map(({ candidate_id, title, start_date, end_date, venue, official_url, selection_gate, duplicate_status, ready_for_review }) => ({ candidate_id, title, start_date, end_date, venue, official_url, selection_gate, duplicate_status, ready_for_review })))).digest("hex").slice(0, 16);
export const approvalCandidates = (candidates: ApprovalCandidate[], today = seoulToday()) => candidates.filter((candidate) => candidate.selection_gate === "MAIN" && candidate.duplicate_status === "NEW" && candidate.ready_for_review && temporalStatus(candidate, today) !== "EXPIRED").sort((a, b) => { const sa = temporalStatus(a, today), sb = temporalStatus(b, today); return sa === sb ? (sa === "UPCOMING" ? a.start_date!.localeCompare(b.start_date!) : a.end_date!.localeCompare(b.end_date!)) : sa === "UPCOMING" ? -1 : 1; });
export function validateApproval(candidates: ApprovalCandidate[], fingerprint: string, expected: string, ids: string[]) {
  if (!ids.length) throw new Error("approve IDs are required; no production write was attempted");
  if (ids.length > 3) throw new Error("at most 3 candidates may be approved per apply");
  if (new Set(ids).size !== ids.length || ids.some((id) => /^(all|\*|everything)$/i.test(id))) throw new Error("approval IDs must be explicit and unique");
  if (fingerprint !== expected) throw new Error("stale manifest: run municipal:discover and municipal:review again");
  const allowed = new Map(approvalCandidates(candidates).map((candidate) => [candidate.candidate_id, candidate]));
  const selected = ids.map((id) => allowed.get(id));
  if (selected.some((candidate) => !candidate)) throw new Error("an approved candidate is missing or not eligible");
  return selected as ApprovalCandidate[];
}
