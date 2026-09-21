import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { parse } from "jsonc-parser";

const MAX_EVENTS = Number(process.argv[2] ?? "10");
if (!Number.isInteger(MAX_EVENTS) || MAX_EVENTS < 1 || MAX_EVENTS > 10)
  throw new Error("usage: node scripts/tourapi-detail-audit.mjs [1..10]");
const config = parse(readFileSync("wrangler.production.jsonc", "utf8"));
const preflight = spawnSync(
  "npx",
  ["wrangler", "secret", "list", "--config", "wrangler.production.jsonc"],
  { encoding: "utf8" },
);
if (preflight.status !== 0) throw new Error("Cloudflare Secret 목록 조회 실패");
if (!JSON.parse(preflight.stdout).some((secret) => secret.name === "TOUR_API_KEY"))
  throw new Error("TOUR_API_KEY Secret 없음");

const candidatesResult = spawnSync(
  "npx",
  [
    "wrangler", "d1", "execute", "weekend-mwohae-production", "--remote",
    "--config", "wrangler.production.jsonc", "--json", "--command",
    `SELECT e.id FROM events e JOIN sources s ON s.id=e.primary_source_id
     WHERE e.is_sample=0 AND e.verification='verified' AND s.kind='tourapi'
       AND e.end_date>=date('now') AND e.start_date<=date('now','+30 days')
     ORDER BY CASE WHEN e.start_date<=date('now') THEN 0 ELSE 1 END,e.start_date,e.id
     LIMIT ${MAX_EVENTS}`,
  ],
  { encoding: "utf8" },
);
if (candidatesResult.status !== 0) throw new Error("후보 read-only query 실패");
const candidates = JSON.parse(candidatesResult.stdout)[0]?.results ?? [];

mkdirSync(".wrangler/deployment", { recursive: true });
const auditConfig = resolve(".wrangler/deployment/tourapi-detail-audit.jsonc");
writeFileSync(
  auditConfig,
  JSON.stringify({
    ...config,
    main: resolve("scripts/official-source-details-worker.ts"),
    assets: undefined,
    triggers: undefined,
    observability: { enabled: false },
    d1_databases: config.d1_databases.map((database) => ({
      ...database,
      preview_database_id: database.database_id,
      migrations_dir: resolve(database.migrations_dir),
    })),
  }),
);
const dev = spawn(
  "npx",
  ["wrangler", "dev", "--remote", "--config", auditConfig, "--port", "8790"],
  { stdio: "inherit", detached: true },
);
const stop = () => {
  try { process.kill(-dev.pid, "SIGTERM"); } catch {}
};
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (dev.exitCode !== null) throw new Error("원격 read-only 세션 시작 실패");
    try {
      ready = Boolean((await (await fetch("http://127.0.0.1:8790/health")).json()).ready);
    } catch {}
    if (ready) break;
    await new Promise((done) => setTimeout(done, 1000));
  }
  if (!ready) throw new Error("원격 Secret 바인딩 준비 시간 초과");
  const summaries = [];
  for (const candidate of candidates) {
    const contentId = String(candidate.id).replace(/^tourapi-/, "");
    const response = await fetch(`http://127.0.0.1:8790/detail?id=${encodeURIComponent(contentId)}`, {
      signal: AbortSignal.timeout(55_000),
    });
    if (!response.ok) throw new Error("detail audit response 실패");
    const detail = await response.json();
    const endpoints = detail.results.map((result) => ({
      endpoint: result.endpoint,
      status: result.status,
      itemCount: result.items.length,
      fields: [...new Set(result.items.flatMap((item) => Object.keys(item).filter((key) => item[key] !== "" && item[key] != null)))].sort(),
      ...(result.endpoint === "detailInfo2"
        ? { infoNames: result.items.map((item) => String(item.infoname ?? "").trim()).filter(Boolean) }
        : {}),
    }));
    summaries.push({ contentId, endpoints });
    await new Promise((done) => setTimeout(done, 250));
  }
  console.log(JSON.stringify({ candidates: candidates.length, requests: candidates.length * 3, summaries }, null, 2));
} finally {
  stop();
}
