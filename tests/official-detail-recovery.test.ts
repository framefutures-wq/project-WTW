import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  needsPosterRichDetailFallback,
  runOfficialDetailRecovery,
  selectOfficialDetailRecoveryCandidates,
} from "../worker/sources/official-detail-recovery";
import type { MunicipalRichDetail } from "../shared/municipal-rich-detail";

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

async function seedVerifiedPoster(DB: D1Database) {
  await DB.prepare(
    `INSERT INTO event_images(event_id,image_url,source_type,source_page_url,is_primary,image_status,last_checked_at)
     VALUES('event-1','https://ui4u.go.kr/poster.jpg','municipality',
       'https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016',1,'ok','2026-09-27T00:00:00Z')`,
  ).run();
}

function posterAi(calls: { count: number }) {
  return {
    async run() {
      calls.count += 1;
      return { choices: [{ message: { content: JSON.stringify({ transcription: [
        "동오마을 푸드 페스타", "2026. 10. 3.(토)", "12:00~19:00",
        "동오마을 공영주차장", "떡볶이 한판", "무대공연", "체험",
      ].join("\n") }) } }] };
    },
  };
}

function mockReaderAndPoster() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("https://r.jina.ai/"))
      return new Response("reader failed", { status: 502 });
    if (url === "https://ui4u.go.kr/poster.jpg")
      return new Response(new Uint8Array([255, 216, 255]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    throw new TypeError("unexpected fetch " + url);
  }) as typeof fetch;
  return () => { globalThis.fetch = originalFetch; };
}

test("poster fallback quality gate ignores generic copy and metadata-only HTML programs", () => {
  const title = "2026 한수원아트페스티벌 특별전 한국 미술 조선 후기부터 현대까지";
  const genericSummary = "한국관광의 메카 Beautiful City가 여러분을 초대합니다.";
  const metadataPrograms = ["관람시간 ｜", "도슨트 프로그램 ｜", "대표전화 054-779-8585 (평일"].map((name) => ({
    name, description: "공식 상세 정보", schedule_text: null,
  }));
  assert.equal(needsPosterRichDetailFallback(title, { summary: genericSummary, programs: metadataPrograms }), true);

  assert.equal(needsPosterRichDetailFallback("동오마을 축제", {
    summary: "동오마을 주민과 지역 상인이 함께하는 먹거리 축제입니다.", programs: [],
  }), false, "event-specific summary should suppress unnecessary OCR");
  assert.equal(needsPosterRichDetailFallback(title, {
    summary: genericSummary,
    programs: ["무대공연", "체험 프로그램"].map((name) => ({ name, description: "설명", schedule_text: null })),
  }), false, "multiple real programs should suppress unnecessary OCR");
  assert.equal(needsPosterRichDetailFallback(title, {
    summary: genericSummary,
    programs: ["관람시간", "공연시간", "운영시간", "행사시간", "이용시간", "대표전화", "문의", "문의전화", "연락처", "전화", "장소", "일시", "기간", "관람료", "입장료", "요금", "주최", "주최기관", "주관", "주관기관", "후원", "협찬", "운영기관", "오시는 길"].map((name) => ({ name, description: "값", schedule_text: null })),
  }), true, "metadata labels must not count as programs");
  assert.equal(needsPosterRichDetailFallback(title, {
    summary: genericSummary,
    programs: [{ name: "도슨트 프로그램", description: "도슨트 해설", schedule_text: null }],
  }), true, "one plausible program does not suppress fallback by itself");
});

