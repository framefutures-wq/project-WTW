import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { spawn } from "node:child_process";

// Isolated synthetic contract fixtures ONLY. No existing local/remote D1 writes,
// no secret, no live API request, and no production data snapshot replacement.
const bundle = async (entry) =>
  (
    await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: "esm",
      platform: "node",
      target: "es2022",
    })
  ).outputFiles[0].text;
const worker = await bundle("worker/index.ts");
const adapter = await import(
  "data:text/javascript;base64," +
    Buffer.from(await bundle("worker/sources/tourapi.ts")).toString("base64")
);
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: worker,
    compatibilityDate: "2026-09-18",
    d1Databases: ["DB"],
    bindings: { APP_MODE: "production", TOUR_API_ENABLED: "false" },
    cf: false,
    serviceBindings: {
      ASSETS: async (request) => {
        const path = new URL(request.url).pathname;
        const file = resolve(
          "dist",
          path === "/" ? "index.html" : path.slice(1),
        );
        if (!file.startsWith(resolve("dist") + "/"))
          return new Response("Not found", { status: 404 });
        try {
          return new Response(readFileSync(file), {
            headers: {
              "Content-Type":
                {
                  ".html": "text/html",
                  ".js": "text/javascript",
                  ".css": "text/css",
                }[extname(file)] ?? "application/octet-stream",
            },
          });
        } catch {
          return new Response("Not found", { status: 404 });
        }
      },
    },
  }),
);
try {
  const db = await mf.getD1Database("DB");
  for (const sql of readFileSync("migrations/0001_initial.sql", "utf8")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean))
    await db.prepare(sql).run();
  const now = new Date(),
    today = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10),
    end = new Date(today + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() + 30);
  const until = end.toISOString().slice(0, 10);
  const raw = [
    {
      contentid: "900001",
      contenttypeid: "15",
      title: "합성 계약 테스트 전용 서울 행사",
      addr1: "테스트용 주소 서울",
      lDongRegnCd: "11",
      eventstartdate: today.replaceAll("-", ""),
      eventenddate: until.replaceAll("-", ""),
      progresstype: "선택안함",
      mapx: "127",
      mapy: "37",
    },
    {
      contentid: "900002",
      contenttypeid: "15",
      title: "합성 계약 테스트 전용 부산 행사",
      addr1: "테스트용 주소 부산",
      lDongRegnCd: "26",
      eventstartdate: today.replaceAll("-", ""),
      eventenddate: until.replaceAll("-", ""),
      progresstype: "선택안함",
      mapx: "129",
      mapy: "35",
    },
  ];
  await adapter.saveFestivalSnapshot(
    db,
    adapter.selectFestivalSnapshot(
      raw,
      new Map([
        ["11", "서울"],
        ["26", "부산"],
      ]),
      now,
    ),
  );
  const events = (await db.prepare("SELECT * FROM events").all()).results;
  mkdirSync(".wrangler/testing", { recursive: true });
  const snapshot = resolve(".wrangler/testing/tourapi-contract.json");
  writeFileSync(
    snapshot,
    JSON.stringify({ fixture: "ISOLATED_SYNTHETIC_CONTRACT", events }),
  );
  const url = await mf.ready;
  console.log("SYNTHETIC CONTRACT UI TEST ONLY: " + url);
  const code = await new Promise((done) => {
    const child = spawn(
      "npx",
      ["playwright", "test", "--config", "playwright.real.config.ts"],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          TEST_BASE_URL: url.origin,
          TEST_REAL_SNAPSHOT: snapshot,
          TEST_OUTPUT_DIR: "test-results/contract",
        },
      },
    );
    child.on("exit", done);
  });
  if (code !== 0) process.exitCode = code ?? 1;
} finally {
  await mf.dispose();
}
