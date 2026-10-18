import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  cleanupExpiredOfficialDetailJobs,
  officialDetailEnqueueOne,
  runOfficialDetailMicroJobOne,
} from "../worker/sources/official-detail-jobs";
import { runOfficialDetailRecovery } from "../worker/sources/official-detail-recovery";

const START = "2026-09-28T01:00:00.000Z";
const OFFICIAL_URL = "https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016";
const title = "제9회 동오마을축제 2026 동오마을 푸드페스타";
const core = `<h1>${title}</h1><p>2026. 10. 3. 동오마을 공영주차장</p>`;
const richHtml = `${core}<table><tr><th>시간</th><td>13:00~20:00</td></tr><tr><th>이용요금</th><td>무료</td></tr><tr><th>문의처</th><td>031-828-0000</td></tr></table><h2>행사개요</h2><p>동오마을에서 지역 상인과 주민이 함께 참여해 먹거리와 체험을 즐기는 공식 먹거리 축제입니다.</p><img src="/upload/food-poster.jpg" width="900" height="1200" alt="동오마을 축제 포스터">`;
const sparseHtml = `${core}<p>행사 시간: 12:00~19:00</p>`;

async function setup() {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: "export default {fetch(){return new Response('ok')}}",
    compatibilityDate: "2026-09-18", d1Databases: ["DB"], cf: false,
  }));
  const DB = await mf.getD1Database("DB");
  for (const file of readdirSync("migrations").sort())
    for (const sql of readFileSync(`migrations/${file}`, "utf8").split(";").map((part) => part.trim()).filter(Boolean))
      await DB.prepare(sql).run();
  await DB.prepare("INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES('municipality','municipality',2,'의정부시','https://ui4u.go.kr/portal/eventNoti/list.do','2026-09-27T00:00:00Z')").run();
  await DB.prepare(`INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,cost,pet_policy,status,verification,is_sample,primary_source_id,checked_at,publish_quality_state,publish_quality_reason,publish_quality_rule_version,publish_quality_checked_at)
    VALUES('event-1',?,'기존 설명','경기','동오마을 공영주차장','동오마을 공영주차장','2026-10-03','2026-10-03','unknown','unknown','scheduled','verified',0,'municipality','2026-09-27T00:00:00Z','PUBLIC','ok','v1','2026-09-27T00:00:00Z')`).bind(title).run();
  await DB.prepare("INSERT INTO event_official_links(event_id,source_id,url,checked_at) VALUES('event-1','municipality',?,'2026-09-27T00:00:00Z')").bind(OFFICIAL_URL).run();
  return { mf, DB, env: { DB } as never };
}

async function posterFixture(DB: D1Database) {
  await DB.prepare(`INSERT INTO event_images(event_id,image_url,source_type,source_page_url,is_primary,image_status,last_checked_at)
    VALUES('event-1','https://ui4u.go.kr/poster.jpg','municipality',?,1,'ok','2026-09-27T00:00:00Z')`).bind(OFFICIAL_URL).run();
}

async function seedSecond(DB: D1Database) {
  await DB.prepare(`INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,cost,pet_policy,status,verification,is_sample,primary_source_id,checked_at,publish_quality_state,publish_quality_reason,publish_quality_rule_version,publish_quality_checked_at)
    SELECT 'event-2',title,description,region,venue,address,start_date,end_date,cost,pet_policy,status,verification,is_sample,primary_source_id,checked_at,publish_quality_state,publish_quality_reason,publish_quality_rule_version,publish_quality_checked_at
    FROM events WHERE id='event-1'`).run();
  await DB.prepare("INSERT INTO event_official_links(event_id,source_id,url,checked_at) VALUES('event-2','municipality',?,'2026-09-27T00:00:00Z')").bind(OFFICIAL_URL).run();
}

const posterAi = () => ({ async run() {
  return { choices: [{ message: { content: JSON.stringify({ transcription: [
    "동오마을 푸드 페스타", "2026. 10. 3.(토)", "12:00~19:00",
    "동오마을 공영주차장", "떡볶이 한판", "무대공연", "체험",
  ].join("\n") }) } }] };
} });

async function job(DB: D1Database) {
  return DB.prepare("SELECT generation,stage,raw_html,raw_html_sha256,normalized_json,attempt_count,available_at FROM official_detail_jobs WHERE event_id='event-1'")
    .first<{ generation: number; stage: string; raw_html: string | null; raw_html_sha256: string | null; normalized_json: string | null; attempt_count: number; available_at: string }>();
}

