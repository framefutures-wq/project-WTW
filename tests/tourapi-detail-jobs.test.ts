import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  cleanupExpiredTourApiDetailOne,
  runTourApiDetailMicroJobOne,
} from "../worker/sources/tourapi-detail-jobs";

const AT = "2026-09-21T01:00:00.000Z";
const fixture = (endpoint: string) => endpoint === "detailCommon2"
  ? [{ contentid: "1", contenttypeid: "15", overview: "<p>공식 행사 소개</p>" }]
  : endpoint === "detailIntro2"
    ? [{ contentid: "1", contenttypeid: "15", eventplace: "공식 행사장", playtime: "10:00~18:00", usetimefestival: "입장 무료", eventhomepage: "https://festival.example.org/" }]
    : [{ contentid: "1", contenttypeid: "15", serialnum: "1", fldgubun: "프로그램", infoname: "대표 공연", infotext: "공식 공연 안내" }];

async function setup() {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default {fetch(){return new Response('ok')}}", compatibilityDate: "2026-09-18", d1Databases: ["DB"], cf: false }));
  const DB = await mf.getD1Database("DB");
  for (const file of readdirSync("migrations").sort())
    for (const sql of readFileSync(`migrations/${file}`, "utf8").split(";").map((part) => part.trim()).filter(Boolean)) await DB.prepare(sql).run();
  await DB.batch([
    DB.prepare("INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES('tourapi-source','tourapi',3,'TourAPI','https://api.visitkorea.or.kr',?)").bind(AT),
    DB.prepare("INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,cost,status,verification,is_sample,primary_source_id,checked_at,publish_quality_state,publish_quality_reason,publish_quality_rule_version,publish_quality_checked_at) VALUES('tourapi-1','행사','기본 소개','서울','서울 주소','서울 주소','2026-09-21','2026-10-10','unknown','unknown','verified',0,'tourapi-source',?,'PUBLIC','ok','v1',?)").bind(AT, AT),
  ]);
  return { mf, DB, env: { DB, APP_MODE: "production", TOUR_API_ENABLED: "true", TOUR_API_KEY: "test", ASSETS: {} } as never };
}
const deps = { fetchEndpoint: async (endpoint: "detailCommon2" | "detailIntro2" | "detailInfo2") => fixture(endpoint) };

test("one candidate advances exactly one TourAPI endpoint/checkpoint per invocation and persists legacy facts", async () => {
  const { mf, DB, env } = await setup();
  try {
    assert.deepEqual(await runTourApiDetailMicroJobOne(env, AT, deps), { stage: "ENQUEUE_ONE", status: "enqueued", job_id: "tourapi-1" });
    assert.equal((await runTourApiDetailMicroJobOne(env, AT, deps)).stage, "FETCH_COMMON");
    assert.equal((await runTourApiDetailMicroJobOne(env, AT, deps)).stage, "FETCH_INTRO");
    assert.equal((await runTourApiDetailMicroJobOne(env, AT, deps)).stage, "FETCH_INFO");
    assert.equal((await runTourApiDetailMicroJobOne(env, AT, deps)).stage, "PERSIST_ONE");
    assert.deepEqual(await DB.prepare("SELECT venue,cost,price_text FROM events WHERE id='tourapi-1'").first(), { venue: "공식 행사장", cost: "free", price_text: "입장 무료" });
    assert.deepEqual(await DB.prepare("SELECT start_time,end_time FROM event_operating_hours WHERE event_id='tourapi-1'").first(), { start_time: "10:00", end_time: "18:00" });
    assert.deepEqual(await DB.prepare("SELECT status,failure_count,next_retry_at FROM tourapi_detail_state WHERE event_id='tourapi-1'").first(), { status: "success", failure_count: 0, next_retry_at: null });
    assert.equal((await DB.prepare("SELECT checkpoint_json FROM tourapi_detail_jobs WHERE event_id='tourapi-1'").first<{ checkpoint_json: string | null }>())?.checkpoint_json, null);
  } finally { await mf.dispose(); }
});

test("future retry is not claimed, due retry resumes its exact endpoint, and expiry records legacy failure", async () => {
  const { mf, DB, env } = await setup();
  try {
    await runTourApiDetailMicroJobOne(env, AT, deps);
    await DB.prepare("UPDATE tourapi_detail_jobs SET stage='RETRY',retry_stage='FETCH_COMMON',available_at='2026-09-21T01:01:00.000Z',retry_at='2026-09-21T01:01:00.000Z'").run();
    assert.equal((await runTourApiDetailMicroJobOne(env, AT, deps)).stage, "NO_OP");
    assert.equal((await runTourApiDetailMicroJobOne(env, "2026-09-21T01:01:00.000Z", deps)).stage, "RETRY");
    await DB.prepare("UPDATE tourapi_detail_jobs SET expires_at='2000-01-01T00:00:00.000Z'").run();
    assert.equal((await cleanupExpiredTourApiDetailOne(DB, AT))?.stage, "CLEANUP");
    assert.deepEqual(await DB.prepare("SELECT status,failure_count,next_retry_at FROM tourapi_detail_state WHERE event_id='tourapi-1'").first(), { status: "failed", failure_count: 1, next_retry_at: "2026-09-21T01:30:00.000Z" });
  } finally { await mf.dispose(); }
});

