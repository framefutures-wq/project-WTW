import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { parse } from "jsonc-parser";

// Authenticated remote development session: Cloudflare retains the existing Worker's
// encrypted secrets. No public write route, secret export, new Worker or new database.
const original = parse(readFileSync("wrangler.production.jsonc", "utf8"));
const preflight = spawnSync(
  "npx",
  ["wrangler", "secret", "list", "--config", "wrangler.production.jsonc"],
  { encoding: "utf8" },
);
if (preflight.status !== 0)
  throw new Error("Cloudflare 로그인 또는 Secret 목록 조회 실패");
if (
  !JSON.parse(preflight.stdout).some((secret) => secret.name === "TOUR_API_KEY")
)
  throw new Error(
    "TOUR_API_KEY Secret을 먼저 Cloudflare에 등록하세요. 키를 로컬 파일에 저장하지 마세요.",
  );
mkdirSync(".wrangler/deployment", { recursive: true });
const config = {
  ...original,
  main: resolve(original.main),
  assets: {
    ...original.assets,
    directory: resolve(original.assets.directory),
    run_worker_first: ["/api/*", "/__scheduled"],
  },
  vars: { APP_MODE: "sample", TOUR_API_ENABLED: "true" },
  d1_databases: original.d1_databases.map((db) => ({
    ...db,
    preview_database_id: db.database_id,
    migrations_dir: resolve(db.migrations_dir),
  })),
};
const configFile = resolve(".wrangler/deployment/tourapi-sync.jsonc");
writeFileSync(configFile, JSON.stringify(config, null, 2));
const dev = spawn(
  "npx",
  [
    "wrangler",
    "dev",
    "--remote",
    "--test-scheduled",
    "--config",
    configFile,
    "--port",
    "8788",
  ],
  { stdio: "inherit", detached: true },
);
function stop() {
  try {
    process.kill(-dev.pid, "SIGTERM");
  } catch {}
}
process.on("SIGINT", () => {
  stop();
  process.exit(130);
});
try {
  let ready = false;
  for (let n = 0; n < 60; n++) {
    if (dev.exitCode !== null)
      throw new Error("Cloudflare 원격 개발 세션 시작 실패");
    try {
      const r = await fetch("http://127.0.0.1:8788/api/health", {
        signal: AbortSignal.timeout(2000),
      });
      const health = await r.json();
      if (health.ingestion === "secret_missing")
        throw new Error("원격 세션의 Secret 바인딩 확인 필요");
      if (health.ingestion === "enabled") {
        ready = true;
        break;
      }
    } catch (e) {
      if (e.message === "원격 세션의 Secret 바인딩 확인 필요") throw e;
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
  if (!ready) throw new Error("Cloudflare 원격 세션 준비 시간 초과");
  const response = await fetch(
    "http://127.0.0.1:8788/__scheduled?cron=0+21+*+*+*",
    { signal: AbortSignal.timeout(14 * 60_000) },
  );
  await response.text();
  const result = spawnSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "weekend-mwohae-production",
      "--remote",
      "--config",
      "wrangler.production.jsonc",
      "--command",
      "SELECT status,message,started_at,finished_at FROM sync_runs WHERE provider='tourapi' ORDER BY started_at DESC LIMIT 1",
      "--json",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error("원격 D1 동기화 결과 조회 실패");
  const run = JSON.parse(result.stdout)[0]?.results[0];
  console.log(JSON.stringify(run, null, 2));
  if (!response.ok || run?.status !== "success")
    throw new Error("원격 TourAPI 동기화가 완료되지 않았습니다.");
} finally {
  stop();
}
