import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  runOfficialDetailRecovery,
  selectOfficialDetailRecoveryCandidates,
} from "../worker/sources/official-detail-recovery";

async function setup() {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('ok')}}",
      compatibilityDate: "2026-09-18",
      d1Databases: ["DB"],
      cf: false,
    }),
  );
  const DB = await mf.getD1Database("DB");
  for (const file of readdirSync("migrations").sort())
    for (const sql of readFileSync("migrations/" + file, "utf8")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean))
      await DB.prepare(sql).run();
  return { mf, DB };
}

async function seed(DB: D1Database) {
  await DB.prepare(
    "INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload) VALUES('municipality','municipality',2,'의정부시','https://ui4u.go.kr/portal/eventNoti/list.do','2026-09-27T00:00:00Z',NULL)",
  ).run();
  await DB.prepare(
    `INSERT INTO events(
      id,title,description,region,venue,address,start_date,end_date,
      cost,pet_policy,status,verification,is_sample,primary_source_id,checked_at,
      publish_quality_state,publish_quality_reason,publish_quality_rule_version,
      publish_quality_checked_at
    ) VALUES(
      'event-1','제9회 동오마을축제 2026 동오마을 푸드페스타','기존 설명',
      '경기','동오마을 공영주차장','동오마을 공영주차장',
      '2026-10-03','2026-10-03','unknown','unknown','scheduled','verified',0,
      'municipality','2026-09-27T00:00:00Z',
      'PUBLIC','ok','v1','2026-09-27T00:00:00Z'
    )`,
  ).run();
  await DB.prepare(
    "INSERT INTO event_official_links(event_id,source_id,url,checked_at) VALUES('event-1','municipality','https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016','2026-09-27T00:00:00Z')",
  ).run();
}

test("exact official link self-heals poster and rich detail without source-specific parser", async () => {
  const { mf, DB } = await setup();
  try {
    await seed(DB);
    const before = await selectOfficialDetailRecoveryCandidates(
      DB,
      new Date("2026-09-28T01:00:00Z"),
      10,
    );
    assert.equal(before.length, 1);

    const html = `
      <html>
        <body>
          <h1>제9회 동오마을축제 2026 동오마을 푸드페스타</h1>
          <table>
            <tr><th>기간</th><td>2026-10-03 ~ 2026-10-03</td></tr>
            <tr><th>장소</th><td>동오마을 공영주차장</td></tr>
            <tr><th>시간</th><td>13:00~20:00</td></tr>
            <tr><th>이용요금</th><td>무료</td></tr>
            <tr><th>문의처</th><td>031-828-0000</td></tr>
          </table>
          <h2>행사개요</h2>
          <p>동오마을에서 지역 상인과 주민이 함께 참여해 먹거리와 체험을 즐기는 공식 먹거리 축제입니다.</p>
          <img data-src="/upload/event/food-festa-poster.jpg"
               width="900" height="1200" alt="2026 동오마을 푸드페스타 포스터">
        </body>
      </html>
    `;
    const result = await runOfficialDetailRecovery(
      { DB } as never,
      new Date("2026-09-28T01:00:00Z"),
      {
        limit: 10,
        fetchPage: async (url) => ({ html, finalUrl: url }),
      },
    );
    assert.equal(result.recovered, 1);
    assert.equal(result.images_recovered, 1);
    assert.equal(result.detail_recovered, 1);

    const image = await DB.prepare(
      "SELECT image_url,source_type,source_page_url FROM event_images WHERE event_id='event-1'",
    ).first<{
      image_url: string;
      source_type: string;
      source_page_url: string;
    }>();
    assert.deepEqual(image, {
      image_url:
        "https://ui4u.go.kr/upload/event/food-festa-poster.jpg",
      source_type: "municipality",
      source_page_url:
        "https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016",
    });

    const enrichment = await DB.prepare(
      "SELECT summary FROM event_enrichments WHERE event_id='event-1'",
    ).first<{ summary: string }>();
    assert.match(enrichment?.summary ?? "", /공식 먹거리 축제/);

    const hours = await DB.prepare(
      "SELECT start_time,end_time FROM event_operating_hours WHERE event_id='event-1'",
    ).first<{ start_time: string; end_time: string }>();
    assert.deepEqual(hours, { start_time: "13:00", end_time: "20:00" });
  } finally {
    await mf.dispose();
  }
});

