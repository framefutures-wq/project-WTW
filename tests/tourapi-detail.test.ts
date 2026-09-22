import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { enrichTourApiDetails } from "../worker/sources/tourapi-detail";

async function setup() {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default {fetch(){return new Response('ok')}}", compatibilityDate: "2026-09-18", d1Databases: ["DB"], cf: false }));
  const DB = await mf.getD1Database("DB");
  for (const file of readdirSync("migrations").sort()) for (const sql of readFileSync(`migrations/${file}`, "utf8").split(";").map((x) => x.trim()).filter(Boolean)) await DB.prepare(sql).run();
  const now = new Date().toISOString();
  await DB.batch([
    DB.prepare("INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES('tourapi-1-source','tourapi',3,'TourAPI','https://api.visitkorea.or.kr',?)").bind(now),
    DB.prepare("INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,cost,status,verification,is_sample,primary_source_id,checked_at) VALUES('tourapi-1','행사','한국관광공사 TourAPI에 등록된 행사입니다.','서울','서울 주소','서울 주소','2026-09-21','2026-10-10','unknown','unknown','verified',0,'tourapi-1-source',?)").bind(now),
  ]);
  return { mf, DB, env: { DB, APP_MODE: "production", TOUR_API_ENABLED: "true", TOUR_API_KEY: "test", ASSETS: {} } };
}
const payload = (item: Record<string, unknown>, total = 1) => ({ response: { header: { resultCode: "0000" }, body: { totalCount: total, items: total ? { item } : "" } } });
function mockDetails() {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL) => {
    const endpoint = new URL(String(input)).pathname.split("/").pop();
    const item = endpoint === "detailCommon2" ? { contentid: "1", contenttypeid: "15", overview: "<p>공식 행사 소개</p>", tel: "02-123-4567" }
      : endpoint === "detailIntro2" ? { contentid: "1", contenttypeid: "15", eventplace: "공식 행사장", playtime: "10:00~18:00", usetimefestival: "입장 무료", sponsor1tel: "02-123-4567" }
      : { contentid: "1", contenttypeid: "15", serialnum: "1", fldgubun: "프로그램", infoname: "대표 공연", infotext: "공식 공연 안내" };
    return Response.json(payload(item));
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}
test("TourAPI detail maps only official summary, venue, whole-event hours, fee, contact source, and explicit repeated program", async () => {
  const { mf, DB, env } = await setup(); const restore = mockDetails();
  try {
    const result = await enrichTourApiDetails(env as never, new Date("2026-09-21T00:00:00Z"));
    assert.deepEqual(result, { candidates: 1, requested: 3, enriched: 1, empty: 0, failed: 0 });
    assert.deepEqual(await DB.prepare("SELECT venue,cost,price_text FROM events WHERE id='tourapi-1'").first(), { venue: "공식 행사장", cost: "free", price_text: "입장 무료" });
    assert.equal((await DB.prepare("SELECT summary FROM event_enrichments WHERE event_id='tourapi-1'").first<{ summary: string }>())?.summary, "공식 행사 소개");
    assert.equal((await DB.prepare("SELECT count(*) n FROM event_operating_hours WHERE event_id='tourapi-1'").first<{ n: number }>())?.n, 1);
    assert.equal((await DB.prepare("SELECT count(*) n FROM event_programs WHERE event_id='tourapi-1'").first<{ n: number }>())?.n, 1);
    await enrichTourApiDetails(env as never, new Date("2026-09-21T00:00:00Z"));
    assert.equal((await DB.prepare("SELECT count(*) n FROM sources WHERE id='tourapi-1-detail'").first<{ n: number }>())?.n, 1);
  } finally { restore(); await mf.dispose(); }
});

test("higher-priority enrichment is preserved and detail failure retains the base event", async () => {
  const { mf, DB, env } = await setup(); const restore = mockDetails();
  try {
    await DB.batch([
      DB.prepare("INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES('official', 'organizer',1,'공식','https://official.test',?)").bind(new Date().toISOString()),
      DB.prepare("INSERT INTO event_enrichments(event_id,summary,source_id,evidence_excerpt,updated_at) VALUES('tourapi-1','보호된 공식 소개','official','official',?)").bind(new Date().toISOString()),
    ]);
    await enrichTourApiDetails(env as never, new Date("2026-09-21T00:00:00Z"));
    assert.equal((await DB.prepare("SELECT summary FROM event_enrichments WHERE event_id='tourapi-1'").first<{ summary: string }>())?.summary, "보호된 공식 소개");
    globalThis.fetch = (async () => { throw new Error("network"); }) as typeof fetch;
    const failed = await enrichTourApiDetails(env as never, new Date("2026-09-30T00:00:00Z"));
    assert.equal(failed.failed, 1);
    assert.equal((await DB.prepare("SELECT count(*) n FROM events WHERE id='tourapi-1'").first<{ n: number }>())?.n, 1);
  } finally { restore(); await mf.dispose(); }
});
