import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { cleanupExpiredMunicipalDetailJobs, detailFetchOne, detailParseOne, detailPersistOne, enqueueMunicipalDetailJob, fetchMunicipalDetailTransport, MUNICIPAL_DETAIL_RAW_HTML_MAX_BYTES, MUNICIPAL_DETAIL_TTL_MS, MUNICIPAL_DETAIL_VERIFICATION_RETENTION_MS } from "../worker/sources/municipal-detail-jobs";
import { municipalSourceByKey } from "../shared/municipal-source-registry";

async function setup() {
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:"export default {fetch(){return new Response('ok')}}",compatibilityDate:"2026-09-18",d1Databases:["DB"],cf:false}));
  const DB=await mf.getD1Database("DB");
  for(const file of readdirSync("migrations").sort()) for(const sql of readFileSync(`migrations/${file}`,"utf8").split(";").map(x=>x.trim()).filter(Boolean)) await DB.prepare(sql).run();
  return {mf,DB};
}
const candidate={source:"paju",source_candidate_id:"detail-job-1",title:"파주 행사",start_date:"2099-10-03",end_date:"2099-10-04",region:"경기",locality:"파주",venue:"파주",official_url:"https://tour.paju.go.kr/user/link/cultural/BD_index.do",category:"축제",snippet:null,image_candidate:null};
async function insertEvent(DB:D1Database,id:string) {
  await DB.prepare("INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES(?, 'municipality',2,'파주 공식 행사 안내',?,?)").bind(`municipal-source-${id}`,candidate.official_url,"2099-01-01T00:00:00.000Z").run();
  await DB.prepare("INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,cost,pet_policy,status,verification,is_sample,primary_source_id,checked_at) VALUES(?,?,'공식 행사','경기','파주','파주',? ,?,'unknown','unknown','scheduled','verified',0,?,?)").bind(id,candidate.title,candidate.start_date,candidate.end_date,`municipal-source-${id}`,"2099-01-01T00:00:00.000Z").run();
}

test("detail micro-job stages never combine fetch, parse, and persist",async()=>{
  const {mf,DB}=await setup(); try {
    await insertEvent(DB,"event-1");
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
    row=await DB.prepare("SELECT stage,created_at,expires_at FROM municipal_detail_jobs").first<any>();
    assert.equal(row.stage,"DONE");
    assert.equal(Date.parse(row.expires_at)-Date.parse(row.created_at),MUNICIPAL_DETAIL_TTL_MS);
    const duplicate=await enqueueMunicipalDetailJob(DB,{sourceKey:"paju",candidate,eventId:"event-1"});
    assert.ok(duplicate); const count=await DB.prepare("SELECT COUNT(*) count FROM municipal_detail_jobs").first<any>(); assert.equal(count.count,1);
  } finally {await mf.dispose();}
});

test("detail persistence reports a missing parent event before FK-backed writes",async()=>{
  const {mf,DB}=await setup(); try {
    await enqueueMunicipalDetailJob(DB,{sourceKey:"paju",candidate:{...candidate,source_candidate_id:"missing-parent"},eventId:"missing-event"});
    await DB.prepare("UPDATE municipal_detail_jobs SET stage='PERSIST_PENDING',normalized_json=?,available_at='2000-01-01T00:00:00.000Z'").bind(JSON.stringify({summary:"공식 상세",operating_hours:[],programs:[],price_text:null,contact_phone:null,images:[]})).run();
    assert.deepEqual(await detailPersistOne(DB),{id:(await DB.prepare("SELECT id FROM municipal_detail_jobs").first<any>()).id,stage:"RETRY"});
    assert.deepEqual(await DB.prepare("SELECT stage,safe_error_category FROM municipal_detail_jobs").first(),{stage:"RETRY",safe_error_category:"detail_event_missing"});
  } finally {await mf.dispose();}
});