test("poster fallback skips OCR only when one meaningful program has another structured fact", () => {
  const title = "한수원아트페스티벌 특별전";
  const docent = {
    name: "도슨트 프로그램",
    description: "공식 전시 해설 프로그램",
    schedule_text: "10:30, 12:30",
  };
  const hours: MunicipalRichDetail["operating_hours"] = [
    {
      start_time: "10:00",
      end_time: "18:00",
      human_time_text: "10:00~18:00",
    },
  ];

  // A: one program plus price/contact is sufficient with closure hours omitted.
  assert.equal(
    needsPosterRichDetailFallback(title, {
      summary: null,
      programs: [docent],
      price_text: "성인 10,000원 / 어린이 및 청소년 7,000원",
      contact_phone: "054-777-5823",
      operating_hours: [],
    }),
    false,
  );
  // B: one program alone remains eligible for poster fallback.
  assert.equal(
    needsPosterRichDetailFallback(title, {
      summary: null,
      programs: [docent],
      price_text: null,
      contact_phone: null,
      operating_hours: [],
    }),
    true,
  );
  // C: structured fields without a real program remain eligible.
  assert.equal(
    needsPosterRichDetailFallback(title, {
      summary: null,
      programs: [],
      price_text: "무료",
      contact_phone: "054-777-5823",
      operating_hours: hours,
    }),
    true,
  );
  // D: two meaningful programs remain sufficient.
  assert.equal(
    needsPosterRichDetailFallback(title, {
      summary: null,
      programs: [docent, { ...docent, name: "전시 연계 체험" }],
    }),
    false,
  );
  // E: meaningful summary remains sufficient.
  assert.equal(
    needsPosterRichDetailFallback(title, {
      summary:
        "이번 특별전은 조선 후기부터 현대까지 한국 미술의 흐름을 소개합니다.",
      programs: [],
    }),
    false,
  );
  // F: metadata pseudo-programs do not count as event content.
  assert.equal(
    needsPosterRichDetailFallback(title, {
      summary: null,
      programs: [
        { ...docent, name: "관람시간" },
        { ...docent, name: "대표전화" },
      ],
      price_text: "무료",
      contact_phone: "054-777-5823",
      operating_hours: hours,
    }),
    true,
  );
});

