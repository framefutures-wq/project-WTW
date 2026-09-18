import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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
  for (const file of readdirSync("migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const sql of readFileSync(`migrations/${file}`, "utf8")
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
  const adapterBundle = await build({
    entryPoints: ["worker/sources/tourapi.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "es2022",
  });
  const adapter = await import(
    "data:text/javascript;base64," +
      Buffer.from(adapterBundle.outputFiles[0].text).toString("base64")
  );
  const raw = {
    contentid: "101",
    contenttypeid: "15",
    title: "TourAPI 계약 테스트 전용",
    addr1: "합성 테스트 주소",
    lDongRegnCd: "11",
    eventstartdate: today.replaceAll("-", ""),
    eventenddate: today.replaceAll("-", ""),
    progresstype: "선택안함",
    mapx: "127",
    mapy: "37",
  };
  const tourEvent = adapter.mapFestival(raw, new Map([["11", "서울"]]), now);
  const snapshot = {
    candidates: [{ event: tourEvent, raw }],
    rejected: 0,
    fetched: 1,
    today,
    until: today,
    checkedAt: now,
  };
  await adapter.saveFestivalSnapshot(db, snapshot);
  await adapter.saveFestivalSnapshot(db, snapshot);
  const real = await get("/api/events/tourapi-101");
  assert.equal(real.event.is_sample, 0);
  assert.equal(real.event.status, "unknown");
  assert.equal(real.event.cost, "unknown");
  assert.deepEqual(real.event.tags, []);
  assert.equal(real.evidence.length, 4);
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) n FROM events WHERE id='tourapi-101'")
        .first()
    ).n,
    1,
  );
  assert(
    (await get("/api/events?period=today&region=서울")).events.some(
      (e) => e.id === "tourapi-101",
    ),
  );
  assert(
    !(await get("/api/events?period=today&region=부산")).events.some(
      (e) => e.id === "tourapi-101",
    ),
  );
  assert(
    !(await get("/api/events?period=today&cost=free")).events.some(
      (e) => e.id === "tourapi-101",
    ),
  );
  const cancelledRaw = { ...raw, progresstype: "취소" };
  await adapter.saveFestivalSnapshot(db, {
    ...snapshot,
    candidates: [
      {
        raw: cancelledRaw,
        event: adapter.mapFestival(
          cancelledRaw,
          new Map([["11", "서울"]]),
          now,
        ),
      },
    ],
  });
  assert.equal(
    (await get("/api/events/tourapi-101")).event.status,
    "cancelled",
  );
  assert(
    !(await get("/api/events?period=today")).events.some(
      (e) => e.id === "tourapi-101",
    ),
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT count(*) n FROM event_changes WHERE event_id='tourapi-101'",
        )
        .first()
    ).n,
    1,
  );
  const nextRaw = { ...raw, contentid: "103" };
  const nextChecked = new Date().toISOString();
  await adapter.saveFestivalSnapshot(db, {
    ...snapshot,
    checkedAt: nextChecked,
    candidates: [
      {
        raw: nextRaw,
        event: adapter.mapFestival(
          nextRaw,
          new Map([["11", "서울"]]),
          nextChecked,
        ),
      },
    ],
  });
  assert.equal(
    (
      await db
        .prepare(
          "SELECT verification,status FROM events WHERE id='tourapi-101'",
        )
        .first()
    ).verification,
    "stale",
  );
  await get("/api/events/tourapi-101", 404);
  const broken = { ...tourEvent, id: "tourapi-102", lat: 200 };
  await assert.rejects(() =>
    adapter.saveFestivalSnapshot(db, {
      ...snapshot,
      candidates: [{ event: broken, raw }],
    }),
  );
  assert.equal(
    await db
      .prepare("SELECT id FROM sources WHERE id='tourapi-102-source'")
      .first(),
    null,
  );
  console.log(
    "PASS: TourAPI 합성 계약 데이터 D1 트랜잭션, 재실행 중복 방지, 기간/지역/무료 필터, 미확인 정보 유지, 취소 갱신 제외, 실패 롤백",
  );
  await db
    .prepare(
      "INSERT INTO sync_runs(id,started_at,status,provider) VALUES('reject-test',?,'running','tourapi')",
    )
    .bind(now)
    .run();
  const originalFetch = globalThis.fetch;
  let fixtureItems;
  const provinceNames = [
    "서울특별시",
    "전남광주통합특별시",
    "부산광역시",
    "대구광역시",
    "인천광역시",
    "대전광역시",
    "울산광역시",
    "경기도",
    "충청북도",
    "충청남도",
    "경상북도",
    "경상남도",
    "제주특별자치도",
    "강원특별자치도",
    "전북특별자치도",
    "세종특별자치시",
  ];
  globalThis.fetch = async (url) => {
    const items = new URL(url).pathname.endsWith("/ldongCode2")
      ? provinceNames.map((name, i) => ({
          name,
          code: i === 0 ? "11" : String(100 + i),
        }))
      : fixtureItems;
    return Response.json({
      response: {
        header: { resultCode: "0000" },
        body: { totalCount: items.length, items: { item: items } },
      },
    });
  };
  const env = {
    DB: db,
    TOUR_API_ENABLED: "true",
    TOUR_API_KEY: "synthetic-contract-only",
  };
  const badRaw = {
    ...raw,
    contentid: "901",
    eventenddate: "20260230",
    untouched: { official: "원문 보존" },
  };
  try {
    fixtureItems = [raw, badRaw];
    const result = await adapter.syncTourApi(env, "reject-test");
    assert.equal(result.imported, 1);
    assert.equal(result.rejected, 1);
    const rejected = await db
      .prepare("SELECT * FROM tourapi_rejections WHERE content_id='901'")
      .first();
    assert.equal(rejected.sync_run_id, "reject-test");
    assert.equal(rejected.title, badRaw.title);
    assert.deepEqual(JSON.parse(rejected.raw_payload), badRaw);
    assert.deepEqual(JSON.parse(rejected.reason), ["INVALID_END_DATE"]);
    assert(Number.isFinite(Date.parse(rejected.rejected_at)));
    assert.equal(
      await db.prepare("SELECT id FROM events WHERE id='tourapi-901'").first(),
      null,
    );
    fixtureItems = [{ ...badRaw, contentid: "902" }];
    await assert.rejects(() => adapter.syncTourApi(env, "reject-test"));
    assert(
      await db
        .prepare("SELECT id FROM tourapi_rejections WHERE content_id='902'")
        .first(),
    );
    // Force normal-event storage to fail, after an invalid item's rejection was committed.
    await db
      .prepare(
        "CREATE TRIGGER reject_test_failure BEFORE INSERT ON events WHEN NEW.id='tourapi-999' BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END",
      )
      .run();
    fixtureItems = [
      { ...raw, contentid: "999" },
      { ...badRaw, contentid: "903" },
    ];
    await assert.rejects(() => adapter.syncTourApi(env, "reject-test"));
    assert(
      await db
        .prepare("SELECT id FROM tourapi_rejections WHERE content_id='903'")
        .first(),
    );
    assert.deepEqual(
      JSON.parse(
        (
          await db
            .prepare(
              "SELECT reason FROM tourapi_rejections WHERE content_id='999'",
            )
            .first()
        ).reason,
      ),
      ["EVENT_TRANSACTION_FAILED"],
    );
    assert.equal(
      await db
        .prepare("SELECT id FROM sources WHERE id='tourapi-999-source'")
        .first(),
      null,
    );
    await db.prepare("DROP TRIGGER reject_test_failure").run();
    fixtureItems = [raw, raw];
    await assert.rejects(() => adapter.syncTourApi(env, "reject-test"));
    assert(
      await db
        .prepare(
          "SELECT id FROM tourapi_rejections WHERE reason LIKE '%DUPLICATE_CONTENT_ID%'",
        )
        .first(),
    );
    assert.deepEqual(
      (await db.prepare("PRAGMA foreign_key_check").all()).results,
      [],
    );
    await assert.rejects(() =>
      adapter.saveRejections(db, "missing-run", [
        { raw: badRaw, reasons: ["INVALID_END_DATE"] },
      ]),
    );
  } finally {
    globalThis.fetch = originalFetch;
    await db
      .prepare(
        "UPDATE sync_runs SET status='success',finished_at=? WHERE id='reject-test'",
      )
      .bind(new Date().toISOString())
      .run();
  }
  console.log(
    "PASS: TourAPI 거절 원문·사유·시각·sync_run 연결, 전체 거절·중복 실패 기록, 행사 롤백 후 거절 기록 보존, 외래키 검증",
  );
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
    .prepare(
      "SELECT status,stale_count FROM sync_runs WHERE provider='maintenance'",
    )
    .first();
  assert.equal(run.status, "skipped");
  assert.equal(run.stale_count, 1);
  console.log(
    "PASS: 실제 workerd/D1 운영 샘플 차단, 필수 근거·가격·태그·좌표·반려동물 검증, 오래된/미래 근거 제외, 취소·연기 제외, Cron 상태/감사 이력",
  );
} finally {
  await mf.dispose();
}
