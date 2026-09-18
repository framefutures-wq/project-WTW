import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const deployed = new URL(process.argv[2]);
if (
  deployed.protocol !== "https:" ||
  deployed.username ||
  deployed.password ||
  deployed.pathname !== "/" ||
  deployed.search ||
  deployed.hash
)
  throw new Error("배포된 HTTPS origin만 입력하세요.");
const local = "http://127.0.0.1:8787";
const paths = ["/api/health", "/api/meta"];
for (const period of ["today", "weekend", "next-weekend"])
  paths.push("/api/events?limit=50&period=" + period);
for (const [key, values] of Object.entries({
  region: [
    "서울",
    "부산",
    "대구",
    "인천",
    "광주",
    "대전",
    "울산",
    "세종",
    "경기",
    "강원",
    "충북",
    "충남",
    "전북",
    "전남",
    "경북",
    "경남",
    "제주",
  ],
  cost: ["free", "paid", "unknown"],
  audience: ["kids", "couple", "parents", "pets"],
  theme: ["food", "fireworks", "flowers", "experience", "performance"],
}))
  for (const value of values)
    paths.push("/api/events?limit=50&" + new URLSearchParams({ [key]: value }));
paths.push(
  "/api/events?sort=distance&lat=37.5665&lng=126.978&limit=50",
  "/api/events?region=서울&cost=free&audience=pets&theme=flowers",
  "/api/events?limit=1&page=1",
  "/api/events?limit=1&page=2",
);
for (const id of [
  ...Array.from(
    { length: 12 },
    (_, i) => `sample-${String(i + 1).padStart(2, "0")}`,
  ),
  "sample-cancelled",
])
  paths.push("/api/events/" + id);
const comparisons = [];
for (const path of paths) {
  const responses = await Promise.all([
    fetch(local + path),
    fetch(deployed.origin + path),
  ]);
  assert.equal(responses[0].status, 200, path);
  assert.equal(responses[1].status, 200, path);
  const bodies = await Promise.all(responses.map((r) => r.json()));
  assert.deepEqual(bodies[1], bodies[0], path);
  comparisons.push({ path, status: 200, identical: true });
}
const pages = await Promise.all([
  fetch(local + "/"),
  fetch(deployed.origin + "/"),
]);
assert.ok(pages.every((r) => r.status === 200));
const html = await Promise.all(pages.map((r) => r.text()));
assert.equal(html[1], html[0], "React index.html");
const staticAssets = [
  ...html[0].matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g),
].map((match) => match[1]);
assert.ok(staticAssets.length >= 2, "JS/CSS assets");
for (const path of staticAssets) {
  const responses = await Promise.all([
    fetch(local + path),
    fetch(deployed.origin + path),
  ]);
  assert.ok(
    responses.every((r) => r.status === 200),
    path,
  );
  const buffers = await Promise.all(
    responses.map(async (r) => Buffer.from(await r.arrayBuffer())),
  );
  assert.deepEqual(buffers[1], buffers[0], path);
}
console.log(`PASS: 로컬 ↔ 배포 API ${comparisons.length}개 응답 일치`);
for (const name of ["test:smoke", "test:ui"]) {
  const result = spawnSync("npm", ["run", name], {
    stdio: "inherit",
    env: {
      ...process.env,
      SMOKE_BASE_URL: deployed.origin,
      TEST_BASE_URL: deployed.origin,
      TEST_OUTPUT_DIR: "test-results/deployed",
    },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
mkdirSync("test-results/deployed", { recursive: true });
writeFileSync(
  "test-results/deployed/parity.json",
  JSON.stringify(
    {
      url: deployed.origin,
      checkedAt: new Date().toISOString(),
      comparisons,
      staticAssets,
      htmlIdentical: true,
    },
    null,
    2,
  ),
);