test("higher-priority detail is preserved by the micro persist path", async () => {
  const { mf, DB, env } = await setup();
  try {
    await DB.batch([
      DB.prepare("INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES('organizer', 'organizer',1,'주최','https://organizer.example',?)").bind(AT),
      DB.prepare("INSERT INTO event_enrichments(event_id,summary,source_id,evidence_excerpt,updated_at) VALUES('tourapi-1','주최 공식 소개','organizer','official',?)").bind(AT),
    ]);
    await runTourApiDetailMicroJobOne(env, AT, deps);
    await runTourApiDetailMicroJobOne(env, AT, deps);
    await runTourApiDetailMicroJobOne(env, AT, deps);
    await runTourApiDetailMicroJobOne(env, AT, deps);
    await runTourApiDetailMicroJobOne(env, AT, deps);
    assert.deepEqual(await DB.prepare("SELECT summary,source_id FROM event_enrichments WHERE event_id='tourapi-1'").first(), { summary: "주최 공식 소개", source_id: "organizer" });
  } finally { await mf.dispose(); }
});

test("oversized or mismatched endpoint payload becomes a bounded retry without partial persistence", async () => {
  const { mf, DB, env } = await setup();
  try {
    await runTourApiDetailMicroJobOne(env, AT, deps);
    await runTourApiDetailMicroJobOne(env, AT, deps);
    await runTourApiDetailMicroJobOne(env, AT, deps);
    const invalid = { fetchEndpoint: async (endpoint: "detailCommon2" | "detailIntro2" | "detailInfo2") =>
      endpoint === "detailInfo2" ? Array.from({ length: 21 }, () => ({ contentid: "1", contenttypeid: "15" })) : fixture(endpoint) };
    assert.deepEqual(await runTourApiDetailMicroJobOne(env, AT, invalid), { stage: "FETCH_INFO", status: "RETRY", job_id: "tourapi-1" });
    assert.deepEqual(await DB.prepare("SELECT stage,retry_stage,checkpoint_json FROM tourapi_detail_jobs WHERE event_id='tourapi-1'").first(), {
      stage: "RETRY", retry_stage: "FETCH_INFO", checkpoint_json: JSON.stringify({ common: fixture("detailCommon2")[0], intro: fixture("detailIntro2")[0] }),
    });
    assert.equal(await DB.prepare("SELECT 1 FROM tourapi_detail_state WHERE event_id='tourapi-1'").first(), null);
  } finally { await mf.dispose(); }
});

test("lease and generation guards make duplicate claim and stale update harmless", async () => {
  const { mf, DB, env } = await setup();
  try {
    await runTourApiDetailMicroJobOne(env, AT, deps);
    const [left, right] = await Promise.all([
      runTourApiDetailMicroJobOne(env, AT, deps),
      runTourApiDetailMicroJobOne(env, AT, deps),
    ]);
    assert.equal([left, right].filter((item) => item.stage === "FETCH_COMMON").length, 1);
    await DB.prepare("UPDATE tourapi_detail_jobs SET stage='FETCH_COMMON',available_at=?,lease_token=NULL WHERE event_id='tourapi-1'").bind(AT).run();
    let unblock: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { unblock = resolve; });
    const stale = runTourApiDetailMicroJobOne(env, AT, { fetchEndpoint: async () => { await blocked; return fixture("detailCommon2"); } });
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await DB.prepare("SELECT lease_token FROM tourapi_detail_jobs WHERE event_id='tourapi-1'").first<{ lease_token: string | null }>())?.lease_token) break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await DB.prepare("UPDATE tourapi_detail_jobs SET generation=generation+1 WHERE event_id='tourapi-1'").run();
    unblock?.();
    assert.equal((await stale).status, "lost_claim");
    assert.equal((await DB.prepare("SELECT stage FROM tourapi_detail_jobs WHERE event_id='tourapi-1'").first<{ stage: string }>())?.stage, "FETCH_COMMON");
  } finally { await mf.dispose(); }
});

test("a completed earliest candidate cannot monopolize later due candidates", async () => {
  const { mf, DB, env } = await setup();
  try {
    await DB.prepare("INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,cost,status,verification,is_sample,primary_source_id,checked_at,publish_quality_state,publish_quality_reason,publish_quality_rule_version,publish_quality_checked_at) VALUES('tourapi-2','두번째 행사','기본 소개','서울','서울 주소','서울 주소','2026-09-22','2026-10-10','unknown','unknown','verified',0,'tourapi-source',?,'PUBLIC','ok','v1',?)").bind(AT, AT).run();
    for (let count = 0; count < 5; count++) await runTourApiDetailMicroJobOne(env, AT, deps);
    assert.deepEqual(await runTourApiDetailMicroJobOne(env, AT, deps), { stage: "ENQUEUE_ONE", status: "enqueued", job_id: "tourapi-2" });
  } finally { await mf.dispose(); }
});
