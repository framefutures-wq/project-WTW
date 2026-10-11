import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { cleanupExpiredMunicipalDetailJobs, detailFetchOne, detailParseOne, detailPersistOne, enqueueMunicipalDetailJob, fetchMunicipalDetailTransport, MUNICIPAL_DETAIL_RAW_HTML_MAX_BYTES } from "../worker/sources/municipal-detail-jobs";
import { municipalSourceByKey } from "../shared/municipal-source-registry";

async function setup() {
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:"export default {fetch(){return new Response('ok')}}",compatibilityDate:"2026-09-18",d1Databases:["DB"],cf:false}));
  const DB=await mf.getD1Database("DB");
  for(const file of readdirSync("migrations").sort()) for(const sql of readFileSync(`migrations/${file}`,"utf8").split(";").map(x=>x.trim()).filter(Boolean)) await DB.prepare(sql).run();
  return {mf,DB};
}
const candidate={source:"paju",source_candidate_id:"detail-job-1",title:"파주 행사",start_date:"2099-10-03",end_date:"2099-10-04",region:"경기",locality:"파주",venue:"파주",official_url:"https://tour.paju.go.kr/user/link/cultural/BD_index.do",category:"축제",snippet:null,image_candidate:null};

test("detail micro-job stages never combine fetch, parse, and persist",async()=>{
  const {mf,DB}=await setup(); try {
    await enqueueMunicipalDetailJob(DB,{sourceKey:"paju",candidate,eventId:"event-1"});
    let fetches=0;
    await detailFetchOne(DB,async()=>{fetches++;return new Response("<h2>프로그램</h2><h3>공연</h3><p>공식 행사</p>");});
    assert.equal(fetches,1);
    let row=await DB.prepare("SELECT stage,raw_html,normalized_json FROM municipal_detail_jobs").first<any>();
    assert.equal(row.stage,"PARSE_PENDING"); assert.ok(row.raw_html); assert.equal(row.normalized_json,null);
    await detailParseOne(DB);
    row=await DB.prepare("SELECT stage,raw_html,normalized_json FROM municipal_detail_jobs").first<any>();
    assert.equal(row.stage,"PERSIST_PENDING"); assert.equal(row.raw_html,null); assert.ok(row.normalized_json);
    await detailPersistOne(DB);
    row=await DB.prepare("SELECT stage FROM municipal_detail_jobs").first<any>();
    assert.equal(row.stage,"DONE");
    const duplicate=await enqueueMunicipalDetailJob(DB,{sourceKey:"paju",candidate,eventId:"event-1"});
    assert.ok(duplicate); const count=await DB.prepare("SELECT COUNT(*) count FROM municipal_detail_jobs").first<any>(); assert.equal(count.count,1);
  } finally {await mf.dispose();}
});

test("oversize detail response fails closed before parser storage",async()=>{
  const {mf,DB}=await setup(); try {
    await enqueueMunicipalDetailJob(DB,{sourceKey:"paju",candidate:{...candidate,source_candidate_id:"detail-job-2"},eventId:"event-2"});
    await detailFetchOne(DB,async()=>new Response("x".repeat(MUNICIPAL_DETAIL_RAW_HTML_MAX_BYTES+1)));
    const row=await DB.prepare("SELECT stage,raw_html,safe_error_category FROM municipal_detail_jobs").first<any>();
    assert.deepEqual(row,{stage:"RETRY",raw_html:null,safe_error_category:"raw_html_too_large"});
  } finally {await mf.dispose();}
});

test("expired checkpoints are removed regardless of terminal stage",async()=>{
  const {mf,DB}=await setup(); try {
    await enqueueMunicipalDetailJob(DB,{sourceKey:"paju",candidate,eventId:"event-3"});
    await DB.prepare("UPDATE municipal_detail_jobs SET stage='DONE',expires_at='2000-01-01T00:00:00.000Z'").run();
    await cleanupExpiredMunicipalDetailJobs(DB);
    const row=await DB.prepare("SELECT COUNT(*) count FROM municipal_detail_jobs").first<any>(); assert.equal(row.count,0);
  } finally {await mf.dispose();}
});

test("official transport sends browser headers and retries only retryable errors", async () => {
  const source=municipalSourceByKey("gyeonggi-의정부")!; let calls=0, headers: Headers|undefined;
  const result=await fetchMunicipalDetailTransport(source,candidate.official_url,async (_url,init)=>{calls++;headers=new Headers(init?.headers); if(calls===1) return new Response("",{status:503}); return new Response("official",{status:200});});
  assert.equal(result.html,"official"); assert.equal(calls,2); assert.match(headers?.get("user-agent")??"",/Mozilla/); assert.match(headers?.get("accept-language")??"",/ko-KR/);
  calls=0; await assert.rejects(()=>fetchMunicipalDetailTransport(source,candidate.official_url,async()=>{calls++;return new Response("",{status:404});})); assert.equal(calls,1);
});
