import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { runMunicipalAutonomous } from "../worker/sources/municipal";

const LIST_URL = "https://www.swcf.or.kr/?p=29";
const DETAIL_URL = "https://www.swcf.or.kr/?p=29_view&idx=3049";
const EVENT_ID = "municipal-suwon-3049";
const SOURCE_ID = "municipal-source-" + EVENT_ID;

function suwonList() {
  return `
    <table>
      <tr>
        <td>축제</td>
        <td>2099-10-03 ~ 2099-10-04</td>
        <td><a href="${DETAIL_URL}">제1회 수원거리축제</a></td>
        <td>수원화성</td>
      </tr>
    </table>
  `;
}

function richDetailHtml() {
  return `
    <html>
      <head>
        <meta property="og:image" content="/uploads/suwon-main.jpg">
      </head>
      <body>
        <h1>제1회 수원거리축제</h1>
        <dl>
          <dt>시간</dt><dd>15:00~16:00, 17:00~18:00</dd>
          <dt>이용료</dt><dd>무료</dd>
          <dt>문의</dt><dd>031-247-5615</dd>
          <dt>장소</dt><dd>수원화성</dd>
        </dl>
        <h2>상세내용</h2>
        <p>수원화성에서 시민과 방문객이 함께 즐기는 공식 거리축제입니다.</p>
        <h2>프로그램</h2>
        <h3>거리 공연</h3>
        <p>15:00~16:00 공식 거리 공연을 진행합니다.</p>
        <h3>전통놀이 체험</h3>
        <p>가족이 함께 참여할 수 있는 체험 프로그램입니다.</p>
        <img src="/uploads/program.jpg" width="1200" height="800" alt="거리 공연">
      </body>
    </html>
  `;
}

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

