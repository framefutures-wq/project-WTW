import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import {
  classifyDetailFailure,
  detailRetryAt,
  enrichTourApiDetails,
  selectTourApiDetailCandidates,
} from "../worker/sources/tourapi-detail";

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
    for (const sql of readFileSync(`migrations/${file}`, "utf8")
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean))
      await DB.prepare(sql).run();
  const now = new Date().toISOString();
  await DB.batch([
    DB.prepare(
      "INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES('tourapi-1-source','tourapi',3,'TourAPI','https://api.visitkorea.or.kr',?)",
    ).bind(now),
    DB.prepare(
      "INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,cost,status,verification,is_sample,primary_source_id,checked_at) VALUES('tourapi-1','행사','한국관광공사 TourAPI에 등록된 행사입니다.','서울','서울 주소','서울 주소','2026-09-21','2026-10-10','unknown','unknown','verified',0,'tourapi-1-source',?)",
    ).bind(now),
  ]);
  return {
    mf,
    DB,
    env: {
      DB,
      APP_MODE: "production",
      TOUR_API_ENABLED: "true",
      TOUR_API_KEY: "test",
      ASSETS: {},
    },
  };
}
const payload = (item: Record<string, unknown>, total = 1) => ({
  response: {
    header: { resultCode: "0000" },
    body: { totalCount: total, items: total ? { item } : "" },
  },
});
function mockDetails() {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL) => {
    const endpoint = new URL(String(input)).pathname.split("/").pop();
    const item =
      endpoint === "detailCommon2"
        ? {
            contentid: "1",
            contenttypeid: "15",
            overview: "<p>공식 행사 소개</p>",
            tel: "02-123-4567",
          }
        : endpoint === "detailIntro2"
          ? {
              contentid: "1",
              contenttypeid: "15",
              eventplace: "공식 행사장",
              playtime: "10:00~18:00",
              usetimefestival: "입장 무료",
              sponsor1tel: "02-123-4567",
            }
          : {
              contentid: "1",
              contenttypeid: "15",
              serialnum: "1",
              fldgubun: "프로그램",
              infoname: "대표 공연",
              infotext: "공식 공연 안내",
            };
    return Response.json(payload(item));
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}
test("TourAPI detail maps only official summary, venue, whole-event hours, fee, contact source, and explicit repeated program", async () => {
  const { mf, DB, env } = await setup();
  const restore = mockDetails();
  try {
    const result = await enrichTourApiDetails(
      env as never,
      new Date("2026-09-21T00:00:00Z"),
    );
    assert.deepEqual(result, {
      candidates: 1,
      requested: 3,
      attempts: 3,
      retry_attempted: 0,
      retry_recovered: 0,
      retry_exhausted: 0,
      enriched: 1,
      empty: 0,
      failed: 0,
      failure_reasons: {},
      failure_endpoints: {},
    });
    assert.deepEqual(
      await DB.prepare(
        "SELECT venue,cost,price_text FROM events WHERE id='tourapi-1'",
      ).first(),
      { venue: "공식 행사장", cost: "free", price_text: "입장 무료" },
    );
    assert.equal(
      (
        await DB.prepare(
          "SELECT summary FROM event_enrichments WHERE event_id='tourapi-1'",
        ).first<{ summary: string }>()
      )?.summary,
      "공식 행사 소개",
    );
    assert.equal(
      (
        await DB.prepare(
          "SELECT count(*) n FROM event_operating_hours WHERE event_id='tourapi-1'",
        ).first<{ n: number }>()
      )?.n,
      1,
    );
    assert.equal(
      (
        await DB.prepare(
          "SELECT count(*) n FROM event_programs WHERE event_id='tourapi-1'",
        ).first<{ n: number }>()
      )?.n,
      1,
    );
    await enrichTourApiDetails(env as never, new Date("2026-09-21T00:00:00Z"));
    assert.equal(
      (
        await DB.prepare(
          "SELECT count(*) n FROM sources WHERE id='tourapi-1-detail'",
        ).first<{ n: number }>()
      )?.n,
      1,
    );
  } finally {
    restore();
    await mf.dispose();
  }
});

