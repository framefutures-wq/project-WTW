import { spawnSync } from "node:child_process";
import { validateDiscoveryRolloutAudit } from "../shared/discovery-rollout";

const ORIGIN = "https://galteum.com";
const DB = "weekend-mwohae-production";
const CONFIG = "wrangler.production.jsonc";

function run(
  command: string,
  args: string[],
  options: { capture?: boolean; env?: NodeJS.ProcessEnv; input?: string } = {},
) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : ["pipe", "inherit", "inherit"],
    env: options.env ?? process.env,
    input: options.input,
    maxBuffer: 24 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const stderr = options.capture ? result.stderr?.trim().slice(0, 2000) : "";
    throw new Error(
      `${command} ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`,
    );
  }
  return options.capture ? String(result.stdout ?? "") : "";
}

function cleanMainGuard() {
  run("git", ["fetch", "origin", "main"]);
  const status = run("git", ["status", "--porcelain"], { capture: true }).trim();
  if (status) throw new Error("rollout blocked: working tree is not clean");
  const branch = run("git", ["branch", "--show-current"], { capture: true }).trim();
  if (branch !== "main")
    throw new Error(
      `rollout blocked: current branch is ${branch || "(detached)"}, expected main`,
    );
  const head = run("git", ["rev-parse", "HEAD"], { capture: true }).trim();
  const origin = run("git", ["rev-parse", "origin/main"], { capture: true }).trim();
  if (head !== origin)
    throw new Error("rollout blocked: local main does not match origin/main");
  return head;
}

function productionAudit() {
  const stdout = run(
    "npx",
    [
      "tsx",
      "scripts/audit-publish-quality.ts",
      "--remote",
      "--allow-expensive-remote-read",
      "--limit",
      "5000",
      "--examples",
      "12",
    ],
    { capture: true },
  );
  const report = JSON.parse(stdout);
  const validation = validateDiscoveryRolloutAudit(report);
  if (!validation.ok)
    throw new Error(
      `rollout blocked by production audit: ${validation.blockers.join(", ")}`,
    );
  return { report, validation };
}

function applyMigrations() {
  run(
    "npx",
    [
      "wrangler",
      "d1",
      "migrations",
      "apply",
      DB,
      "--remote",
      "--config",
      CONFIG,
    ],
    { input: "y\n" },
  );
}

function deploy() {
  run("npm", ["run", "deploy:verified"]);
}

function verifyProduction() {
  run("npm", ["run", "test:smoke"], {
    env: { ...process.env, SMOKE_BASE_URL: ORIGIN },
  });
  run("npm", ["run", "test:ui:prod"], {
    env: {
      ...process.env,
      TEST_BASE_URL: ORIGIN,
      TEST_OUTPUT_DIR: "test-results/discovery-v1-production",
    },
  });
}

function applyLegacyQuality() {
  const stdout = run(
    "node",
    ["--import", "tsx", "scripts/apply-publish-quality-v1.ts"],
    { capture: true },
  );
  return JSON.parse(stdout);
}

function auditSummary(step: string, head: string, audit: ReturnType<typeof productionAudit>) {
  console.log(
    JSON.stringify(
      {
        step,
        git_sha: head,
        origin: ORIGIN,
        scanned: audit.report.scanned_current_or_future_verified_events,
        by_state: audit.report.by_state,
        by_official_link_quality: audit.report.by_official_link_quality,
        by_public_quality_risk: audit.report.by_public_quality_risk,
        rollout: audit.report.rollout,
        warnings: audit.validation.warnings,
      },
      null,
      2,
    ),
  );
}

const head = cleanMainGuard();
console.log(`discovery-v1 rollout start: ${head}`);

const before = productionAudit();
auditSummary("preflight-audit", head, before);

applyMigrations();
deploy();
verifyProduction();

const applied = applyLegacyQuality();
const after = {
  report: applied.after_report,
  validation: validateDiscoveryRolloutAudit(applied.after_report),
};
if (!after.validation.ok)
  throw new Error(
    `rollout post-apply audit failed: ${after.validation.blockers.join(", ")}`,
  );

console.log(
  JSON.stringify(
    {
      step: "legacy-quality-applied",
      applied_rows: applied.applied_rows,
      visibility_changes: applied.visibility_changes,
    },
    null,
    2,
  ),
);
auditSummary("rollout-complete", head, after);
