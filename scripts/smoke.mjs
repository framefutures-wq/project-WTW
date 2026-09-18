import assert from "node:assert/strict";
const base = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:8787";
async function get(path, status = 200) {
  const r = await fetch(base + path);
  assert.equal(r.status, status, path);
  assert.match(r.headers.get("content-type") ?? "", /application\/json/);
  return r.json();
}
assert.equal((await get("/api/health")).database, "connected");
const all = await get("/api/events?limit=50");
assert.ok(all.total > 0, "먼저 npm run setup으로 샘플을 넣으세요.");
assert.ok(
  all.events.every((e) => e.is_sample === 1 && e.status === "scheduled"),
);
for (const period of ["today", "weekend", "next-weekend"]) {
  const data = await get("/api/events?period=" + period);
  assert.ok(data.total > 0);
  assert.ok(
    data.events.every(
      (e) => e.start_date <= data.range.end && e.end_date >= data.range.start,
    ),
  );
}
const filtered = await get("/api/events?region=서울&cost=free&theme=flowers");
assert.ok(filtered.total > 0);
assert.ok(
  filtered.events.every(
    (e) =>
      e.region === "서울" && e.cost === "free" && e.tags.includes("flowers"),
  ),
);
const pets = await get("/api/events?audience=pets");
assert.ok(pets.total > 0);
assert.ok(pets.events.every((e) => e.pet_policy === "allowed"));
const distance = await get(
  "/api/events?sort=distance&lat=37.5665&lng=126.978&limit=50",
);
for (let i = 1; i < distance.events.length; i++)
  assert.ok(
    (distance.events[i - 1].distance_km ?? Infinity) <=
      (distance.events[i].distance_km ?? Infinity),
  );
const first = await get("/api/events?limit=1&page=1"),
  second = await get("/api/events?limit=1&page=2");
assert.notEqual(first.events[0].id, second.events[0].id);
assert.equal(
  (await get("/api/events/" + all.events[0].id)).event.id,
  all.events[0].id,
);
assert.ok(!all.events.some((e) => e.id === "sample-cancelled"));
await get("/api/events/not-found", 404);
await get("/api/unknown", 404);
await get("/api/events?sort=distance", 400);
await get("/api/events?region=invalid", 400);
assert.equal(
  (await fetch(base + "/api/events", { method: "POST" })).status,
  405,
);
const injection = await get(
  "/api/events?q=" + encodeURIComponent("' OR 1=1 --"),
);
assert.equal(injection.total, 0);
const literal = await get("/api/events?q=%25");
assert.equal(literal.total, 0);
assert.match(await (await fetch(base + "/")).text(), /<div id="root">/);
assert.match(await (await fetch(base + "/explore")).text(), /<div id="root">/);
const cron = await fetch(base + "/cdn-cgi/local/scheduled?cron=0+21+*+*+*");
assert.equal(cron.status, 200);
console.log(
  "PASS: D1 연결, 세 날짜 구간, 필터, 반려동물, 거리순, 페이지, 상세, 취소 제외, 입력 검증, SQL 바인딩, Static Assets, SPA, Cron",
);