async function withOfficialFetch<T>(run: () => Promise<T>) {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url === LIST_URL) return new Response(suwonList(), { status: 200 });
    if (url === DETAIL_URL)
      return new Response(richDetailHtml(), { status: 200 });
    return new Response("", { status: 404 });
  };
  try {
    return { result: await run(), calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const envFor = (DB: D1Database) =>
  ({
    DB,
    APP_MODE: "production",
    TOUR_API_ENABLED: "false",
    ASSETS: {},
  }) as any;

async function assertRichRows(DB: D1Database) {
  const enrichment = await DB.prepare(
    "SELECT summary,source_id FROM event_enrichments WHERE event_id=?",
  )
    .bind(EVENT_ID)
    .first<{ summary: string; source_id: string }>();
  assert.match(enrichment?.summary ?? "", /공식 거리축제/);
  assert.equal(enrichment?.source_id, SOURCE_ID);

  const event = await DB.prepare(
    "SELECT cost,price_text FROM events WHERE id=?",
  )
    .bind(EVENT_ID)
    .first<{ cost: string; price_text: string | null }>();
  assert.deepEqual(event, { cost: "free", price_text: "무료" });

  const hours = await DB.prepare(
    "SELECT start_time,end_time FROM event_operating_hours WHERE event_id=? ORDER BY sort_order",
  )
    .bind(EVENT_ID)
    .all<{ start_time: string; end_time: string | null }>();
  assert.deepEqual(
    hours.results.map((row) => [row.start_time, row.end_time]),
    [
      ["15:00", "16:00"],
      ["17:00", "18:00"],
    ],
  );

  const image = await DB.prepare(
    "SELECT image_url,source_type FROM event_images WHERE event_id=?",
  )
    .bind(EVENT_ID)
    .first<{ image_url: string; source_type: string }>();
  assert.deepEqual(image, {
    image_url: "https://www.swcf.or.kr/uploads/suwon-main.jpg",
    source_type: "municipality",
  });

  const programs = await DB.prepare(
    "SELECT program_name FROM event_programs WHERE event_id=? ORDER BY sort_order",
  )
    .bind(EVENT_ID)
    .all<{ program_name: string }>();
  assert.deepEqual(
    programs.results.map((row) => row.program_name),
    ["거리 공연", "전통놀이 체험"],
  );

  const source = await DB.prepare(
    "SELECT url,raw_payload FROM sources WHERE id=?",
  )
    .bind(SOURCE_ID)
    .first<{ url: string; raw_payload: string }>();
  assert.equal(source?.url, DETAIL_URL);
  assert.equal(
    JSON.parse(source!.raw_payload).municipal_rich_detail.contact_phone,
    "031-247-5615",
  );
}

test("new municipal publication persists rich detail from the same bounded detail fetch", async () => {
  const { mf, DB } = await setup();
  try {
    const { result, calls } = await withOfficialFetch(() =>
      runMunicipalAutonomous(envFor(DB), {
        sourceKeys: ["suwon"],
        maxPublishMutations: 1,
        maxRetryCandidates: 0,
        maxDetailFetches: 2,
        maxExternalFetches: 6,
      }),
    );

    assert.equal(result.AUTO_PUBLISH, 1);
    assert.equal(result.inserted, 1);
    assert.equal(result.detail_fetches, 1);
    assert.equal(result.rich_detail_attempted, 1);
    assert.equal(result.rich_detail_candidates, 1);
    assert.equal(result.rich_detail_persisted, 1);
    assert.equal(result.rich_detail_errors, 0);
    assert.deepEqual(result.rich_detail_by_source, { suwon: 1 });
    assert.equal(calls.filter((url) => url === DETAIL_URL).length, 1);
    await assertRichRows(DB);
  } finally {
    await mf.dispose();
  }
});

test("existing sparse municipal event can rich-backfill even when core publish mutation budget is zero", async () => {
  const { mf, DB } = await setup();
  try {
    await DB.prepare(
      `INSERT INTO sources(
        id,kind,priority,name,url,fetched_at,raw_payload
      ) VALUES(?, 'municipality', 2, '기존 수원 공식 행사 안내', ?, ?, NULL)`,
    )
      .bind(SOURCE_ID, LIST_URL, "2026-09-27T00:00:00Z")
      .run();
    await DB.prepare(
      `INSERT INTO events(
        id,title,description,region,venue,address,start_date,end_date,
        lat,lng,cost,price_text,pet_policy,status,verification,is_sample,
        primary_source_id,checked_at,updated_at
      ) VALUES(
        ?,'제1회 수원거리축제','기존 빈약 설명','경기','수원화성','수원화성',
        '2099-10-03','2099-10-04',NULL,NULL,'unknown',NULL,'unknown',
        'scheduled','verified',0,?,?,?
      )`,
    )
      .bind(
        EVENT_ID,
        SOURCE_ID,
        "2026-09-27T00:00:00Z",
        "2026-09-27T00:00:00Z",
      )
      .run();

    const { result, calls } = await withOfficialFetch(() =>
      runMunicipalAutonomous(envFor(DB), {
        sourceKeys: ["suwon"],
        maxPublishMutations: 0,
        maxRetryCandidates: 0,
        maxDetailFetches: 2,
        maxExternalFetches: 6,
      }),
    );

    assert.equal(result.AUTO_PUBLISH, 0);
    assert.equal(result.AUTO_RETRY, 1);
    assert.equal(result.inserted, 0);
    assert.equal(result.updated, 0);
    assert.equal(result.detail_fetches, 1);
    assert.equal(result.rich_detail_persisted, 1);
    assert.equal(result.rich_detail_errors, 0);
    assert.equal(calls.filter((url) => url === DETAIL_URL).length, 1);

    const base = await DB.prepare(
      "SELECT description,start_date,end_date,venue FROM events WHERE id=?",
    )
      .bind(EVENT_ID)
      .first<{
        description: string;
        start_date: string;
        end_date: string;
        venue: string;
      }>();
    assert.deepEqual(base, {
      description: "기존 빈약 설명",
      start_date: "2099-10-03",
      end_date: "2099-10-04",
      venue: "수원화성",
    });

    await assertRichRows(DB);
  } finally {
    await mf.dispose();
  }
});
