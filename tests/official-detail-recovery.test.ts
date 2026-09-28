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
      if (url === "https://r.jina.ai/") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { url?: string };
        assert.match(body.url ?? "", /idx=2016/);
        return new Response(JSON.stringify({ data: { url: body.url, content:
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
  } finally {
    globalThis.fetch = originalFetch;
    await mf.dispose();
  }
});