async function snapshot(DB: D1Database) {
  const source = await DB.prepare("SELECT kind,priority,raw_payload FROM sources WHERE id='official-detail-event-1'").first<{ kind: string; priority: number; raw_payload: string }>();
  const raw = source?.raw_payload ? JSON.parse(source.raw_payload) : null;
  const poster = await DB.prepare("SELECT raw_payload FROM sources WHERE id='official-poster-event-1'").first<{ raw_payload: string }>();
  const posterState = poster?.raw_payload ? JSON.parse(poster.raw_payload) : null;
  const [summary, hours, programs, images, link] = await Promise.all([
    DB.prepare("SELECT summary,source_id FROM event_enrichments WHERE event_id='event-1' ORDER BY source_id").all(),
    DB.prepare("SELECT start_time,end_time,source_id FROM event_operating_hours WHERE event_id='event-1' ORDER BY start_time").all(),
    DB.prepare("SELECT program_name,source_id FROM event_programs WHERE event_id='event-1' ORDER BY sort_order,program_name").all(),
    DB.prepare("SELECT image_url,source_type,source_page_url,is_primary FROM event_images WHERE event_id='event-1' ORDER BY image_url").all(),
    DB.prepare("SELECT url FROM event_official_links WHERE event_id='event-1' AND source_id='municipality'").first(),
  ]);
  return {
    source: source && { kind: source.kind, priority: source.priority,
      status: raw?.official_detail_recovery?.status ?? "rich_detail",
      price: raw?.municipal_rich_detail?.price_text ?? null,
      contact: raw?.municipal_rich_detail?.contact_phone ?? null },
    summary: summary.results, hours: hours.results, programs: programs.results,
    images: images.results, link,
    posterStatus: posterState?.latest_attempt?.status ?? null,
  };
}

test("enqueue is one-at-a-time, active is unique, DONE only reopens when selector is due, and generation fences stale updates", async () => {
  const { mf, DB } = await setup();
  try {
    assert.deepEqual(await officialDetailEnqueueOne(DB, START), { stage: "ENQUEUE_ONE", status: "enqueued", job_id: "event-1" });
    assert.equal((await job(DB))?.generation, 1);
    assert.equal(await officialDetailEnqueueOne(DB, START), null);
    await DB.prepare("UPDATE official_detail_jobs SET stage='DONE' WHERE event_id='event-1'").run();
    // A completed rich result is filtered by the original selector.
    await DB.prepare("INSERT INTO event_enrichments(event_id,summary,source_id,evidence_excerpt) VALUES('event-1',?,'municipality','official')")
      .bind("동오마을에서 지역 상인과 주민이 함께하는 공식 먹거리 축제입니다.").run();
    await DB.prepare("INSERT INTO event_operating_hours(id,event_id,start_date,end_date,start_time,end_time,source_id,evidence_excerpt) VALUES('hours','event-1','2026-10-03','2026-10-03','13:00','20:00','municipality','official')").run();
    await DB.prepare("INSERT INTO event_images(event_id,image_url,source_type,source_page_url,is_primary,image_status,last_checked_at) VALUES('event-1','https://ui4u.go.kr/poster.jpg','municipality',?,1,'ok','2026-09-27T00:00:00Z')").bind(OFFICIAL_URL).run();
    assert.equal(await officialDetailEnqueueOne(DB, START), null);
    await DB.prepare("DELETE FROM event_images WHERE event_id='event-1'").run();
    assert.equal((await officialDetailEnqueueOne(DB, START))?.status, "enqueued");
    assert.equal((await job(DB))?.generation, 2);
    const stale = await DB.prepare("UPDATE official_detail_jobs SET stage='PARSE_PENDING' WHERE event_id='event-1' AND generation=1 AND stage='FETCH_PENDING'").run();
    assert.equal(stale.meta.changes, 0);
  } finally { await mf.dispose(); }
});