test("verified poster conversion enriches once and never invents a summary or time program", async () => {
  const { mf, DB } = await setup();
  const originalFetch = globalThis.fetch;
  try {
    await seed(DB);
    await DB.prepare(
      `INSERT INTO event_images(event_id,image_url,source_type,source_page_url,is_primary,image_status,last_checked_at)
       VALUES('event-1','https://ui4u.go.kr/poster.jpg','municipality',
       'https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016',1,'ok','2026-09-27T00:00:00Z')`,
    ).run();
    let posterBytes = new Uint8Array([255, 216, 255]);
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://ui4u.go.kr/poster.jpg");
      assert.equal(new Headers(init?.headers).get("Referer"), "https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016");
      return new Response(posterBytes, {
        status: 200, headers: { "content-type": "image/jpeg" },
      });
    };
    let calls = 0;
    const env = {
      DB, MUNICIPAL_DOCUMENT_AI_ENABLED: "true",
      AI: { async run(model: string, input: unknown) {
        calls += 1;
        assert.equal(model, "@cf/google/gemma-4-26b-a4b-it");
        assert.equal((input as any).response_format.type, "json_schema");
        return { choices: [{ message: { content: JSON.stringify({ transcription: [
          "동오마을 푸드 페스타", "2026. 10. 3.(토)", "12:00~19:00",
          "동오마을 공영주차장", "주요 프로그램 안내",
          "떡볶이 한판", "무대공연", "체험", "주최 의정부도시공사",
        ].join("\n") }) } }] };
      } },
    } as never;
    const options = {
      targetEventId: "event-1",
      fetchPage: async (url: string) => ({
        finalUrl: url,
        html: "<h1>제9회 동오마을축제 2026 동오마을 푸드페스타</h1><p>2026. 10. 3. 동오마을 공영주차장</p><p>행사 시간: 12:00~19:00</p>",
      }),
    };
    const first = await runOfficialDetailRecovery(env, new Date("2026-09-28T01:00:00Z"), options);
    assert.equal(first.recovered, 1);
    assert.equal(calls, 1);
    const successState = await DB.prepare("SELECT raw_payload FROM sources WHERE id='official-poster-event-1'")
      .first<{ raw_payload: string }>();
    const parsedSuccessState = JSON.parse(successState!.raw_payload);
    assert.equal(parsedSuccessState.latest_attempt.status, "success");
    assert.equal(parsedSuccessState.last_success.poster_url, "https://ui4u.go.kr/poster.jpg");
    assert.match(parsedSuccessState.last_success.poster_hash, /^[a-f0-9]{64}$/);
    assert.match(parsedSuccessState.last_success.transcription, /떡볶이 한판/);
    const hours = await DB.prepare("SELECT start_time,end_time,evidence_excerpt FROM event_operating_hours WHERE event_id='event-1'")
      .first<{ start_time: string; end_time: string; evidence_excerpt: string }>();
    assert.equal(hours?.start_time, "12:00");
    assert.equal(hours?.end_time, "19:00");
    const programs = await DB.prepare("SELECT program_name,evidence_excerpt FROM event_programs WHERE event_id='event-1' ORDER BY sort_order")
      .all<{ program_name: string; evidence_excerpt: string }>();
    assert.deepEqual(programs.results.map((item) => item.program_name), ["떡볶이 한판", "무대공연", "체험"]);
    assert.match(programs.results[0].evidence_excerpt, /poster_image=/);
    const summary = await DB.prepare("SELECT summary FROM event_enrichments WHERE event_id='event-1'").first();
    assert.equal(summary, null);
    // A parser version change reuses the exact same image and never calls AI.
    parsedSuccessState.version = 4;
    await DB.prepare("UPDATE sources SET raw_payload=? WHERE id='official-poster-event-1'")
      .bind(JSON.stringify(parsedSuccessState)).run();
    await runOfficialDetailRecovery(env, new Date("2026-09-28T01:30:00Z"), options);
    assert.equal(calls, 1);
    // Changed bytes invalidate the cache and take the normal OCR path.
    posterBytes = new Uint8Array([255, 216, 4]);
    const timedOut = {
      DB, MUNICIPAL_DOCUMENT_AI_ENABLED: "true",
      AI: { async run() { calls += 1; throw new Error("vision_timeout"); } },
    } as never;
    await runOfficialDetailRecovery(timedOut, new Date("2026-09-28T01:30:00Z"), options);
    const afterFailure = await DB.prepare("SELECT raw_payload FROM sources WHERE id='official-poster-event-1'")
      .first<{ raw_payload: string }>();
    const preserved = JSON.parse(afterFailure!.raw_payload);
    assert.equal(preserved.latest_attempt.status, "failed");
    assert.equal(preserved.latest_attempt.error, "vision_timeout");
    assert.equal(preserved.last_success.poster_hash, parsedSuccessState.last_success.poster_hash);
    assert.equal(preserved.last_success.transcription, parsedSuccessState.last_success.transcription);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    await mf.dispose();
  }
});

