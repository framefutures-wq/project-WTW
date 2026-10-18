import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const remote =
  process.argv[2] ?? "https://galteum.com";
const local = process.env.LOCAL_BASE_URL ?? "http://127.0.0.1:8787";
async function get(base, path) {
  const r = await fetch(base + path, { signal: AbortSignal.timeout(20_000) });
  assert.equal(r.status, 200, `${base}${path}`);
  return r.json();
}
const meta = await get(local, "/api/meta");
assert.equal(meta.mode, "production");
assert.deepEqual(await get(remote, "/api/meta"), meta);
for (const base of [local, remote]) {
  const health = await get(base, "/api/health");
  assert.equal(health.mode, "production");
  assert.equal(health.database, "connected");
  if (base === remote) assert.equal(health.ingestion, "enabled");
}
const assetPaths = new Set(["/"]);
const html = await fetch(local + "/", { signal: AbortSignal.timeout(20_000) });
assert.equal(html.status, 200);
const htmlText = await html.text();
for (const match of htmlText.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g))
  assetPaths.add(match[1]);
for (const path of assetPaths) {
  const a = await fetch(local + path, { signal: AbortSignal.timeout(20_000) }),
    b = await fetch(remote + path, { signal: AbortSignal.timeout(20_000) });
  assert.equal(a.status, 200, path);
  assert.equal(b.status, 200, path);
  const bodyA = await a.text(),
    bodyB = await b.text();
  assert.equal(bodyB, bodyA, path);
  if (path.endsWith(".js")) {
    assert(!bodyB.includes("TOUR_API_KEY"));
    assert(!bodyB.includes("serviceKey="));
  }
}
let checked = 0;
const ids = new Set();
const filters = [
  "",
  ...meta.regions.map((r) => `&region=${encodeURIComponent(r)}`),
  ...["free", "paid", "unknown"].map((c) => `&cost=${c}`),
  ...Object.keys(meta.audiences).map((a) => `&audience=${a}`),
  ...Object.keys(meta.themes).map((t) => `&theme=${t}`),
  "&sort=distance&lat=37.5665&lng=126.978",
];
for (const period of ["today", "weekend", "next-weekend"]) {
  for (const filter of filters) {
    let page = 1,
      total;
    do {
      const path = `/api/events?period=${period}&limit=50&page=${page}${filter}`;
      const a = await get(local, path),
        b = await get(remote, path);
      assert.deepEqual(b, a, path);
      for (const e of a.events) {
        assert.equal(e.is_sample, 0);
        ids.add(e.id);
      }
      total = a.total;
      page++;
      checked++;
    } while ((page - 1) * 50 < total);
  }
}
assert(ids.size > 0, "3개 기간 중 최소 하나에 실제 행사 데이터가 필요합니다.");
for (const id of ids) {
  const path = `/api/events/${id}`;
  assert.deepEqual(await get(remote, path), await get(local, path), path);
  checked++;
}
const result = {
  remote,
  local,
  checked,
  eventCount: ids.size,
  assets: [...assetPaths],
  verifiedAt: new Date().toISOString(),
};
mkdirSync("test-results/real", { recursive: true });
writeFileSync("test-results/real/parity.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