async function seedStoredSelectorEvent(DB: D1Database, input: {
  id: string; title?: string; startDate: string; summary?: string; programs?: string[];
  price?: string; contact?: string; hours?: boolean; imageStatus?: "ok" | "missing";
}) {
  const sourceId = `selector-source-${input.id}`;
  const detailSourceId = `official-detail-${input.id}`;
  await DB.prepare("INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload) VALUES(?,?,?,?,?,?,?)")
    .bind(sourceId, "municipality", 2, "selector test", `https://example.test/${input.id}`, "2026-09-01T00:00:00Z", null).run();
  await DB.prepare(`INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,cost,price_text,pet_policy,status,verification,is_sample,primary_source_id,checked_at,publish_quality_state,publish_quality_reason,publish_quality_rule_version,publish_quality_checked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(input.id, input.title ?? input.id, "existing detail", "경기", "공식 장소", "공식 장소", input.startDate, "2026-10-31", input.price ? "paid" : "unknown", input.price ?? null, "unknown", "scheduled", "verified", 0, sourceId, "2026-09-01T00:00:00Z", "PUBLIC", "ok", "v1", "2026-09-01T00:00:00Z").run();
  await DB.prepare("INSERT INTO event_official_links(event_id,source_id,url,checked_at) VALUES(?,?,?,?)")
    .bind(input.id, sourceId, `https://example.test/${input.id}/detail`, "2026-09-01T00:00:00Z").run();
  if (input.contact) await DB.prepare("INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload) VALUES(?,?,?,?,?,?,?)")
    .bind(detailSourceId, "municipality", 2, "지자체 공식 상세 안내", `https://example.test/${input.id}/detail`, "2026-09-01T00:00:00Z", JSON.stringify({ municipal_rich_detail: { contact_phone: input.contact, price_text: input.price ?? null } })).run();
  if (input.summary) await DB.prepare("INSERT INTO event_enrichments(event_id,summary,source_id,evidence_excerpt) VALUES(?,?,?,?)")
    .bind(input.id, input.summary, sourceId, "official summary").run();
  for (const [index, program] of (input.programs ?? []).entries()) await DB.prepare("INSERT INTO event_programs(id,event_id,program_name,featured,sort_order,source_id,evidence_excerpt) VALUES(?,?,?,?,?,?,?)")
    .bind(`${input.id}-program-${index}`, input.id, program, 0, index, sourceId, "official program").run();
  if (input.hours) await DB.prepare("INSERT INTO event_operating_hours(id,event_id,start_date,end_date,start_time,end_time,source_id,evidence_excerpt) VALUES(?,?,?,?,?,?,?,?)")
    .bind(`${input.id}-hours`, input.id, "2026-10-01", "2026-10-31", "10:00", "18:00", sourceId, "official hours").run();
  if (input.imageStatus) await DB.prepare("INSERT INTO event_images(event_id,image_url,source_type,source_page_url,is_primary,image_status,last_checked_at) VALUES(?,?,?,?,?,?,?)")
    .bind(input.id, `https://example.test/${input.id}.jpg`, "municipality", `https://example.test/${input.id}/detail`, 1, input.imageStatus, "2026-09-01T00:00:00Z").run();
}

test("scheduled selector excludes useful stored detail but retains incomplete, image, and explicit candidates", async () => {
  const { mf, DB } = await setup();
  try {
    await seedStoredSelectorEvent(DB, { id: "gyeongju-done", title: "한수원아트페스티벌 특별전", startDate: "2026-10-01", programs: ["도슨트 프로그램"], price: "성인 10,000원", contact: "054-777-5823", imageStatus: "ok" });
    await seedStoredSelectorEvent(DB, { id: "one-program-incomplete", startDate: "2026-10-02", programs: ["도슨트 프로그램"], imageStatus: "ok" });
    await seedStoredSelectorEvent(DB, { id: "paju-stale", startDate: "2026-10-03", programs: ["평일"], price: "무료", imageStatus: "ok" });
    await seedStoredSelectorEvent(DB, { id: "two-programs-done", startDate: "2026-10-04", programs: ["무대 공연", "전통 체험"], imageStatus: "ok" });
    await seedStoredSelectorEvent(DB, { id: "summary-done", title: "별빛 문화제", startDate: "2026-10-05", summary: "별빛 문화제는 지역 예술가와 주민이 함께하는 공식 야간 문화 행사입니다.", imageStatus: "ok" });
    await seedStoredSelectorEvent(DB, { id: "image-missing-done", startDate: "2026-10-06", programs: ["도슨트 프로그램"], price: "무료", contact: "031-123-4567", imageStatus: "missing" });
    const ids = new Set((await selectOfficialDetailRecoveryCandidates(DB, new Date("2026-09-28T01:00:00Z"), 20)).map((row) => row.id));
    for (const id of ["gyeongju-done", "two-programs-done", "summary-done"]) assert.equal(ids.has(id), false);
    for (const id of ["one-program-incomplete", "paju-stale", "image-missing-done"]) assert.equal(ids.has(id), true);
    const explicit = await selectOfficialDetailRecoveryCandidates(DB, new Date("2026-09-28T01:00:00Z"), 1, "gyeongju-done");
    assert.deepEqual(explicit.map((row) => row.id), ["gyeongju-done"]);
  } finally { await mf.dispose(); }
});

test("scheduled selector filters DONE rows before applying the final limit", async () => {
  const { mf, DB } = await setup();
  try {
    for (const [index, id] of ["done-a", "done-b", "done-c"].entries()) await seedStoredSelectorEvent(DB, { id, startDate: `2026-10-0${index + 1}`, programs: ["무대 공연", "전통 체험"], imageStatus: "ok" });
    await seedStoredSelectorEvent(DB, { id: "later-incomplete", startDate: "2026-10-04", programs: ["평일"], imageStatus: "ok" });
    const rows = await selectOfficialDetailRecoveryCandidates(DB, new Date("2026-09-28T01:00:00Z"), 1);
    assert.deepEqual(rows.map((row) => row.id), ["later-incomplete"]);
  } finally { await mf.dispose(); }
});

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

test("Gyeongju-like HTML with one program and structured facts skips poster fallback", async () => {
  const { mf, DB } = await setup();
  const originalFetch = globalThis.fetch;
  try {
    await seed(DB);
    await DB.prepare("INSERT INTO event_images(event_id,image_url,source_type,source_page_url,is_primary,image_status,last_checked_at) VALUES('event-1','https://ui4u.go.kr/poster.jpg','municipality','https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016',1,'ok','2026-09-27T00:00:00Z')").run();
    await DB.prepare("INSERT INTO event_enrichments(event_id,summary,source_id,evidence_excerpt) VALUES('event-1','한국관광의 메카 Beautiful City가 여러분을 초대합니다.','municipality','old generic HTML summary')").run();
    await DB.prepare("INSERT INTO event_programs(id,event_id,program_name,featured,sort_order,source_id,evidence_excerpt) VALUES('old-viewing','event-1','관람시간 ｜',0,1,'municipality','old metadata'),('old-docent','event-1','도슨트 프로그램 ｜',0,2,'municipality','old metadata'),('old-contact','event-1','대표전화 031-828-1111',0,3,'municipality','old metadata')").run();
    globalThis.fetch = async () => new Response(new Uint8Array([255, 216, 255]), {
      status: 200, headers: { "content-type": "image/jpeg" },
    });
    let calls = 0;
    const env = {
      DB,
      MUNICIPAL_DOCUMENT_AI_ENABLED: "true",
      AI: { async run() {
        calls += 1;
        return { choices: [{ message: { content: JSON.stringify({ transcription: [
          "제9회 동오마을축제 2026 동오마을 푸드페스타",
          "2026. 10. 3.", "동오마을 공영주차장", "주요 프로그램 안내",
          "떡볶이 한판", "무대공연",
        ].join("\n") }) } }] };
      } },
    } as never;
    const html = `
      <h1>제9회 동오마을축제 2026 동오마을 푸드페스타</h1>
      <p>2026. 10. 3. 동오마을 공영주차장</p>
      <table>
        <tr><th>시간</th><td>11:00~18:00</td></tr>
        <tr><th>입장료</th><td>무료</td></tr>
        <tr><th>문의처</th><td>031-828-0000</td></tr>
      </table>
      <h2>행사개요</h2>
      <p>한국관광의 메카 Beautiful City가 여러분을 초대합니다.</p>
      <h2>프로그램</h2>
      <h3>관람시간 ｜</h3><p>10:00-18:00 (입장마감 17:30)</p>
      <h3>도슨트 프로그램 ｜</h3><p>10:30 / 12:30</p>
      <h3>대표전화 031-828-1111 (평일</h3><p>09:00~18:00</p>`;
    const result = await runOfficialDetailRecovery(env, new Date("2026-09-28T01:00:00Z"), {
      targetEventId: "event-1",
      fetchPage: async (url) => ({ finalUrl: url, html }),
    });
    assert.equal(result.recovered, 1);
    assert.equal(calls, 0, "one HTML program plus structured facts should suppress OCR");
    const posterState = await DB.prepare("SELECT id FROM sources WHERE id='official-poster-event-1'").first();
    assert.equal(posterState, null, "poster OCR state must not be created when HTML is sufficient");

    const summary = await DB.prepare("SELECT summary FROM event_enrichments WHERE event_id='event-1'").first();
    assert.equal(summary, null, "generic promotional HTML summary must be removed");
    const programs = await DB.prepare("SELECT program_name FROM event_programs WHERE event_id='event-1' ORDER BY sort_order")
      .all<{ program_name: string }>();
    assert.ok(programs.results.some((program) => /도슨트 프로그램/.test(program.program_name)));
    const source = await DB.prepare("SELECT raw_payload FROM sources WHERE id='official-detail-event-1'")
      .first<{ raw_payload: string }>();
    const rich = JSON.parse(source!.raw_payload).municipal_rich_detail;
    assert.equal(rich.contact_phone, "031-828-0000", "useful HTML contact should win over absent poster contact");
    assert.equal(rich.price_text, "무료", "useful HTML price should be preserved");
    const hours = await DB.prepare("SELECT start_time,end_time FROM event_operating_hours WHERE event_id='event-1'")
      .first<{ start_time: string; end_time: string }>();
    assert.deepEqual(hours, { start_time: "11:00", end_time: "18:00" });
  } finally {
    globalThis.fetch = originalFetch;
    await mf.dispose();
  }
});

test("generic HTML cleanup preserves a higher-priority meaningful summary", async () => {
  const { mf, DB } = await setup();
  try {
    await seed(DB);
    await DB.prepare(
      "INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES('organizer','organizer',1,'주최자','https://festival.example.org/event','2026-09-27T00:00:00Z')",
    ).run();
    await DB.prepare(
      "INSERT INTO event_enrichments(event_id,summary,source_id,evidence_excerpt) VALUES('event-1','지역 예술가와 주민이 함께 만드는 행사입니다.','organizer','official meaningful summary')",
    ).run();
    const html = `
      <h1>제9회 동오마을축제 2026 동오마을 푸드페스타</h1>
      <p>2026. 10. 3. 동오마을 공영주차장</p>
      <table><tr><th>이용요금</th><td>무료</td></tr></table>
      <h2>행사개요</h2>
      <p>한국관광의 메카 Beautiful City가 여러분을 초대합니다.</p>
    `;
    await runOfficialDetailRecovery(
      { DB } as never,
      new Date("2026-09-28T01:00:00Z"),
      { targetEventId: "event-1", fetchPage: async (url) => ({ finalUrl: url, html }) },
    );

    const summary = await DB.prepare(
      "SELECT summary,source_id FROM event_enrichments WHERE event_id='event-1'",
    ).first<{ summary: string; source_id: string }>();
    assert.deepEqual(summary, {
      summary: "지역 예술가와 주민이 함께 만드는 행사입니다.",
      source_id: "organizer",
    });
  } finally {
    await mf.dispose();
  }
});

test("poster result without programs preserves a meaningful HTML program", async () => {
  const { mf, DB } = await setup();
  const originalFetch = globalThis.fetch;
  try {
    await seed(DB);
    await DB.prepare(
      "INSERT INTO event_enrichments(event_id,summary,source_id,evidence_excerpt) VALUES('event-1','한국관광의 메카 Beautiful City가 여러분을 초대합니다.','municipality','existing generic HTML summary')",
    ).run();
    await DB.prepare("INSERT INTO event_images(event_id,image_url,source_type,source_page_url,is_primary,image_status,last_checked_at) VALUES('event-1','https://ui4u.go.kr/poster.jpg','municipality','https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016',1,'ok','2026-09-27T00:00:00Z')").run();
    globalThis.fetch = async () => new Response(new Uint8Array([255, 216, 255]), { status: 200 });
    let calls = 0;
    const env = {
      DB, MUNICIPAL_DOCUMENT_AI_ENABLED: "true",
      AI: { async run() {
        calls += 1;
        return { choices: [{ message: { content: JSON.stringify({ transcription: [
          "제9회 동오마을축제 2026 동오마을 푸드페스타", "2026. 10. 3.",
          "동오마을 공영주차장", "운영시간: 12:00~19:00",
        ].join("\n") }) } }] };
      } },
    } as never;
    const html = `
      <h1>제9회 동오마을축제 2026 동오마을 푸드페스타</h1>
      <p>2026. 10. 3. 동오마을 공영주차장</p>
      <h2>행사개요</h2><p>한국관광의 메카 Beautiful City가 여러분을 초대합니다.</p>
      <p>도슨트 프로그램 14:00 전시 해설 운영</p>`;
    await runOfficialDetailRecovery(env, new Date("2026-09-28T01:00:00Z"), {
      targetEventId: "event-1", fetchPage: async (url) => ({ finalUrl: url, html }),
    });
    assert.equal(calls, 1);
    const programs = await DB.prepare("SELECT program_name FROM event_programs WHERE event_id='event-1' ORDER BY sort_order")
      .all<{ program_name: string }>();
    assert.ok(programs.results.some((program) => /^도슨트 프로그램/.test(program.program_name)));
    const summary = await DB.prepare("SELECT summary FROM event_enrichments WHERE event_id='event-1'").first();
    assert.equal(summary, null);
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
    await DB.prepare("INSERT INTO event_enrichments(event_id,summary,source_id,evidence_excerpt) VALUES('event-1','한국관광의 메카가 여러분을 초대합니다.','municipality','generic 소개')").run();
    await DB.prepare("INSERT INTO event_operating_hours(id,event_id,start_date,end_date,start_time,end_time,source_id,evidence_excerpt) VALUES('hours-1','event-1','2026-10-03','2026-10-03','12:00','19:00','municipality','공식 시간')").run();
    await DB.prepare("INSERT INTO event_images(event_id,image_url,source_type,source_page_url,image_status,last_checked_at) VALUES('event-1','https://ui4u.go.kr/poster.jpg','municipality','https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016','ok','2026-09-27T00:00:00Z')").run();
    const rows = await selectOfficialDetailRecoveryCandidates(DB, new Date("2026-09-28T01:00:00Z"), 10);
    assert.equal(rows.length, 1);
    await DB.prepare("INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload) VALUES('official-poster-event-1','municipality',2,'공식 포스터 판독 상태','https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016','2026-09-28T01:00:00Z','{\"status\":\"success\"}')").run();
    const after = await selectOfficialDetailRecoveryCandidates(DB, new Date("2026-09-28T02:00:00Z"), 10);
    assert.equal(after.length, 0);
  } finally { await mf.dispose(); }
});

test("scheduled recovery does not invoke poster OCR after all HTML transports fail", async () => {
  const { mf, DB } = await setup();
  const restoreFetch = mockReaderAndPoster();
  const calls = { count: 0 };
  try {
    await seed(DB);
    await seedVerifiedPoster(DB);
    const priorState = JSON.stringify({
      poster_url: "https://ui4u.go.kr/poster.jpg",
      version: 5,
      status: "success",
      latest_attempt: {
        status: "success",
        attempted_at: "2026-09-27T00:00:00Z",
        parser_version: 5,
      },
      last_success: {
        poster_url: "https://ui4u.go.kr/poster.jpg",
        poster_hash: "a".repeat(64),
        transcription: "이전 검증된 transcription",
        succeeded_at: "2026-09-27T00:00:00Z",
      },
    });
    await DB.prepare(
      `INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload)
       VALUES('official-poster-event-1','municipality',2,'공식 포스터 판독 상태',
         'https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016',
         '2026-09-27T00:00:00Z',?)`,
    ).bind(priorState).run();

    const result = await runOfficialDetailRecovery(
      { DB, AI: posterAi(calls), MUNICIPAL_DOCUMENT_AI_ENABLED: "true" } as never,
      new Date("2026-09-28T01:00:00Z"),
      { fetchPage: async () => { throw new TypeError("fetch failed"); } },
    );

    assert.equal(calls.count, 0);
    assert.equal(result.fetch_failed, 1);
    assert.equal(result.fetch_failure_reasons.network_error, 1);
    assert.equal(result.reader_attempts, 2);
    assert.equal(result.reader_failures, 2);
    const state = await DB.prepare(
      "SELECT fetched_at,raw_payload FROM sources WHERE id='official-poster-event-1'",
    ).first<{ fetched_at: string; raw_payload: string }>();
    assert.deepEqual(state, {
      fetched_at: "2026-09-27T00:00:00Z",
      raw_payload: priorState,
    });
    const attempt = await DB.prepare(
      "SELECT raw_payload FROM sources WHERE id='official-detail-event-1'",
    ).first<{ raw_payload: string }>();
    assert.match(attempt?.raw_payload ?? "", /network_error/);
  } finally {
    restoreFetch();
    await mf.dispose();
  }
});

test("explicit target retains poster fallback after official and Reader transports fail", async () => {
  const { mf, DB } = await setup();
  const restoreFetch = mockReaderAndPoster();
  const calls = { count: 0 };
  try {
    await seed(DB);
    await seedVerifiedPoster(DB);
    const result = await runOfficialDetailRecovery(
      { DB, AI: posterAi(calls), MUNICIPAL_DOCUMENT_AI_ENABLED: "true" } as never,
      new Date("2026-09-28T01:00:00Z"),
      {
        targetEventId: "event-1",
        fetchPage: async () => { throw new TypeError("fetch failed"); },
      },
    );
    assert.equal(result.recovered, 1);
    assert.equal(calls.count, 1);
    const state = await DB.prepare(
      "SELECT raw_payload FROM sources WHERE id='official-poster-event-1'",
    ).first<{ raw_payload: string }>();
    assert.equal(JSON.parse(state!.raw_payload).latest_attempt.status, "success");
  } finally {
    restoreFetch();
    await mf.dispose();
  }
});

test("scheduled recovery retains poster OCR after successful but insufficient HTML", async () => {
  const { mf, DB } = await setup();
  const restoreFetch = mockReaderAndPoster();
  const calls = { count: 0 };
  try {
    await seed(DB);
    await seedVerifiedPoster(DB);
    const result = await runOfficialDetailRecovery(
      { DB, AI: posterAi(calls), MUNICIPAL_DOCUMENT_AI_ENABLED: "true" } as never,
      new Date("2026-09-28T01:00:00Z"),
      {
        fetchPage: async (url) => ({
          finalUrl: url,
          html: "<h1>제9회 동오마을축제 2026 동오마을 푸드페스타</h1><p>2026년 10월 3일 동오마을 공영주차장</p><p>행사 시간: 12:00~19:00</p>",
        }),
      },
    );
    assert.equal(result.fetched, 1);
    assert.equal(result.recovered, 1);
    assert.equal(calls.count, 1);
  } finally {
    restoreFetch();
    await mf.dispose();
  }
});

test("scheduled recovery skips poster OCR after sufficient HTML detail", async () => {
  const { mf, DB } = await setup();
  const restoreFetch = mockReaderAndPoster();
  const calls = { count: 0 };
  try {
    await seed(DB);
    await seedVerifiedPoster(DB);
    const result = await runOfficialDetailRecovery(
      { DB, AI: posterAi(calls), MUNICIPAL_DOCUMENT_AI_ENABLED: "true" } as never,
      new Date("2026-09-28T01:00:00Z"),
      {
        fetchPage: async (url) => ({
          finalUrl: url,
          html: `<h1>제9회 동오마을축제 2026 동오마을 푸드페스타</h1><p>2026년 10월 3일 동오마을 공영주차장에서 주민과 상인이 함께하는 먹거리 축제입니다.</p><p>행사 시간: 12:00~19:00</p><h2>프로그램</h2><p>무대공연 14:00 야외무대</p><p>체험 프로그램 15:00 체험장</p>`,
        }),
      },
    );
    assert.equal(result.fetched, 1);
    assert.equal(result.recovered, 1);
    assert.equal(calls.count, 0);
    const state = await DB.prepare(
      "SELECT 1 FROM sources WHERE id='official-poster-event-1'",
    ).first();
    assert.equal(state, null);
  } finally {
    restoreFetch();
    await mf.dispose();
  }
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
    const multiProgramHtml = `${html}<h2>행사개요</h2><p>한국관광의 메카 Beautiful City가 여러분을 초대합니다.</p><h2>프로그램</h2><p>무대공연 14:00 야외무대</p><p>체험 프로그램 15:00 체험장</p>`;
    await runOfficialDetailRecovery({ DB, AI: ai, MUNICIPAL_DOCUMENT_AI_ENABLED: "true" } as never,
      new Date("2026-09-28T03:00:00Z"), {
        targetEventId: "event-1", fetchPage: async (url) => ({ finalUrl: url, html: multiProgramHtml }),
      });
    assert.equal(calls, 0, "multiple clear programs should suppress OCR even with generic summary copy");
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

async function seedSecondRecoveryCandidate(DB: D1Database) {
  await DB.prepare(
    `INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,cost,pet_policy,status,verification,is_sample,primary_source_id,checked_at,publish_quality_state,publish_quality_reason,publish_quality_rule_version,publish_quality_checked_at)
     VALUES('event-2','제10회 동오마을축제','기존 설명','경기','동오마을 공영주차장','동오마을 공영주차장','2026-10-04','2026-10-04','unknown','unknown','scheduled','verified',0,'municipality','2026-09-27T00:00:00Z','PUBLIC','ok','v1','2026-09-27T00:00:00Z')`,
  ).run();
  await DB.prepare(
    "INSERT INTO event_official_links(event_id,source_id,url,checked_at) VALUES('event-2','municipality','https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2017','2026-09-27T00:00:00Z')",
  ).run();
}

test("scheduled recovery returns its normal result inside the budget when candidates are fast", async () => {
  const { mf, DB } = await setup();
  try {
    await seed(DB);
    const result = await runOfficialDetailRecovery({ DB } as never, new Date("2026-09-28T01:00:00Z"), {
      maxDurationMs: 5_000,
      minExternalRequestRemainingMs: 1,
      fetchPage: async (url) => ({ finalUrl: url, html: "<h1>제9회 동오마을축제 2026 동오마을 푸드페스타</h1><p>2026년 10월 3일 동오마을 공영주차장에서 열리는 공식 축제입니다.</p><p>행사 시간: 12:00~19:00</p><h2>프로그램</h2><p>무대공연 14:00 야외무대</p><p>체험 프로그램 15:00 체험장</p>" }),
    });
    assert.equal(result.budget_exhausted, false);
    assert.equal(result.skipped_due_to_budget, 0);
    assert.equal(result.recovered, 1);
  } finally { await mf.dispose(); }
});

test("scheduled recovery stops a slow direct fetch and does not start the next candidate", async () => {
  const { mf, DB } = await setup();
  try {
    await seed(DB);
    await seedSecondRecoveryCandidate(DB);
    let started = 0;
    const startedAt = Date.now();
    const result = await runOfficialDetailRecovery({ DB } as never, new Date("2026-09-28T01:00:00Z"), {
      maxDurationMs: 100,
      minExternalRequestRemainingMs: 1,
      fetchPage: async () => {
        started += 1;
        return new Promise<never>(() => {});
      },
    });
    assert.ok(Date.now() - startedAt < 500);
    assert.equal(started, 1);
    assert.equal(result.budget_exhausted, true);
    assert.equal(result.skipped_due_to_budget, 1);
  } finally { await mf.dispose(); }
});

test("scheduled Reader fallback is clamped by the remaining recovery budget", async () => {
  const { mf, DB } = await setup();
  const originalFetch = globalThis.fetch;
  try {
    await seed(DB);
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).startsWith("https://r.jina.ai/")) return new Promise<never>(() => {});
      throw new TypeError("direct failed");
    }) as typeof fetch;
    const startedAt = Date.now();
    const result = await runOfficialDetailRecovery({ DB } as never, new Date("2026-09-28T01:00:00Z"), { maxDurationMs: 100, minExternalRequestRemainingMs: 1 });
    assert.ok(Date.now() - startedAt < 500);
    assert.equal(result.reader_attempts, 1);
    assert.equal(result.budget_exhausted, true);
  } finally {
    globalThis.fetch = originalFetch;
    await mf.dispose();
  }
});

