import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { parse } from "jsonc-parser";

const directory = ".wrangler/deployment/official-source";
mkdirSync(directory, { recursive: true });
const snapshot = JSON.parse(
  readFileSync(".wrangler/deployment/tourapi-real.json", "utf8"),
);
const original = parse(readFileSync("wrangler.production.jsonc", "utf8"));
const preflight = spawnSync(
  "npx",
  ["wrangler", "secret", "list", "--config", "wrangler.production.jsonc"],
  { encoding: "utf8" },
);
if (preflight.status !== 0)
  throw new Error("Cloudflare 인증/Secret 목록 확인 실패");
if (!JSON.parse(preflight.stdout).some((s) => s.name === "TOUR_API_KEY"))
  throw new Error("Cloudflare Secret 없음");
const configFile = resolve(`${directory}/details.jsonc`);
writeFileSync(
  configFile,
  JSON.stringify(
    {
      ...original,
      main: resolve("scripts/official-source-details-worker.ts"),
      assets: undefined,
      triggers: undefined,
      observability: { enabled: false },
      d1_databases: original.d1_databases.map((db) => ({
        ...db,
        preview_database_id: db.database_id,
        migrations_dir: resolve(db.migrations_dir),
      })),
    },
    null,
    2,
  ),
);
const dev = spawn(
  "npx",
  ["wrangler", "dev", "--remote", "--config", configFile, "--port", "8789"],
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
  for (let i = 0; i < 60; i++) {
    if (dev.exitCode !== null) throw new Error("원격 개발 세션 실패");
    try {
      ready = (
        await (
          await fetch("http://127.0.0.1:8789/health", {
            signal: AbortSignal.timeout(2000),
          })
        ).json()
      ).ready;
    } catch {}
    if (ready) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw new Error("원격 Secret 바인딩/세션 확인 실패");
  let details = {};
  try {
    details = JSON.parse(readFileSync(`${directory}/details.json`, "utf8"));
  } catch {}
  for (const [index, event] of snapshot.events.entries()) {
    const id = event.id.slice("tourapi-".length);
    if (
      !details[id] ||
      (process.argv.includes("--retry-failed") &&
        details[id].results.some(
          (r) => r.status !== "success" || !r.items.length,
        ))
    ) {
      const missing = ["detailCommon2", "detailIntro2"].filter(
        (endpoint) =>
          !details[id]?.results.some(
            (r) =>
              r.endpoint === endpoint &&
              r.status === "success" &&
              r.items.length,
          ),
      );
      const response = await fetch(
        `http://127.0.0.1:8789/detail?id=${id}${missing.length === 1 ? `&endpoint=${missing[0]}` : ""}`,
        { signal: AbortSignal.timeout(55000) },
      );
      if (!response.ok)
        throw new Error(`Detail session HTTP ${response.status}`);
      const next = await response.json();
      appendFileSync(
        `${directory}/attempts.jsonl`,
        JSON.stringify(next) + "\n",
      );
      if (details[id])
        appendFileSync(
          `${directory}/attempts.jsonl`,
          JSON.stringify(details[id]) + "\n",
        );
      details[id] = {
        ...next,
        results: [
          ...(details[id]?.results || []).filter(
            (r) => !next.results.some((n) => n.endpoint === r.endpoint),
          ),
          ...next.results,
        ],
      };
      writeFileSync(
        `${directory}/details.json`,
        JSON.stringify(details, null, 2),
      );
      await new Promise((r) => setTimeout(r, 300));
    }
    if (index % 10 === 0 || index === snapshot.events.length - 1)
      console.log(`상세 조회 ${index + 1}/${snapshot.events.length}`);
  }
} finally {
  stop();
}
