import { spawnSync } from "node:child_process";
import { validateDiscoveryRolloutAudit } from "../shared/discovery-rollout";
import {
  buildLegacyPublishQualitySql,
  validateLegacyPublishQualityPlan,
} from "../shared/publish-quality-rollout";

const DB = "weekend-mwohae-production";
const CONFIG = "wrangler.production.jsonc";

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 24 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const diagnostic = (result.stderr || result.stdout).trim().slice(0, 2500);
    throw new Error(
      `${command} ${args.join(" ")} failed${diagnostic ? `: ${diagnostic}` : ""}`,
    );
  }
  return String(result.stdout ?? "");
}

function audit(includeAudited: boolean) {
  const stdout = run("npx", [
    "tsx",
    "scripts/audit-publish-quality.ts",
    "--remote",
    "--allow-expensive-remote-read",
    "--limit",
    "5000",
    "--examples",
    "25",
    ...(includeAudited ? ["--include-audited"] : []),
  ]);
  const report = JSON.parse(stdout);
  const validation = validateDiscoveryRolloutAudit(report);
  if (!validation.ok)
    throw new Error(
      `legacy quality rollout blocked by audit: ${validation.blockers.join(", ")}`,
    );
  return { report, validation };
}

function applySql(sql: string) {
  run("npx", [
    "wrangler",
    "d1",
    "execute",
    DB,
    "--remote",
    "--config",
    CONFIG,
    "--command",
    sql,
    "--json",
  ]);
}

const before = audit(true);
const plan = validateLegacyPublishQualityPlan(before.report);
if (!plan.ok)
  throw new Error(
    `legacy quality rollout blocked: ${plan.blockers.join(", ")}`,
  );

if (plan.legacyRows.length > 0) {
  const sql = buildLegacyPublishQualitySql(
    plan.legacyRows,
    new Date().toISOString(),
  );
  if (!sql) throw new Error("legacy quality rollout SQL missing");
  applySql(sql);
}

const after = audit(false);
if ((after.report.rollout?.legacy_unversioned ?? 0) !== 0)
  throw new Error(
    `legacy quality rollout verification failed: legacy_unversioned=${after.report.rollout?.legacy_unversioned ?? "unknown"}`,
  );
if ((after.report.rollout?.proposed_visibility_changes ?? 0) !== 0)
  throw new Error(
    `legacy quality rollout verification failed: proposed_visibility_changes=${after.report.rollout?.proposed_visibility_changes ?? "unknown"}`,
  );

console.log(
  JSON.stringify(
    {
      applied_rows: plan.legacyRows.length,
      visibility_changes: plan.visibilityChanges,
      before: {
        scanned: before.report.scanned_current_or_future_verified_events,
        by_state: before.report.by_state,
        rollout: before.report.rollout,
      },
      after: {
        scanned: after.report.scanned_current_or_future_verified_events,
        by_state: after.report.by_state,
        by_official_link_quality: after.report.by_official_link_quality,
        by_public_quality_risk: after.report.by_public_quality_risk,
        rollout: after.report.rollout,
      },
    },
    null,
    2,
  ),
);
