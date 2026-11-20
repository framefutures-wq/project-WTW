import assert from "node:assert/strict";

const origin = "https://galteum.com";
const get = (url) => fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20000) });
for (const path of ["/", "/?period=weekend"]) {
  const response = await get(origin + path);
  assert.equal(response.status, 200, "Platform root status");
  const html = await response.text();
  assert.match(html, /galteum-platform-root.*true/, "Platform root marker");
  assert.match(html, /GALTEUM \| 비즈니스를 위한 디지털 도구/);
  const assets = [...html.matchAll(/<script[^>]+src="(\/assets\/[^"]+\.js)"/g)];
  assert.ok(assets.length > 0, "Platform JS asset missing");
  for (const [, asset] of assets) {
    const js = await get(origin + asset);
    assert.equal(js.status, 200, "JS asset status");
    assert.ok(!(js.headers.get("content-type") ?? "").includes("text/html"), "Unexpected HTML asset");
    if (path === "/") assert.ok((await js.text()).includes("https://wholesale.galteum.com/wholesale/"), "Wholesale link missing in app bundle");
  }
  console.log("PASS: platform root", path);
}
for (const path of ["/events", "/events/retired-probe", "/weekend/seoul", "/api/events", "/api/meta", "/api/push/config"]) {
  assert.equal((await get(origin + path)).status, 410, "Retired route: " + path);
  console.log("PASS: retired", path);
}
const sitemap = await get(origin + "/sitemap.xml");
assert.equal(sitemap.status, 200);
assert.deepEqual((await sitemap.text()).match(/<loc>[^<]+<\/loc>/g), ["<loc>https://galteum.com/</loc>"]);
const health = await get(origin + "/api/health");
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), { ok: true, mode: "platform", ingestion: "disabled", push: "disabled" });
const access = await get("https://wholesale.galteum.com/wholesale/");
assert.ok([302, 303, 307, 308].includes(access.status), "Wholesale unauthenticated access must redirect");
const location = access.headers.get("location");
assert.ok(location, "Wholesale access redirect missing");
const target = new URL(location, "https://wholesale.galteum.com");
assert.ok(target.protocol === "https:" && target.pathname.startsWith("/cdn-cgi/access/login") && (target.hostname.endsWith(".cloudflareaccess.com") || target.hostname === "wholesale.galteum.com"), "Expected Cloudflare Access login redirect");
console.log("PASS: root-only sitemap, retired health, wholesale Cloudflare Access redirect");