test("higher-priority enrichment is preserved and detail failure retains the base event", async () => {
  const { mf, DB, env } = await setup();
  const restore = mockDetails();
  try {
    await DB.batch([
      DB.prepare(
        "INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES('official', 'organizer',1,'공식','https://official.test',?)",
      ).bind(new Date().toISOString()),
      DB.prepare(
        "INSERT INTO event_enrichments(event_id,summary,source_id,evidence_excerpt,updated_at) VALUES('tourapi-1','보호된 공식 소개','official','official',?)",
      ).bind(new Date().toISOString()),
    ]);
    await enrichTourApiDetails(env as never, new Date("2026-09-21T00:00:00Z"));
    assert.equal(
      (
        await DB.prepare(
          "SELECT summary FROM event_enrichments WHERE event_id='tourapi-1'",
        ).first<{ summary: string }>()
      )?.summary,
      "보호된 공식 소개",
    );
    globalThis.fetch = (async () => {
      throw new Error("network");
    }) as typeof fetch;
    const failed = await enrichTourApiDetails(
      env as never,
      new Date("2026-10-01T00:00:00Z"),
      { sleep: async () => {} },
    );
    assert.equal(failed.failed, 1);
    assert.deepEqual(failed.failure_reasons, { network_or_timeout: 1 });
    assert.equal(failed.retry_attempted, 1);
    assert.equal(failed.retry_exhausted, 1);
    assert.deepEqual(failed.failure_endpoints, { detailCommon2: 1 });
    assert.equal(
      (
        await DB.prepare(
          "SELECT count(*) n FROM events WHERE id='tourapi-1'",
        ).first<{ n: number }>()
      )?.n,
      1,
    );
  } finally {
    restore();
    await mf.dispose();
  }
});

test("detail candidates prioritize retry-due failures, then never-processed events, then TTL refreshes", async () => {
  const { mf, DB } = await setup();
  const now = new Date("2026-09-21T01:00:00.000Z");
  const insert = async (id: string) => {
    await DB.batch([
      DB.prepare(
        "INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES(?,'tourapi',3,'TourAPI','https://api.visitkorea.or.kr',?)",
      ).bind(`${id}-source`, now.toISOString()),
      DB.prepare(
        "INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,cost,status,verification,is_sample,primary_source_id,checked_at) VALUES(?,?, '설명','서울','주소','주소','2026-09-20','2026-10-10','unknown','unknown','verified',0,?,?)",
      ).bind(id, id, `${id}-source`, now.toISOString()),
    ]);
  };
  try {
    await insert("tourapi-failed-due");
    await insert("tourapi-never");
    await insert("tourapi-refresh");
    await insert("tourapi-failed-waiting");
    await DB.batch([
      DB.prepare(
        "INSERT INTO tourapi_detail_state(event_id,source_id,content_id,last_checked_at,last_success_at,status,failure_count,next_retry_at,updated_at) VALUES('tourapi-1','tourapi-1-source','1',?,?, 'success',0,NULL,?)",
      ).bind(now.toISOString(), now.toISOString(), now.toISOString()),
      DB.prepare(
        "INSERT INTO tourapi_detail_state(event_id,source_id,content_id,last_checked_at,last_success_at,status,failure_count,next_retry_at,updated_at) VALUES('tourapi-failed-due','tourapi-failed-due-source','failed-due',?,NULL,'failed',1,?,?)",
      ).bind(
        now.toISOString(),
        new Date(now.getTime() - 1).toISOString(),
        now.toISOString(),
      ),
      DB.prepare(
        "INSERT INTO tourapi_detail_state(event_id,source_id,content_id,last_checked_at,last_success_at,status,failure_count,next_retry_at,updated_at) VALUES('tourapi-refresh','tourapi-refresh-source','refresh',?,?, 'success',0,NULL,?)",
      ).bind(
        now.toISOString(),
        new Date(now.getTime() - 8 * 24 * 3600_000).toISOString(),
        now.toISOString(),
      ),
      DB.prepare(
        "INSERT INTO tourapi_detail_state(event_id,source_id,content_id,last_checked_at,last_success_at,status,failure_count,next_retry_at,updated_at) VALUES('tourapi-failed-waiting','tourapi-failed-waiting-source','failed-waiting',?,NULL,'failed',1,?,?)",
      ).bind(
        now.toISOString(),
        new Date(now.getTime() + 1).toISOString(),
        now.toISOString(),
      ),
    ]);
    const candidates = await selectTourApiDetailCandidates(DB, now, 10);
    assert.deepEqual(
      candidates.map((candidate) => candidate.id),
      ["tourapi-failed-due", "tourapi-never", "tourapi-refresh"],
    );
  } finally {
    await mf.dispose();
  }
});

test("detail retry schedule uses a 30-minute first retry then bounded exponential backoff", () => {
  const checkedAt = "2026-09-21T01:00:00.000Z";
  assert.equal(detailRetryAt(checkedAt, 1), "2026-09-21T01:30:00.000Z");
  assert.equal(detailRetryAt(checkedAt, 2), "2026-09-21T03:00:00.000Z");
  assert.equal(detailRetryAt(checkedAt, 3), "2026-09-21T05:00:00.000Z");
  assert.equal(detailRetryAt(checkedAt, 5), "2026-09-21T17:00:00.000Z");
  assert.equal(detailRetryAt(checkedAt, 6), "2026-09-22T01:00:00.000Z");
});