test("two due candidates enqueue separately; a ready persist outranks fetch and no second stage runs", async () => {
  const { mf, DB, env } = await setup();
  try {
    await seedSecond(DB);
    assert.equal((await officialDetailEnqueueOne(DB, START))?.job_id, "event-1");
    assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM official_detail_jobs").first<{ n: number }>())?.n, 1);
    assert.equal((await officialDetailEnqueueOne(DB, START))?.job_id, "event-2");
    await DB.prepare("UPDATE official_detail_jobs SET stage='PERSIST_PENDING',normalized_json=? WHERE event_id='event-1'")
      .bind(JSON.stringify({ status: "failure", reason: "synthetic_failure" })).run();
    let fetches = 0;
    const result = await runOfficialDetailMicroJobOne(env, START, { fetchPage: async (url) => {
      fetches++;
      return { html: richHtml, finalUrl: url };
    } });
    assert.deepEqual(result, { stage: "PERSIST_PENDING", status: "done", job_id: "event-1" });
    assert.equal(fetches, 0);
    assert.equal((await DB.prepare("SELECT stage FROM official_detail_jobs WHERE event_id='event-2'").first<{ stage: string }>())?.stage, "FETCH_PENDING");
  } finally { await mf.dispose(); }
});

test("each direct/Reader/parse/poster/persist checkpoint advances only one stage and clears large data", async () => {
  const { mf, DB, env } = await setup();
  try {
    await officialDetailEnqueueOne(DB, START);
    const calls = { direct: 0, reader: 0, poster: 0 };
    const deps = {
      fetchPage: async (url: string) => { calls.direct++; return { html: richHtml, finalUrl: url }; },
      fetchReader: async (url: string) => { calls.reader++; return { html: richHtml, finalUrl: url }; },
      recoverPoster: async () => { calls.poster++; return null; },
    };
    assert.deepEqual(await runOfficialDetailMicroJobOne(env, START, deps), { stage: "FETCH_PENDING", status: "parse_pending", job_id: "event-1" });
    assert.equal((await job(DB))?.stage, "PARSE_PENDING");
    assert.deepEqual(calls, { direct: 1, reader: 0, poster: 0 });
    assert.equal((await job(DB))?.raw_html, richHtml);
    assert.equal((await runOfficialDetailMicroJobOne(env, START, deps)).stage, "PARSE_PENDING");
    assert.equal((await job(DB))?.raw_html, null);
    assert.equal((await job(DB))?.raw_html_sha256, null);
    assert.equal((await job(DB))?.stage, "PERSIST_PENDING");
    assert.equal(calls.poster, 0);
    assert.equal((await runOfficialDetailMicroJobOne(env, START, deps)).stage, "PERSIST_PENDING");
    assert.equal((await job(DB))?.stage, "DONE");
    assert.equal((await job(DB))?.normalized_json, null);
    assert.deepEqual(calls, { direct: 1, reader: 0, poster: 0 });
    assert.equal((await runOfficialDetailMicroJobOne(env, START, deps)).stage, "NO_OP");
  } finally { await mf.dispose(); }
});

test("retryable direct failure defers Reader; Reader success defers parser", async () => {
  const { mf, DB, env } = await setup();
  try {
    await officialDetailEnqueueOne(DB, START);
    const calls = { direct: 0, reader: 0 };
    const deps = {
      fetchPage: async () => { calls.direct++; throw new TypeError("network"); },
      fetchReader: async (url: string) => { calls.reader++; return { html: richHtml, finalUrl: url }; },
    };
    assert.equal((await runOfficialDetailMicroJobOne(env, START, deps)).status, "reader_pending");
    const directAttempts = calls.direct;
    assert.ok(directAttempts >= 1);
    assert.equal(calls.reader, 0);
    assert.equal((await runOfficialDetailMicroJobOne(env, START, deps)).status, "parse_pending");
    assert.deepEqual(calls, { direct: directAttempts, reader: 1 });
    assert.equal((await job(DB))?.stage, "PARSE_PENDING");
  } finally { await mf.dispose(); }
});

test("Reader failure reaches the same safe legacy attempt state; future retry is not claimed", async () => {
  const { mf, DB, env } = await setup();
  try {
    await officialDetailEnqueueOne(DB, START);
    const deps = {
      fetchPage: async () => { throw new TypeError("network"); },
      fetchReader: async () => { throw new Error("reader down"); },
    };
    await runOfficialDetailMicroJobOne(env, START, deps);
    assert.equal((await runOfficialDetailMicroJobOne(env, START, deps)).stage, "READER_PENDING");
    assert.equal((await job(DB))?.stage, "PERSIST_PENDING");
    assert.equal((await runOfficialDetailMicroJobOne(env, START, deps)).status, "done");
    const state = await DB.prepare("SELECT raw_payload FROM sources WHERE id='official-detail-event-1'").first<{ raw_payload: string }>();
    assert.equal(JSON.parse(state!.raw_payload).official_detail_recovery.status, "network_error");
    await DB.prepare("UPDATE official_detail_jobs SET stage='RETRY',retry_stage='FETCH_PENDING',available_at='2026-09-29T01:00:00Z' WHERE event_id='event-1'").run();
    assert.equal((await runOfficialDetailMicroJobOne(env, START, deps)).stage, "NO_OP");
  } finally { await mf.dispose(); }
});

