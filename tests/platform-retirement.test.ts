import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";
import worker, { handleScheduled } from "../worker/index";

const html = '<html><head><title>legacy</title><meta name="description" content="legacy" /></head><body><div id="root"></div></body></html>';
const env = {
  APP_MODE: "production",
  LEGACY_EVENT_SERVICE_RETIRED: "true",
  TOUR_API_ENABLED: "false",
  DB: { prepare() { throw new Error("Retired service must not query D1"); } },
  ASSETS: { fetch: async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path === "/assets/app.js") return new Response("app", { headers: { "Content-Type": "application/javascript" } });
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }},
} as never;
const get = (path: string, method = "GET") => worker.fetch(new Request(new URL(path, "https://galteum.com"), { method }), env);

test("retired production serves the platform even on old root query URLs", async () => {
  for (const path of ["/", "/?period=weekend", "/?event=old"]) {
    const res = await get(path);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /galteum-platform-root.*true/);
  }
  const preview = await get("/platform-preview");
  assert.equal(preview.status, 301);
  assert.equal(preview.headers.get("Location"), "https://galteum.com/");
  assert.equal(await (await get("/assets/app.js")).text(), "app");
  assert.equal((await get("/assets/missing.js")).status, 404);
  assert.equal((await get("/unknown")).status, 404);
});

test("retired event routes, push writes and sitemap never query D1", async () => {
  for (const path of ["/events", "/events/old", "/weekend/seoul", "/api/events", "/api/events/old/image/1", "/api/events/nearby", "/api/meta", "/api/push/config"])
    assert.equal((await get(path)).status, 410, path);
  for (const path of ["/api/push/subscribe", "/api/push/unsubscribe", "/api/events/nearby"])
    assert.equal((await get(path, "POST")).status, 410, path);
  const sitemap = await (await get("/sitemap.xml")).text();
  assert.deepEqual(sitemap.match(/<loc>[^<]+<\/loc>/g), ["<loc>https://galteum.com/</loc>"]);
  assert.match(await (await get("/robots.txt")).text(), /Sitemap: https:\/\/galteum.com\/sitemap.xml/);
  assert.deepEqual(await (await get("/api/health")).json(), { ok: true, mode: "platform", ingestion: "disabled", push: "disabled" });
  assert.match(await (await get("/sw.js")).text(), /registration.unregister/);
});

test("retired production also ignores residual Cron deliveries and has all collection switches off", async () => {
  for (const cron of ["* * * * *", "0 1 * * *", "55 8 * * *"])
    await handleScheduled({ cron }, env);
  const config = parse(readFileSync("wrangler.production.jsonc", "utf8"));
  assert.equal(config.vars.LEGACY_EVENT_SERVICE_RETIRED, "true");
  for (const key of ["TOUR_API_ENABLED", "FAIR_MICRO_DISPATCHER_ENABLED", "MUNICIPAL_DOCUMENT_AI_ENABLED", "WEB_PUSH_ENABLED"])
    assert.equal(config.vars[key], "false", key);
  assert.deepEqual(config.triggers.crons, []);
});
