import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
// Real workerd + isolated D1: production visibility cannot be tested with mock arrays.
const bundle = await build({
  entryPoints: ["worker/index.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
});
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-09-18",
    d1Databases: ["DB"],
    bindings: { APP_MODE: "production", TOUR_API_ENABLED: "false" },
    cf: false,
    unsafeTriggerHandlers: true,
  }),
);
try {
  const db = await mf.getD1Database("DB");
  // Split by semicolon: this migration has no compound triggers or semicolons in strings.
  for (const sql of readFileSync("migrations/0001_initial.sql", "utf8")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean))
    await db.prepare(sql).run();
  const now = new Date().toISOString(),
    old = new Date(Date.now() - 96 * 3600_000).toISOString();
  const future = new Date(Date.now() + 96 * 3600_000).toISOString();
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  await db
    .prepare(
      "INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES('official','organizer',1,'테스트 전용 출처','https://example.org/event',?)",
    )
    .bind(now)
    .run();
  await db
    .prepare(
      "INSERT INTO sources(id,kind,priority,name,fetched_at) VALUES('sample','sample',5,'가상 출처',?)",
    )
    .bind(now)
    .run();
  async function fixture(
    id,
    {
      sample = false,
      verification = "verified",
      status = "scheduled",
      checked = now,
      cost = "unknown",
      pet = "unknown",
      lat = null,
      lng = null,
    } = {},
  ) {
    await db
      .prepare(
        `INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,cost,pet_policy,lat,lng,status,verification,is_sample,primary_source_id,checked_at)
      VALUES(?,?,'검증 테스트 전용','서울','테스트 장소','테스트 주소',?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id,
        id,
        today,
        today,
        cost,
        pet,
        lat,
        lng,
        status,
        sample ? "sample" : verification,
        sample ? 1 : 0,
        sample ? "sample" : "official",
        checked,
      )
      .run();
  }
  async function evidence(id, fields, checked = now, source = "official") {
    for (const field of fields)
      await db
        .prepare(
          "INSERT INTO event_evidence(event_id,source_id,field,excerpt,checked_at) VALUES(?,?,?,?,?)",
        )
        .bind(id, source, field, "테스트 근거", checked)
        .run();
  }
  const required = ["schedule", "venue", "status"];
  await fixture("verified");
  await evidence("verified", required);
  await fixture("sample-hidden", { sample: true });
  await fixture("pending-hidden", { verification: "pending" });
  await evidence("pending-hidden", required);
  await fixture("no-evidence-hidden");
  await fixture("stale-hidden", { checked: old });
  await evidence("stale-hidden", required, old);
  await fixture("stale-evidence-hidden");
  await evidence("stale-evidence-hidden", required, old);
  await fixture("future-hidden", { checked: future });
  await evidence("future-hidden", required);
  await fixture("cancelled-hidden", { status: "cancelled" });
  await evidence("cancelled-hidden", required);
  await fixture("postponed-hidden", { status: "postponed" });
  await evidence("postponed-hidden", required);
  await fixture("no-price-hidden", { cost: "free" });
  await evidence("no-price-hidden", required);
  await fixture("free-verified", { cost: "free" });
  await evidence("free-verified", [...required, "price"]);
  await fixture("sample-evidence-hidden");
  await evidence("sample-evidence-hidden", required, now, "sample");
  await fixture("no-tag-evidence-hidden");
  await evidence("no-tag-evidence-hidden", required);
  await db
    .prepare(
      "INSERT INTO event_tags(event_id,tag) VALUES('no-tag-evidence-hidden','kids')",
    )
    .run();
  await fixture("no-coordinate-evidence-hidden", { lat: 37, lng: 127 });
  await evidence("no-coordinate-evidence-hidden", required);
  await fixture("no-pet-evidence-hidden", { pet: "allowed" });
  await evidence("no-pet-evidence-hidden", required);
  await fixture("pet-verified", { pet: "allowed" });
  await evidence("pet-verified", [...required, "pet_policy", "pets"]);
  await db
    .prepare(
      "INSERT INTO event_tags(event_id,tag) VALUES('pet-verified','pets')",
    )
    .run();
  async function get(path, status = 200) {
    const r = await mf.dispatchFetch("http://localhost" + path);
    assert.equal(r.status, status, path);
    return r.json();
  }
  const data = await get("/api/events?period=today");
  assert.deepEqual(data.events.map((e) => e.id).sort(), [
    "free-verified",
    "pet-verified",
    "verified",
  ]);
  assert.equal((await get("/api/events?period=today&cost=free")).total, 1);
  assert.equal(
    (await get("/api/events?period=today&audience=pets")).events[0].id,
    "pet-verified",
  );
  await get("/api/events/sample-hidden", 404);
  await get("/api/events/no-evidence-hidden", 404);
  assert.equal(
    (await get("/api/events/cancelled-hidden")).event.status,
    "cancelled",
  );
  assert.equal((await get("/api/events/verified")).evidence.length, 3);
  const cron = await mf.dispatchFetch(
    "http://localhost/cdn-cgi/local/scheduled?cron=0+21+*+*+*",
  );
  assert.equal(cron.status, 200);
  assert.equal(
    (
      await db
        .prepare("SELECT verification FROM events WHERE id='stale-hidden'")
        .first()
    ).verification,
    "stale",
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT reason FROM event_changes WHERE event_id='stale-hidden'",
        )
        .first()
    ).reason,
    "근거 확인 후 72시간 경과",
  );
  const run = await db
    .prepare("SELECT status,stale_count FROM sync_runs")
    .first();
  assert.equal(run.status, "skipped");
  assert.equal(run.stale_count, 1);
  console.log(
    "PASS: 실제 workerd/D1 운영 샘플 차단, 필수 근거·가격·태그·좌표·반려동물 검증, 오래된/미래 근거 제외, 취소·연기 제외, Cron 상태/감사 이력",
  );
} finally {
  await mf.dispose();
}
