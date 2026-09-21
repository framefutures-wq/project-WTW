import { PRIVATE_SOURCE_REGISTRY } from "../../shared/private-official-sources";
import type { Env } from "../env";

export type PrivateSummary = Record<"AUTO_PUBLISH" | "AUTO_RETRY" | "AUTO_EXCLUDE" | "POLICY_SKIP" | "EXPIRED" | "discovered" | "inserted" | "updated" | "source_errors" | "rows_read" | "rows_written", number>;
const empty = (): PrivateSummary => ({ AUTO_PUBLISH: 0, AUTO_RETRY: 0, AUTO_EXCLUDE: 0, POLICY_SKIP: 0, EXPIRED: 0, discovered: 0, inserted: 0, updated: 0, source_errors: 0, rows_read: 0, rows_written: 0 });

/**
 * Private adapters are intentionally opt-in. Registry entries without a
 * verified stable identity + date + venue discovery contract do no network
 * work and cannot publish. This preserves the daily cron isolation boundary
 * while allowing a source to be enabled only with a tested adapter.
 */
export async function runPrivateOfficialSources(_env: Env) {
  const summary = empty();
  const enabled = Object.values(PRIVATE_SOURCE_REGISTRY).filter((source) => source.enabled);
  for (const source of enabled) {
    // No adapter is registered until the source's official current listing
    // exposes stable program IDs and event-level venue evidence.
    summary.source_errors += 1;
    console.error("private_source_disabled_without_ready_adapter", { source: source.sourceKey });
  }
  console.log("private_official_summary", { ...summary, enabled_sources: enabled.length });
  return summary;
}