test("nonretryable direct failure checkpoints a safe attempt without Reader", async () => {
  const { mf, DB, env } = await setup();
  try {
    await officialDetailEnqueueOne(DB, START);
    let readerCalls = 0;
    const deps = {
      fetchPage: async () => { throw new Error("official_detail_http_404"); },
      fetchReader: async (url: string) => { readerCalls++; return { html: richHtml, finalUrl: url }; },
    };
    assert.equal((await runOfficialDetailMicroJobOne(env, START, deps)).status, "persist_pending");
    assert.equal(readerCalls, 0);
    assert.equal((await job(DB))?.stage, "PERSIST_PENDING");
    await runOfficialDetailMicroJobOne(env, START, deps);
    const state = await DB.prepare("SELECT raw_payload FROM sources WHERE id='official-detail-event-1'").first<{ raw_payload: string }>();
    assert.equal(JSON.parse(state!.raw_payload).official_detail_recovery.status, "official_detail_http_404");
  } finally { await mf.dispose(); }
});

test("raw checkpoint cap fails closed into Reader without parsing large HTML", async () => {
  const { mf, DB, env } = await setup();
  try {
    await officialDetailEnqueueOne(DB, START);
    assert.equal((await runOfficialDetailMicroJobOne(env, START, {
      fetchPage: async (url) => ({ html: "x".repeat(300 * 1024 + 1), finalUrl: url }),
    })).status, "reader_pending");
    assert.equal((await job(DB))?.raw_html, null);
  } finally { await mf.dispose(); }
});

test("expiry clears checkpoints, records cooldown, and cannot retain an active job forever", async () => {
  const { mf, DB, env } = await setup();
  try {
    await officialDetailEnqueueOne(DB, START);
    await seedSecond(DB);
    await DB.prepare("UPDATE official_detail_jobs SET expires_at='2026-09-28T00:59:59Z',raw_html='stale' WHERE event_id='event-1'").run();
    assert.equal((await runOfficialDetailMicroJobOne(env, START)).stage, "CLEANUP");
    assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM official_detail_jobs").first<{ n: number }>())?.n, 1);
    assert.equal((await job(DB))?.stage, "DONE");
    assert.equal((await job(DB))?.raw_html, null);
    assert.equal((await officialDetailEnqueueOne(DB, START))?.job_id, "event-2");
    assert.equal(await cleanupExpiredOfficialDetailJobs(DB, START), null);
  } finally { await mf.dispose(); }
});

test("sparse parse defers poster; unavailable poster preserves verified HTML and performs no OCR persistence in that stage", async () => {
  const { mf, DB, env } = await setup();
  try {
    await officialDetailEnqueueOne(DB, START);
    let posterCalls = 0;
    const deps = {
      fetchPage: async (url: string) => ({ html: sparseHtml, finalUrl: url }),
      recoverPoster: async () => { posterCalls++; return null; },
    };
    assert.equal((await runOfficialDetailMicroJobOne(env, START, deps)).stage, "FETCH_PENDING");
    assert.equal((await runOfficialDetailMicroJobOne(env, START, deps)).status, "poster_pending");
    assert.equal(posterCalls, 0);
    assert.equal((await DB.prepare("SELECT raw_payload FROM sources WHERE id='official-detail-event-1'").first()), null);
    assert.equal((await runOfficialDetailMicroJobOne(env, START, deps)).stage, "POSTER_PENDING");
    assert.equal(posterCalls, 1);
    assert.equal((await DB.prepare("SELECT raw_payload FROM sources WHERE id='official-detail-event-1'").first()), null);
    assert.equal((await runOfficialDetailMicroJobOne(env, START, deps)).status, "done");
    const hours = await DB.prepare("SELECT start_time,end_time FROM event_operating_hours WHERE event_id='event-1'")
      .first<{ start_time: string; end_time: string }>();
    assert.deepEqual(hours, { start_time: "12:00", end_time: "19:00" });
  } finally { await mf.dispose(); }
});