test("new generic detail retains explicit official core verification without publishing",async()=>{
  const {mf,DB}=await setup(); try {
    const next={...candidate,source_candidate_id:"new-core",title:"파주 공식 행사",start_date:"2099-10-03",end_date:"2099-10-04",venue:"파주 문화회관",official_url:"https://tour.paju.go.kr/user/link/cultural/BD_view.do?idx=999"};
    await enqueueMunicipalDetailJob(DB,{sourceKey:"paju",candidate:next,eventId:"unregistered-event"});
    await detailFetchOne(DB,async()=>new Response("<h1>파주 공식 행사</h1><table><tr><th>기간</th><td>2099-10-03 ~ 2099-10-04</td></tr><tr><th>장소</th><td>파주 문화회관</td></tr></table>"));
    await detailParseOne(DB); await detailPersistOne(DB);
    const row=await DB.prepare("SELECT stage,safe_error_category,normalized_json,updated_at,expires_at FROM municipal_detail_jobs").first<any>();
    assert.equal(row.stage,"DONE"); assert.equal(row.safe_error_category,"candidate_core_verified"); assert.equal(JSON.parse(row.normalized_json).candidate_verification.status,"verified");
    assert.equal(Date.parse(row.expires_at)-Date.parse(row.updated_at),MUNICIPAL_DETAIL_VERIFICATION_RETENTION_MS);
    await cleanupExpiredMunicipalDetailJobs(DB,new Date(Date.parse(row.updated_at)+MUNICIPAL_DETAIL_TTL_MS).toISOString());
    assert.equal((await DB.prepare("SELECT COUNT(*) count FROM municipal_detail_jobs").first<any>()).count,1);
    await cleanupExpiredMunicipalDetailJobs(DB,row.expires_at);
    assert.equal((await DB.prepare("SELECT COUNT(*) count FROM municipal_detail_jobs").first<any>()).count,0);
    assert.equal((await DB.prepare("SELECT COUNT(*) count FROM events WHERE id='unregistered-event'").first<any>()).count,0);
  } finally {await mf.dispose();}
});

test("incomplete or conflicting official core stays non-public and is retained",async()=>{
  const {mf,DB}=await setup(); try {
    for (const [id,html,category] of [["insufficient","<h1>파주 공식 행사</h1>","candidate_core_insufficient"],["conflict","<h1>파주 공식 행사</h1><table><tr><th>기간</th><td>2099-10-05</td></tr><tr><th>장소</th><td>파주 문화회관</td></tr></table>","candidate_core_conflict"]] as const) {
      const next={...candidate,source_candidate_id:id,title:"파주 공식 행사",start_date:"2099-10-03",end_date:"2099-10-04",venue:"파주 문화회관",official_url:`https://tour.paju.go.kr/user/link/cultural/BD_view.do?idx=${id}`};
      await enqueueMunicipalDetailJob(DB,{sourceKey:"paju",candidate:next,eventId:`unregistered-${id}`}); await detailFetchOne(DB,async()=>new Response(html)); await detailParseOne(DB); await detailPersistOne(DB);
      const row=await DB.prepare("SELECT stage,safe_error_category,updated_at,expires_at FROM municipal_detail_jobs WHERE candidate_id=?").bind(id).first<any>();
      assert.deepEqual({stage:row.stage,safe_error_category:row.safe_error_category},{stage:"DONE",safe_error_category:category});
      assert.equal(Date.parse(row.expires_at)-Date.parse(row.updated_at),MUNICIPAL_DETAIL_VERIFICATION_RETENTION_MS);
    }
    assert.equal((await DB.prepare("SELECT COUNT(*) count FROM events WHERE id LIKE 'unregistered-%'").first<any>()).count,0);
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

test("a due detail retry resumes at fetch and an expired retry retains its safe error",async()=>{
  const {mf,DB}=await setup(); try {
    await enqueueMunicipalDetailJob(DB,{sourceKey:"paju",candidate:{...candidate,source_candidate_id:"detail-retry"},eventId:"event-retry"});
    await DB.prepare("UPDATE municipal_detail_jobs SET stage='RETRY',retry_stage='FETCH_PENDING',available_at='2000-01-01T00:00:00.000Z',safe_error_category='network_or_timeout'").run();
    assert.equal((await detailFetchOne(DB,async()=>new Response("<h2>공연</h2>")))?.stage,"PARSE_PENDING");
    await DB.prepare("UPDATE municipal_detail_jobs SET stage='RETRY',retry_stage='FETCH_PENDING',safe_error_category='network_or_timeout',expires_at='2000-01-01T00:00:00.000Z'").run();
    await cleanupExpiredMunicipalDetailJobs(DB);
    assert.deepEqual(await DB.prepare("SELECT stage,safe_error_category FROM municipal_detail_jobs").first(),
      {stage:"DONE",safe_error_category:"terminal_network_or_timeout"});
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
