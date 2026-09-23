import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { parse } from "jsonc-parser";
const name = "weekend-mwohae", nonce = randomUUID().replace(/-/g, ""), manualRunId = randomUUID(), tempDir = ".wrangler/deployment";
const config = parse(readFileSync("wrangler.production.jsonc", "utf8"));
const tempConfig = resolve(tempDir, `tourapi-detail-once-${manualRunId}.jsonc`);
const run = (args) => { const r = spawnSync("npx", ["wrangler", ...args], { encoding: "utf8" }); if (r.status !== 0) throw new Error(r.stderr || r.stdout || "wrangler command failed"); return r.stdout; };
try {
  const secrets = JSON.parse(run(["secret", "list", "--config", "wrangler.production.jsonc"]));
  if (!secrets.some((secret) => secret.name === "TOUR_API_KEY")) throw new Error("TOUR_API_KEY secret missing");
  mkdirSync(tempDir, { recursive: true });
  writeFileSync(tempConfig, JSON.stringify({ name, account_id: config.account_id, main: resolve("scripts/tourapi-detail-once-worker.ts"), compatibility_date: config.compatibility_date, d1_databases: config.d1_databases, vars: { APP_MODE: "production", TOUR_API_ENABLED: "true", MANUAL_DETAIL_NONCE: nonce }, secrets: config.secrets }));
  const uploaded = run(["versions", "upload", "--config", tempConfig, "--keep-vars", "--message", "detail-only one-shot"]);
  const versionId = /Version ID:\s*([a-f0-9-]+)/i.exec(uploaded)?.[1];
  if (!versionId) throw new Error("Version URL unavailable: version id not returned");
  const url = `https://${versionId}-${name}.framefutures.workers.dev`;
  const response = await fetch(url, { method: "POST", headers: { "x-manual-detail-nonce": nonce, "content-type": "application/json" }, body: JSON.stringify({ manualRunId }), signal: AbortSignal.timeout(14 * 60_000) });
  if (!response.ok) throw new Error(`one-shot request failed (${response.status})`);
  console.log(JSON.stringify({ manualRunId, versionId, result: await response.json() }));
} finally { rmSync(tempConfig, { force: true }); }
