import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
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