test("scheduled OCR timeout returns without allowing a late AI result to persist", async () => {
  const { mf, DB } = await setup();
  const restoreFetch = mockReaderAndPoster();
  let resolveLate: ((value: unknown) => void) | undefined;
  const ai = { run: () => new Promise((resolve) => { resolveLate = resolve; }) };
  try {
    await seed(DB);
    await seedVerifiedPoster(DB);
    const result = await runOfficialDetailRecovery(
      { DB, AI: ai, MUNICIPAL_DOCUMENT_AI_ENABLED: "true" } as never,
      new Date("2026-09-28T01:00:00Z"),
      {
        maxDurationMs: 200,
        minExternalRequestRemainingMs: 1,
        minPosterOcrRemainingMs: 10,
        fetchPage: async (url) => ({ finalUrl: url, html: "<h1>제9회 동오마을축제 2026 동오마을 푸드페스타</h1><p>2026년 10월 3일 동오마을 공영주차장</p>" }),
      },
    );
    assert.equal(result.budget_exhausted, true);
    assert.equal(result.poster_timeouts, 1);
    const before = await DB.prepare("SELECT raw_payload FROM sources WHERE id='official-poster-event-1'").first<{ raw_payload: string }>();
    assert.match(before?.raw_payload ?? "", /official_poster_ocr_timeout/);
    resolveLate?.({ choices: [{ message: { content: JSON.stringify({ transcription: "동오마을 푸드 페스타\n2026. 10. 3.(토)\n12:00~19:00\n동오마을 공영주차장" }) } }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const after = await DB.prepare("SELECT raw_payload FROM sources WHERE id='official-poster-event-1'").first<{ raw_payload: string }>();
    assert.match(after?.raw_payload ?? "", /official_poster_ocr_timeout/);
  } finally {
    restoreFetch();
    await mf.dispose();
  }
});

test("scheduled HTML with a verified poster starts at most one OCR while manual recovery remains unbounded", async () => {
  const { mf, DB } = await setup();
  const restoreFetch = mockReaderAndPoster();
  const calls = { count: 0 };
  try {
    await seed(DB);
    await seedVerifiedPoster(DB);
    const html = "<h1>제9회 동오마을축제 2026 동오마을 푸드페스타</h1><p>2026년 10월 3일 동오마을 공영주차장</p>";
    const scheduled = await runOfficialDetailRecovery({ DB, AI: posterAi(calls), MUNICIPAL_DOCUMENT_AI_ENABLED: "true" } as never, new Date("2026-09-28T01:00:00Z"), {
      maxDurationMs: 500,
      minExternalRequestRemainingMs: 1,
      minPosterOcrRemainingMs: 10,
      fetchPage: async (url) => ({ finalUrl: url, html }),
    });
    assert.equal(scheduled.budget_exhausted, false);
    assert.equal(calls.count, 1);
    const explicit = await runOfficialDetailRecovery({ DB } as never, new Date("2026-09-28T01:00:00Z"), {
      targetEventId: "event-1",
      fetchPage: async (url) => ({ finalUrl: url, html }),
    });
    assert.equal(explicit.budget_exhausted, false);
  } finally {
    restoreFetch();
    await mf.dispose();
  }
});
