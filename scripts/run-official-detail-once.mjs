import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { parse } from "jsonc-parser";
import { parseVersionUrl } from "./tourapi-detail-once-url.mjs";

const args = process.argv.slice(2);
const passArg = args.find((value) => value.startsWith("--passes="));
const passes = passArg ? Number(passArg.slice("--passes=".length)) : 6;
if (!Number.isInteger(passes) || passes < 1 || passes > 10)
  throw new Error("Use --passes=1..10.");

const limitArg = args.find((value) => value.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : 12;
if (!Number.isInteger(limit) || limit < 1 || limit > 20)
  throw new Error("Use --limit=1..20.");

const name = "weekend-mwohae";
const nonce = randomUUID().replace(/-/g, "");
const tempDir = ".wrangler/deployment";
const config = parse(readFileSync("wrangler.production.jsonc", "utf8"));
const tempConfig = resolve(
  tempDir,
  `official-detail-once-${randomUUID()}.jsonc`,
);

const run = (wranglerArgs) => {
  const result = spawnSync("npx", ["wrangler", ...wranglerArgs], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(result.stderr || result.stdout || "wrangler command failed");
  return `${result.stdout}\n${result.stderr}`;
};

try {
  mkdirSync(tempDir, { recursive: true });
  writeFileSync(
    tempConfig,
    JSON.stringify({
      name,
      account_id: config.account_id,
      main: resolve("scripts/official-detail-once-worker.ts"),
      compatibility_date: config.compatibility_date,
      d1_databases: config.d1_databases,
      vars: {
        ...config.vars,
        MANUAL_OFFICIAL_DETAIL_NONCE: nonce,
      },
    }),
  );

  const alias = `official-detail-${randomUUID()
    .replace(/-/g, "")
    .slice(0, 10)}`;
  const uploaded = run([
    "versions",
    "upload",
    "--config",
    tempConfig,
    "--keep-vars",
    "--preview-alias",
    alias,
    "--message",
    "official-detail bounded one-shot",
  ]);
  const url = parseVersionUrl(uploaded);
  if (!url) throw new Error("Version URL unavailable.");

  const aggregate = {
    passes: 0,
    candidates: 0,
    attempted: 0,
    fetched: 0,
    recovered: 0,
    images_recovered: 0,
    detail_recovered: 0,
    title_mismatch: 0,
    core_conflict: 0,
    empty: 0,
    fetch_failed: 0,
  };

  for (let pass = 1; pass <= passes; pass += 1) {
    const result = spawnSync(
      "curl",
      [
        "--silent",
        "--show-error",
        "--fail-with-body",
        "--connect-timeout",
        "30",
        "--max-time",
        String(8 * 60),
        "--request",
        "POST",
        "--header",
        `x-manual-official-detail-nonce: ${nonce}`,
        "--header",
        `x-manual-official-detail-limit: ${limit}`,
        url,
      ],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
    if (result.status !== 0)
      throw new Error(result.stderr || result.stdout || "one-shot request failed");
    const payload = JSON.parse(result.stdout);
    if (!payload.ok) throw new Error(payload.error || "one-shot failed");
    const current = payload.result;
    aggregate.passes += 1;
    for (const key of [
      "candidates",
      "attempted",
      "fetched",
      "recovered",
      "images_recovered",
      "detail_recovered",
      "title_mismatch",
      "core_conflict",
      "empty",
      "fetch_failed",
    ])
      aggregate[key] += Number(current[key] ?? 0);
    console.error(
      `[official-detail:once] pass=${pass} candidates=${current.candidates} recovered=${current.recovered} images=${current.images_recovered} detail=${current.detail_recovered}`,
    );
    if (!current.candidates) break;
  }

  console.log(JSON.stringify(aggregate, null, 2));
} finally {
  rmSync(tempConfig, { force: true });
}