test("legacy successful poster state is promoted while a later failure is recorded", async () => {
  const { mf, DB } = await setup();
  const originalFetch = globalThis.fetch;
  try {
    await seed(DB);
    await DB.prepare("INSERT INTO event_images(event_id,image_url,source_type,source_page_url,is_primary,image_status,last_checked_at) VALUES('event-1','https://ui4u.go.kr/poster.jpg','municipality','https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016',1,'ok','2026-09-27T00:00:00Z')").run();
    await DB.prepare("INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload) VALUES('official-poster-event-1','municipality',2,'공식 포스터 판독 상태','https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016','2026-09-27T00:00:00Z',?)")
      .bind(JSON.stringify({ poster_url: "https://ui4u.go.kr/poster.jpg", version: 4, status: "success", converted_text: "legacy transcription" })).run();
    globalThis.fetch = async () => new Response(new Uint8Array([255, 216, 255]), { status: 200 });
    let calls = 0;
    await runOfficialDetailRecovery({
      DB, MUNICIPAL_DOCUMENT_AI_ENABLED: "true",
      AI: { async run() { calls += 1; throw new Error("legacy_retry_failed"); } },
    } as never, new Date("2026-09-28T01:00:00Z"), {
      targetEventId: "event-1",
      fetchPage: async (url: string) => ({ finalUrl: url, html: "<h1>제9회 동오마을축제 2026 동오마을 푸드페스타</h1><p>2026. 10. 3. 동오마을 공영주차장</p><p>행사 시간: 12:00~19:00</p>" }),
    });
    assert.equal(calls, 1);
    const row = await DB.prepare("SELECT raw_payload FROM sources WHERE id='official-poster-event-1'").first<{ raw_payload: string }>();
    const state = JSON.parse(row!.raw_payload);
    assert.equal(state.latest_attempt.status, "failed");
    assert.equal(state.last_success.transcription, "legacy transcription");
    assert.equal(state.last_success.succeeded_at, "2026-09-27T00:00:00Z");
    assert.equal(state.last_success.poster_hash, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    await mf.dispose();
  }
});

test("cached transcription must pass the current event core safety gate", async () => {
  const { mf, DB } = await setup();
  const originalFetch = globalThis.fetch;
  try {
    await seed(DB);
    await DB.prepare("INSERT INTO event_images(event_id,image_url,source_type,source_page_url,is_primary,image_status,last_checked_at) VALUES('event-1','https://ui4u.go.kr/poster.jpg','municipality','https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016',1,'ok','2026-09-27T00:00:00Z')").run();
    globalThis.fetch = async () => new Response(new Uint8Array([255, 216, 9]), { status: 200 });
    const options = { targetEventId: "event-1", fetchPage: async (url: string) => ({ finalUrl: url, html: "<h1>제9회 동오마을축제 2026 동오마을 푸드페스타</h1><p>2026. 10. 3. 동오마을 공영주차장</p><p>행사 시간: 12:00~19:00</p>" }) };
    let calls = 0;
    const env = { DB, MUNICIPAL_DOCUMENT_AI_ENABLED: "true", AI: { async run() { calls += 1; return { choices: [{ message: { content: JSON.stringify({ transcription: "동오마을 푸드페스타\n2026. 10. 3.\n동오마을 공영주차장\n무대공연" }) } }] }; } } } as never;
    const hash = createHash("sha256").update(Buffer.from([255, 216, 9])).digest("hex");
    await DB.prepare("INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload) VALUES('official-poster-event-1','municipality',2,'공식 포스터 판독 상태','https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016','2026-09-27T00:00:00Z',?)")
      .bind(JSON.stringify({ version: 4, status: "success", last_success: { poster_url: "https://ui4u.go.kr/poster.jpg", poster_hash: hash, transcription: "다른 지역 행사\n2026. 10. 3.\n다른 장소\n무대공연", succeeded_at: "2026-09-27T00:00:00Z" } })).run();
    await runOfficialDetailRecovery(env, new Date("2026-09-28T01:00:00Z"), options);
    assert.equal(calls, 1, "unsafe cached transcription must not be reused");
  } finally { globalThis.fetch = originalFetch; await mf.dispose(); }
});

test("recent poster failure waits in normal recovery but explicit target bypasses once", async () => {
  const { mf, DB } = await setup();
  const originalFetch = globalThis.fetch;
  try {
    await seed(DB);
    const posterUrl = "https://ui4u.go.kr/poster.jpg";
    const detailUrl = "https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016";
    await DB.prepare("INSERT INTO event_images(event_id,image_url,source_type,source_page_url,is_primary,image_status,last_checked_at) VALUES('event-1',?,'municipality',?,1,'ok','2026-09-27T00:00:00Z')").bind(posterUrl, detailUrl).run();
    const now = new Date("2026-09-28T01:00:00Z");
    await DB.prepare("INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload) VALUES('official-poster-event-1','municipality',2,'공식 포스터 판독 상태',?, ?, ?)")
      .bind(detailUrl, new Date(now.getTime() - 60 * 60 * 1000).toISOString(), JSON.stringify({ poster_url: posterUrl, version: 5, status: "failed", error: "recent_timeout" })).run();
    globalThis.fetch = async () => new Response(new Uint8Array([255, 216, 17]), { status: 200 });
    let calls = 0;
    const env = {
      DB, MUNICIPAL_DOCUMENT_AI_ENABLED: "true",
      AI: { async run() {
        calls += 1;
        return { choices: [{ message: { content: JSON.stringify({ transcription: "동오마을 푸드페스타\n2026. 10. 3.\n동오마을 공영주차장\n떡볶이 한판\n무대공연" }) } }] };
      } },
    } as never;
    const options = {
      fetchPage: async (url: string) => ({ finalUrl: url, html: "<h1>제9회 동오마을축제 2026 동오마을 푸드페스타</h1><p>2026. 10. 3. 동오마을 공영주차장</p><p>행사 시간: 12:00~19:00</p>" }),
    };
    const normal = await runOfficialDetailRecovery(env, now, options);
    assert.equal(normal.candidates, 1);
    assert.equal(calls, 0, "normal recovery must honor the recent failure window");

    const targeted = await runOfficialDetailRecovery(env, new Date(now.getTime() + 60_000), { ...options, targetEventId: "event-1" });
    assert.equal(targeted.attempted, 1);
    assert.equal(calls, 1, "one target pass may invoke OCR at most once");
  } finally { globalThis.fetch = originalFetch; await mf.dispose(); }
});

test("poster failure without prior success stores no last_success", async () => {
  const { mf, DB } = await setup();
  const originalFetch = globalThis.fetch;
  try {
    await seed(DB);
    await DB.prepare("INSERT INTO event_images(event_id,image_url,source_type,source_page_url,is_primary,image_status,last_checked_at) VALUES('event-1','https://ui4u.go.kr/poster.jpg','municipality','https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016',1,'ok','2026-09-27T00:00:00Z')").run();
    globalThis.fetch = async () => new Response(new Uint8Array([255, 216, 255]), { status: 200 });
    await runOfficialDetailRecovery({
      DB, MUNICIPAL_DOCUMENT_AI_ENABLED: "true",
      AI: { async run() { throw new Error("fresh_attempt_failed"); } },
    } as never, new Date("2026-09-28T01:00:00Z"), {
      targetEventId: "event-1",
      fetchPage: async (url: string) => ({ finalUrl: url, html: "<h1>제9회 동오마을축제 2026 동오마을 푸드페스타</h1><p>2026. 10. 3. 동오마을 공영주차장</p><p>행사 시간: 12:00~19:00</p>" }),
    });
    const row = await DB.prepare("SELECT raw_payload FROM sources WHERE id='official-poster-event-1'").first<{ raw_payload: string }>();
    const state = JSON.parse(row!.raw_payload);
    assert.equal(state.latest_attempt.status, "failed");
    assert.equal("last_success" in state, false);
  } finally {
    globalThis.fetch = originalFetch;
    await mf.dispose();
  }
});

test("verified poster without programs remains eligible when HTML hours already exist", async () => {
  const { mf, DB } = await setup();
  try {
    await seed(DB);
    await DB.prepare("INSERT INTO event_enrichments(event_id,summary,source_id,evidence_excerpt) VALUES('event-1','기존 소개','municipality','기존 소개')").run();
    await DB.prepare("INSERT INTO event_operating_hours(id,event_id,start_date,end_date,start_time,end_time,source_id,evidence_excerpt) VALUES('hours-1','event-1','2026-10-03','2026-10-03','12:00','19:00','municipality','공식 시간')").run();
    await DB.prepare("INSERT INTO event_images(event_id,image_url,source_type,source_page_url,image_status,last_checked_at) VALUES('event-1','https://ui4u.go.kr/poster.jpg','municipality','https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016','ok','2026-09-27T00:00:00Z')").run();
    const rows = await selectOfficialDetailRecoveryCandidates(DB, new Date("2026-09-28T01:00:00Z"), 10);
    assert.equal(rows.length, 1);
    await DB.prepare("INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload) VALUES('official-poster-event-1','municipality',2,'공식 포스터 판독 상태','https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016','2026-09-28T01:00:00Z','{\"status\":\"success\"}')").run();
    const after = await selectOfficialDetailRecoveryCandidates(DB, new Date("2026-09-28T02:00:00Z"), 10);
    assert.equal(after.length, 0);
  } finally { await mf.dispose(); }
});

test("poster fallback is skipped when AI is disabled or HTML already has useful rich detail", async () => {
  const { mf, DB } = await setup();
  try {
    await seed(DB);
    await DB.prepare(
      `INSERT INTO event_images(event_id,image_url,source_type,source_page_url,is_primary,image_status,last_checked_at)
       VALUES('event-1','https://ui4u.go.kr/poster.jpg','municipality',
       'https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016',1,'ok','2026-09-27T00:00:00Z')`,
    ).run();
    let calls = 0;
    const ai = { async run() { calls += 1; return { response: JSON.stringify({ transcription: "unused" }) }; } };
    const base = { DB, AI: ai } as never;
    const html = "<h1>제9회 동오마을축제 2026 동오마을 푸드페스타</h1><p>2026. 10. 3. 동오마을 공영주차장</p>";
    await runOfficialDetailRecovery(base, new Date("2026-09-28T01:00:00Z"), {
      targetEventId: "event-1", fetchPage: async (url) => ({ finalUrl: url, html }),
    });
    assert.equal(calls, 0);
    const richHtml = html + "<h2>행사개요</h2><p>공식 행사 상세 소개가 충분히 제공되는 페이지입니다.</p>";
    await runOfficialDetailRecovery({ DB, AI: ai, MUNICIPAL_DOCUMENT_AI_ENABLED: "true" } as never,
      new Date("2026-09-28T02:00:00Z"), {
        targetEventId: "event-1", fetchPage: async (url) => ({ finalUrl: url, html: richHtml }),
      });
    assert.equal(calls, 0);
  } finally { await mf.dispose(); }
});

test("title mismatch is quarantined and does not overwrite event detail", async () => {
  const { mf, DB } = await setup();
  try {
    await seed(DB);
    const result = await runOfficialDetailRecovery(
      { DB } as never,
      new Date("2026-09-28T01:00:00Z"),
      {
        fetchPage: async (url) => ({
          finalUrl: url,
          html: "<h1>전혀 다른 행사</h1><img src='/wrong.jpg' width='900' height='1200'>",
        }),
      },
    );
    assert.equal(result.title_mismatch, 1);
    assert.equal(result.recovered, 0);
    const image = await DB.prepare(
      "SELECT image_url FROM event_images WHERE event_id='event-1'",
    ).first();
    assert.equal(image, null);
    const attempt = await DB.prepare(
      "SELECT raw_payload FROM sources WHERE id='official-detail-event-1'",
    ).first<{ raw_payload: string }>();
    assert.match(attempt?.raw_payload ?? "", /detail_title_mismatch/);
  } finally {
    await mf.dispose();
  }
});


test("audited official URL is eligible when no stored event link exists", async () => {
  const { mf, DB } = await setup();
  try {
    await seed(DB);
    await DB.prepare(
      "DELETE FROM event_official_links WHERE event_id='event-1'",
    ).run();
    await DB.prepare(
      `INSERT INTO official_source_audits(
        id,run_id,event_id,origin_source_id,checked_at,baseline_json,
        detail_json,url_inventory_json,candidate_status
      ) VALUES(
        'audit-1','run-1','event-1','municipality','2026-09-27T00:00:00Z',
        '{}','{}','[]','candidates_found'
      )`,
    ).run();
    await DB.prepare(
      `INSERT INTO official_source_links(
        id,audit_id,url,final_url,source_types,title,checked_at,http_status,
        access_status,official,reason,excerpt,content_hash,provenance_json
      ) VALUES(
        'link-1','audit-1',
        'https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016',
        NULL,'["local_government"]','제9회 동오마을축제 2026 동오마을 푸드페스타',
        '2026-09-27T00:00:00Z',200,'ok',1,'verified',
        'official event page','hash','{}'
      )`,
    ).run();

    const rows = await selectOfficialDetailRecoveryCandidates(
      DB,
      new Date("2026-09-28T01:00:00Z"),
      10,
    );
    assert.equal(rows.length, 1);
    assert.equal(
      rows[0]?.official_url,
      "https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016",
    );
  } finally {
    await mf.dispose();
  }
});


test("generic homepage with title but no matching date or venue is quarantined", async () => {
  const { mf, DB } = await setup();
  try {
    await seed(DB);
    const result = await runOfficialDetailRecovery(
      { DB } as never,
      new Date("2026-09-28T01:00:00Z"),
      {
        fetchPage: async (url) => ({
          finalUrl: url,
          html: `
            <h1>제9회 동오마을축제 2026 동오마을 푸드페스타</h1>
            <meta property="og:image" content="/site/default-event.jpg">
            <p>의정부시의 다양한 행사 소식을 안내합니다.</p>
          `,
        }),
      },
    );
    assert.equal(result.insufficient_core_signal, 1);
    assert.equal(result.recovered, 0);
    const image = await DB.prepare(
      "SELECT image_url FROM event_images WHERE event_id='event-1'",
    ).first();
    assert.equal(image, null);
  } finally {
    await mf.dispose();
  }
});


test("exact primary municipal detail URL is eligible even before event_official_links exists", async () => {
  const { mf, DB } = await setup();
  try {
    await seed(DB);
    await DB.prepare(
      "DELETE FROM event_official_links WHERE event_id='event-1'",
    ).run();
    await DB.prepare(
      "UPDATE sources SET url='https://www.swcf.or.kr/?p=29_view&idx=3011' WHERE id='municipality'",
    ).run();
    await DB.prepare(
      `INSERT INTO municipal_candidate_state(
        candidate_id,source_key,first_seen_at,last_seen_at,decision_state,
        decision_reason,retry_until,last_payload_hash,source_candidate_id,
        title_snapshot,start_date_snapshot,end_date_snapshot,venue_snapshot,
        locality_snapshot,official_url_snapshot
      ) VALUES(
        'event-1','suwon','2026-09-27T00:00:00Z','2026-09-27T00:00:00Z',
        'AUTO_PUBLISH','test',NULL,'hash','3011',
        '제9회 동오마을축제 2026 동오마을 푸드페스타',
        '2026-10-03','2026-10-03','동오마을 공영주차장','수원',
        'https://www.swcf.or.kr/?p=29_view&idx=3011'
      )`,
    ).run();

    const rows = await selectOfficialDetailRecoveryCandidates(
      DB,
      new Date("2026-09-28T01:00:00Z"),
      10,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.official_url, "https://www.swcf.or.kr/?p=29_view&idx=3011");
  } finally {
    await mf.dispose();
  }
});

test("canonical municipal list page is not treated as an exact recovery page", async () => {
  const { mf, DB } = await setup();
  try {
    await seed(DB);
    await DB.prepare(
      "DELETE FROM event_official_links WHERE event_id='event-1'",
    ).run();
    await DB.prepare(
      "UPDATE sources SET url='https://www.swcf.or.kr/?p=29' WHERE id='municipality'",
    ).run();
    await DB.prepare(
      `INSERT INTO municipal_candidate_state(
        candidate_id,source_key,first_seen_at,last_seen_at,decision_state,
        decision_reason,retry_until,last_payload_hash,source_candidate_id,
        title_snapshot,start_date_snapshot,end_date_snapshot,venue_snapshot,
        locality_snapshot,official_url_snapshot
      ) VALUES(
        'event-1','suwon','2026-09-27T00:00:00Z','2026-09-27T00:00:00Z',
        'AUTO_PUBLISH','test',NULL,'hash','3011',
        '제9회 동오마을축제 2026 동오마을 푸드페스타',
        '2026-10-03','2026-10-03','동오마을 공영주차장','수원',
        'https://www.swcf.or.kr/?p=29'
      )`,
    ).run();

    const rows = await selectOfficialDetailRecoveryCandidates(
      DB,
      new Date("2026-09-28T01:00:00Z"),
      10,
    );
    assert.equal(rows.length, 0);
  } finally {
    await mf.dispose();
  }
});


test("municipal candidate snapshot supplies the exact detail URL when primary source is the canonical list", async () => {
  const { mf, DB } = await setup();
  try {
    await seed(DB);
    await DB.prepare(
      "DELETE FROM event_official_links WHERE event_id='event-1'",
    ).run();
    await DB.prepare(
      "UPDATE sources SET url='https://www.swcf.or.kr/?p=29' WHERE id='municipality'",
    ).run();
    await DB.prepare(
      `INSERT INTO municipal_candidate_state(
        candidate_id,source_key,first_seen_at,last_seen_at,decision_state,
        decision_reason,retry_until,last_payload_hash,source_candidate_id,
        title_snapshot,start_date_snapshot,end_date_snapshot,venue_snapshot,
        locality_snapshot,official_url_snapshot
      ) VALUES(
        'event-1','suwon','2026-09-27T00:00:00Z','2026-09-27T00:00:00Z',
        'AUTO_PUBLISH','test',NULL,'hash','3011',
        '제9회 동오마을축제 2026 동오마을 푸드페스타',
        '2026-10-03','2026-10-03','동오마을 공영주차장','수원',
        'https://www.swcf.or.kr/?p=29_view&idx=3011'
      )`,
    ).run();

    const rows = await selectOfficialDetailRecoveryCandidates(
      DB,
      new Date("2026-09-28T01:00:00Z"),
      10,
    );
    assert.equal(rows.length, 1);
    assert.equal(
      rows[0]?.official_url,
      "https://www.swcf.or.kr/?p=29_view&idx=3011",
    );
  } finally {
    await mf.dispose();
  }
});

test("municipal recovery retries an allowed sibling host after a network failure", async () => {
  const { mf, DB } = await setup();
  try {
    await seed(DB);
    await DB.prepare(
      `INSERT INTO municipal_candidate_state(
        candidate_id,source_key,first_seen_at,last_seen_at,decision_state,
        decision_reason,retry_until,last_payload_hash,source_candidate_id,
        title_snapshot,start_date_snapshot,end_date_snapshot,venue_snapshot,
        locality_snapshot,official_url_snapshot
      ) VALUES(
        'event-1','gyeonggi-의정부','2026-09-27T00:00:00Z','2026-09-27T00:00:00Z',
        'AUTO_PUBLISH','test',NULL,'hash','378',
        '제9회 동오마을축제 2026 동오마을 푸드페스타',
        '2026-10-03','2026-10-03','동오마을 공영주차장','의정부',
        'https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016'
      )`,
    ).run();

    const calls: string[] = [];
    const result = await runOfficialDetailRecovery(
      { DB } as never,
      new Date("2026-09-28T01:00:00Z"),
      {
        fetchPage: async (url) => {
          calls.push(url);
          if (new URL(url).hostname === "ui4u.go.kr")
            throw new TypeError("fetch failed");
          return {
            finalUrl: url,
            html: `
              <h1>제9회 동오마을축제 2026 동오마을 푸드페스타</h1>
              <p>2026년 10월 3일 동오마을 공영주차장에서 열리는 공식 축제입니다.</p>
              <img src="/upload/food-festa-poster.jpg" alt="행사 포스터">
            `,
          };
        },
      },
    );
    assert.equal(result.recovered, 1);
    assert.equal(result.images_recovered, 1);
    assert.equal(calls.length, 2);
    assert.equal(new URL(calls[1]).hostname, "www.ui4u.go.kr");
  } finally {
    await mf.dispose();
  }
});


test("transient official-detail fetch failures retry after the short recovery window", async () => {
  const { mf, DB } = await setup();
  try {
    await seed(DB);
    await DB.prepare(
      `INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload)
       VALUES(
         'official-detail-event-1','municipality',2,'지자체 공식 상세 안내',
         'https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016',
         '2026-09-28T00:20:00Z',
         '{"official_detail_recovery":{"status":"network_error"}}'
       )`,
    ).run();

    const tooSoon = await selectOfficialDetailRecoveryCandidates(
      DB,
      new Date("2026-09-28T00:40:00Z"),
      10,
    );
    assert.equal(tooSoon.length, 0);

    const retryReady = await selectOfficialDetailRecoveryCandidates(
      DB,
      new Date("2026-09-28T01:00:01Z"),
      10,
    );
    assert.equal(retryReady.length, 1);
    assert.equal(
      retryReady[0]?.official_url,
      "https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016",
    );
  } finally {
    await mf.dispose();
  }
});


test("official detail fetch presents a browser-compatible request with same-site referer", async () => {
  const originalFetch = globalThis.fetch;
  const seen: { url?: string; referer?: string | null; userAgent?: string | null } = {};
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.url = String(input);
    const headers = new Headers(init?.headers);
    seen.referer = headers.get("referer");
    seen.userAgent = headers.get("user-agent");
    return new Response(
      "<html><body><h1>공식 행사 상세</h1></body></html>",
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }) as typeof fetch;
  try {
    const { fetchOfficialDetailPage } = await import(
      "../worker/sources/official-detail-recovery"
    );
    const result = await fetchOfficialDetailPage(
      "https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016",
      "https://ui4u.go.kr/portal/eventNoti/list.do?mId=0301170300",
    );
    assert.equal(
      seen.referer,
      "https://ui4u.go.kr/portal/eventNoti/list.do?mId=0301170300",
    );
    assert.match(seen.userAgent ?? "", /Mozilla\/5\.0/);
    assert.match(result.html, /공식 행사 상세/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exact official recovery uses Reader transport after direct official routes fail", async () => {
  const { mf, DB } = await setup();
  const originalFetch = globalThis.fetch;
  try {
    await seed(DB);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://r.jina.ai/https://ui4u.go.kr/"))
        return new Response("reader upstream failed", { status: 502 });
      if (url.startsWith("https://r.jina.ai/https://www.ui4u.go.kr/")) {
        assert.match(url, /idx=2016/);
        const headers = new Headers(init?.headers);
        assert.equal(init?.method, "GET");
        assert.equal(headers.get("x-respond-with"), "html");
        const target = url.slice("https://r.jina.ai/".length);
        return new Response(JSON.stringify({ data: { url: target, content:
          '<h1>제9회 동오마을축제 2026 동오마을 푸드페스타</h1>' +
          '<p>2026년 10월 3일 동오마을 공영주차장에서 열리는 공식 먹거리 축제입니다.</p>' +
          '<p>행사 시간: 12:00~19:00</p>' +
          '<img src="https://ui4u.go.kr/upload/food-festa-poster.jpg" alt="행사 포스터">'
        } }), { status: 200 });
      }
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    const result = await runOfficialDetailRecovery(
      { DB } as never,
      new Date("2026-09-28T01:00:00Z"),
      { limit: 10 },
    );
    assert.equal(result.recovered, 1);
    assert.equal(result.images_recovered, 1);
    assert.equal(result.detail_recovered, 1);
    assert.equal(result.reader_attempts, 2);
    assert.equal(result.reader_successes, 1);
    assert.equal(result.reader_failures, 1);
    assert.equal(result.reader_failure_reasons.official_reader_http_502, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await mf.dispose();
  }
});