test("detail failures are classified without persisting raw error messages", () => {
  assert.equal(
    classifyDetailFailure(
      new Error("TourAPI detailCommon2 network/timeout failure"),
    ),
    "network_or_timeout",
  );
  assert.equal(
    classifyDetailFailure(new Error("TourAPI detailIntro2 HTTP 429")),
    "http_429",
  );
  assert.equal(
    classifyDetailFailure(new Error("TourAPI detailInfo2 HTTP 503")),
    "http_5xx",
  );
  assert.equal(
    classifyDetailFailure(new Error("TourAPI provider resultCode=22")),
    "provider_error",
  );
  assert.equal(
    classifyDetailFailure(new Error("TourAPI detail content_id_mismatch")),
    "content_id_mismatch",
  );
  assert.equal(
    classifyDetailFailure(new Error("TourAPI detail response exceeds bound")),
    "response_bound",
  );
  assert.equal(classifyDetailFailure(new Error("unexpected")), "other");
});

test("a transient detail endpoint failure retries once and recovers", async () => {
  const { mf, DB, env } = await setup();
  const original = globalThis.fetch;
  let commonAttempts = 0;
  globalThis.fetch = (async (input: string | URL) => {
    const endpoint = new URL(String(input)).pathname.split("/").pop();
    if (endpoint === "detailCommon2" && commonAttempts++ === 0) throw new Error("network");
    const item = endpoint === "detailCommon2"
      ? { contentid: "1", contenttypeid: "15", overview: "소개" }
      : endpoint === "detailIntro2"
        ? { contentid: "1", contenttypeid: "15" }
        : { contentid: "1", contenttypeid: "15" };
    return Response.json(payload(item));
  }) as typeof fetch;
  try {
    const result = await enrichTourApiDetails(env as never, new Date("2026-09-21T00:00:00Z"), { sleep: async () => {} });
    assert.equal(result.failed, 0);
    assert.equal(result.attempts, 4);
    assert.equal(result.retry_attempted, 1);
    assert.equal(result.retry_recovered, 1);
    assert.equal(result.retry_exhausted, 0);
  } finally {
    globalThis.fetch = original;
    await mf.dispose();
  }
});

test("a transient detail endpoint failure retries exactly once then records the endpoint", async () => {
  const { mf, env } = await setup();
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("network"); }) as typeof fetch;
  try {
    const result = await enrichTourApiDetails(env as never, new Date("2026-09-21T00:00:00Z"), { sleep: async () => {} });
    assert.equal(result.attempts, 2);
    assert.equal(result.retry_attempted, 1);
    assert.equal(result.retry_exhausted, 1);
    assert.deepEqual(result.failure_reasons, { network_or_timeout: 1 });
    assert.deepEqual(result.failure_endpoints, { detailCommon2: 1 });
  } finally {
    globalThis.fetch = original;
    await mf.dispose();
  }
});

test("429 and provider errors do not retry", async () => {
  for (const mode of ["429", "provider"] as const) {
    const { mf, env } = await setup();
    const original = globalThis.fetch;
    globalThis.fetch = (async () => mode === "429"
      ? new Response(null, { status: 429 })
      : Response.json({ response: { header: { resultCode: "22" }, body: { totalCount: 0, items: "" } } })) as typeof fetch;
    try {
      const result = await enrichTourApiDetails(env as never, new Date("2026-09-21T00:00:00Z"), { sleep: async () => {} });
      assert.equal(result.attempts, 1);
      assert.equal(result.retry_attempted, 0);
      assert.equal(result.retry_exhausted, 0);
    } finally {
      globalThis.fetch = original;
      await mf.dispose();
    }
  }
});

test("a run never exceeds the 25-detail retry budget", async () => {
  const { mf, DB, env } = await setup();
  const now = new Date("2026-09-21T00:00:00Z").toISOString();
  for (let n = 2; n <= 26; n++) {
    const id = `tourapi-${n}`;
    await DB.batch([
      DB.prepare("INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES(?,'tourapi',3,'TourAPI','https://api.visitkorea.or.kr',?)").bind(`${id}-source`, now),
      DB.prepare("INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,cost,status,verification,is_sample,primary_source_id,checked_at) VALUES(?,?, '설명','서울','주소','주소','2026-09-21','2026-10-10','unknown','unknown','verified',0,?,?)").bind(id, id, `${id}-source`, now),
    ]);
  }
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("network"); }) as typeof fetch;
  try {
    const result = await enrichTourApiDetails(env as never, new Date("2026-09-21T00:00:00Z"), { sleep: async () => {} });
    assert.equal(result.candidates, 25);
    assert.equal(result.retry_attempted, 25);
    assert.equal(result.attempts, 50);
    assert.equal(result.retry_exhausted, 25);
  } finally {
    globalThis.fetch = original;
    await mf.dispose();
  }
});