test("poster core mismatch fails closed and retains only verified HTML facts", async () => {
  const { mf, DB } = await setup();
  const originalFetch = globalThis.fetch;
  try {
    await posterFixture(DB);
    globalThis.fetch = (async () => new Response(new Uint8Array([255, 216, 255]), {
      status: 200, headers: { "content-type": "image/jpeg" },
    })) as typeof fetch;
    const env = { DB, MUNICIPAL_DOCUMENT_AI_ENABLED: "true", AI: { async run() {
      return { choices: [{ message: { content: JSON.stringify({ transcription: "다른 도시의 전혀 다른 공연 2026. 11. 9. 서울 공연장" }) } }] };
    } } } as never;
    await officialDetailEnqueueOne(DB, START);
    const deps = { fetchPage: async (url: string) => ({ html: sparseHtml, finalUrl: url }) };
    await runOfficialDetailMicroJobOne(env, START, deps);
    await runOfficialDetailMicroJobOne(env, START, deps);
    assert.equal((await runOfficialDetailMicroJobOne(env, START, deps)).stage, "POSTER_PENDING");
    const posterState = await DB.prepare("SELECT raw_payload FROM sources WHERE id='official-poster-event-1'").first<{ raw_payload: string }>();
    assert.equal(JSON.parse(posterState!.raw_payload).latest_attempt.status, "core_mismatch");
    await runOfficialDetailMicroJobOne(env, START, deps);
    const hours = await DB.prepare("SELECT start_time,end_time FROM event_operating_hours WHERE event_id='event-1'")
      .first<{ start_time: string; end_time: string }>();
    assert.deepEqual(hours, { start_time: "12:00", end_time: "19:00" });
    assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM event_programs WHERE event_id='event-1'").first<{ n: number }>())?.n, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await mf.dispose();
  }
});

test("poster exception uses a future retry checkpoint, keeps HTML facts, and resumes one stage at a time", async () => {
  const { mf, DB, env } = await setup();
  try {
    await officialDetailEnqueueOne(DB, START);
    const deps = {
      fetchPage: async (url: string) => ({ html: sparseHtml, finalUrl: url }),
      recoverPoster: async () => { throw new Error("synthetic OCR outage"); },
    };
    await runOfficialDetailMicroJobOne(env, START, deps);
    await runOfficialDetailMicroJobOne(env, START, deps);
    assert.equal((await runOfficialDetailMicroJobOne(env, START, deps)).status, "RETRY");
    assert.equal((await job(DB))?.stage, "RETRY");
    assert.ok((await job(DB))?.normalized_json?.includes("operating_hours"));
    assert.equal((await runOfficialDetailMicroJobOne(env, START, deps)).stage, "NO_OP");
    const due = "2026-09-28T01:11:00.000Z";
    assert.equal((await runOfficialDetailMicroJobOne(env, due, deps)).stage, "RETRY");
    assert.equal((await job(DB))?.stage, "POSTER_PENDING");
    assert.equal((await runOfficialDetailMicroJobOne(env, due, { ...deps, recoverPoster: async () => null })).stage, "POSTER_PENDING");
    assert.equal((await job(DB))?.stage, "PERSIST_PENDING");
  } finally { await mf.dispose(); }
});

test("higher-priority organizer summary survives municipal recovery and duplicate concurrent claims do not duplicate persistence", async () => {
  const { mf, DB, env } = await setup();
  try {
    await DB.prepare("INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES('organizer','organizer',1,'주최자','https://festival.example.org/event','2026-09-27T00:00:00Z')").run();
    await DB.prepare("INSERT INTO event_enrichments(event_id,summary,source_id,evidence_excerpt) VALUES('event-1','지역 예술가와 주민이 함께 만드는 공식 행사입니다.','organizer','official')").run();
    await DB.prepare("INSERT INTO event_programs(id,event_id,program_name,featured,sort_order,source_id,evidence_excerpt) VALUES('high-program','event-1','주최자 특별 공연',0,0,'organizer','official')").run();
    await DB.prepare("INSERT INTO event_operating_hours(id,event_id,start_date,end_date,start_time,end_time,source_id,evidence_excerpt) VALUES('high-hours','event-1','2026-10-03','2026-10-03','10:00','11:00','organizer','official')").run();
    await DB.prepare("INSERT INTO event_evidence(event_id,source_id,field,excerpt,checked_at) VALUES('event-1','organizer','price','주최자 가격=10,000원',?)").bind(START).run();
    await DB.prepare("UPDATE events SET price_text='10,000원',cost='paid' WHERE id='event-1'").run();
    await officialDetailEnqueueOne(DB, START);
    let fetchCalls = 0;
    const deps = { fetchPage: async (url: string) => {
      fetchCalls++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { html: richHtml, finalUrl: url };
    } };
    const pair = await Promise.all([
      runOfficialDetailMicroJobOne(env, START, deps),
      runOfficialDetailMicroJobOne(env, START, deps),
    ]);
    assert.equal(pair.filter((result) => result.stage === "FETCH_PENDING").length, 1);
    assert.equal(fetchCalls, 1);
    await runOfficialDetailMicroJobOne(env, START, deps);
    await runOfficialDetailMicroJobOne(env, START, deps);
    const high = await DB.prepare("SELECT summary FROM event_enrichments WHERE event_id='event-1' AND source_id='organizer'")
      .first<{ summary: string }>();
    assert.equal(high?.summary, "지역 예술가와 주민이 함께 만드는 공식 행사입니다.");
    assert.deepEqual((await DB.prepare("SELECT program_name,source_id FROM event_programs WHERE event_id='event-1'").all()).results,
      [{ program_name: "주최자 특별 공연", source_id: "organizer" }]);
    assert.deepEqual((await DB.prepare("SELECT start_time,end_time,source_id FROM event_operating_hours WHERE event_id='event-1'").all()).results,
      [{ start_time: "10:00", end_time: "11:00", source_id: "organizer" }]);
    assert.deepEqual(await DB.prepare("SELECT cost,price_text FROM events WHERE id='event-1'").first(),
      { cost: "paid", price_text: "10,000원" });
    assert.equal((await job(DB))?.stage, "DONE");
    const before = await DB.prepare("SELECT COUNT(*) AS n FROM event_images WHERE event_id='event-1'").first<{ n: number }>();
    assert.equal((await runOfficialDetailMicroJobOne(env, START, deps)).stage, "NO_OP");
    const after = await DB.prepare("SELECT COUNT(*) AS n FROM event_images WHERE event_id='event-1'").first<{ n: number }>();
    assert.equal(after?.n, before?.n);
  } finally { await mf.dispose(); }
});

test("legacy and micro chains produce equal final D1 facts for direct, Reader, and poster fixtures", async () => {
  for (const scenario of ["direct", "reader", "poster"] as const) {
    const legacy = await setup();
    const micro = await setup();
    const originalFetch = globalThis.fetch;
    try {
      if (scenario === "poster") {
        await posterFixture(legacy.DB);
        await posterFixture(micro.DB);
      }
      const html = scenario === "poster" ? sparseHtml : richHtml;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("https://r.jina.ai/"))
          return new Response(JSON.stringify({ data: { html, url: OFFICIAL_URL } }), { status: 200, headers: { "content-type": "application/json" } });
        if (url === "https://ui4u.go.kr/poster.jpg")
          return new Response(new Uint8Array([255, 216, 255]), { status: 200, headers: { "content-type": "image/jpeg" } });
        throw new Error(`unexpected test URL: ${url}`);
      }) as typeof fetch;
      const legacyEnv = { DB: legacy.DB, MUNICIPAL_DOCUMENT_AI_ENABLED: "true", AI: posterAi() } as never;
      const microEnv = { DB: micro.DB, MUNICIPAL_DOCUMENT_AI_ENABLED: "true", AI: posterAi() } as never;
      const fetchPage = async (url: string) => {
        if (scenario === "reader") throw new TypeError("network");
        return { html, finalUrl: url };
      };
      const legacyResult = await runOfficialDetailRecovery(legacyEnv, new Date(START), { limit: 1, fetchPage });
      assert.equal(legacyResult.attempted, 1, scenario);
      await officialDetailEnqueueOne(micro.DB, START);
      const sequence: string[] = [];
      for (let i = 0; i < 7; i++) {
        const result = await runOfficialDetailMicroJobOne(microEnv, START, { fetchPage });
        sequence.push(result.stage);
        if ((await job(micro.DB))?.stage === "DONE") break;
      }
      assert.equal((await job(micro.DB))?.stage, "DONE", scenario);
      assert.equal(sequence.filter((stage) => stage === "PERSIST_PENDING").length, 1, scenario);
      assert.deepEqual(await snapshot(micro.DB), await snapshot(legacy.DB), scenario);
    } finally {
      globalThis.fetch = originalFetch;
      await legacy.mf.dispose();
      await micro.mf.dispose();
    }
  }
});
