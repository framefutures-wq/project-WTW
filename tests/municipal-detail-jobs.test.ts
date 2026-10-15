import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { cleanupExpiredMunicipalDetailJobs, detailFetchOne, detailParseOne, detailPersistOne, enqueueMunicipalDetailJob, fetchMunicipalDetailTransport, MUNICIPAL_DETAIL_RAW_HTML_MAX_BYTES, MUNICIPAL_DETAIL_TTL_MS, MUNICIPAL_DETAIL_VERIFICATION_RETENTION_MS, verifyBusanDongguCandidateCore, verifyPohangCandidateCore } from "../worker/sources/municipal-detail-jobs";
import { runVerifiedGenericMunicipalPublicationOne } from "../worker/sources/municipal";
import { municipalSourceByKey } from "../shared/municipal-source-registry";
import type { MunicipalCandidate } from "../shared/municipal-discovery";

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
async function insertCandidateState(DB:D1Database,eventId:string,value:MunicipalCandidate,at:string,decision="AUTO_RETRY",reason="test") {
  await DB.prepare("INSERT INTO municipal_candidate_state(candidate_id,source_key,first_seen_at,last_seen_at,decision_state,decision_reason,retry_until,last_payload_hash,source_candidate_id,title_snapshot,start_date_snapshot,end_date_snapshot,venue_snapshot,locality_snapshot,official_url_snapshot) VALUES(?,?,?,?,?,?,NULL,'test-hash',?,?,?,?,?,?,?)")
    .bind(eventId,value.source,at,at,decision,reason,value.source_candidate_id,value.title,value.start_date,value.end_date,value.venue,value.locality,value.official_url).run();
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

test("Pohang new candidates verify exact official performance and festival API cores", async()=>{
  const performance={source:"gyeongbuk-포항",source_candidate_id:"EVT_20260831_002",title:"뮤지컬 <마리 퀴리>",start_date:"2026-12-11",end_date:"2026-12-12",region:"경북",locality:"포항",venue:"포항문화예술회관",official_url:"https://www.phcf.or.kr/phcf/performance_detail/view.do?eventId=EVT_20260831_002&menu_site_id=performance_detail",category:"공연",snippet:null,image_candidate:null} satisfies MunicipalCandidate;
  const festival={source:"gyeongbuk-포항",source_candidate_id:"FST_STEEL_2026_001",title:"2026 포항스틸아트페스티벌",start_date:"2026-10-24",end_date:"2026-11-15",region:"경북",locality:"포항",venue:"동빈문화창고1969",official_url:"https://www.phcf.or.kr/phcf/festival_detail/view.do?festivalId=FST_STEEL_2026_001",category:"축제",snippet:null,image_candidate:null} satisfies MunicipalCandidate;
  const performanceBody=readFileSync("fixtures/municipal-pohang-performance-detail.json","utf8");
  const festivalBody=readFileSync("fixtures/municipal-pohang-festival-detail.json","utf8");
  assert.deepEqual(verifyPohangCandidateCore(performance,performanceBody),{status:"verified",title:true,schedule:true,venue:true});
  assert.deepEqual(verifyPohangCandidateCore(festival,festivalBody),{status:"verified",title:true,schedule:true,venue:true});
  assert.equal(verifyPohangCandidateCore({...performance,title:"다른 공연"},performanceBody).status,"conflict");
  assert.equal(verifyPohangCandidateCore({...performance,start_date:"2026-12-10"},performanceBody).status,"conflict");
  assert.equal(verifyPohangCandidateCore({...performance,venue:"다른 장소"},performanceBody).status,"conflict");
  assert.equal(verifyPohangCandidateCore({...festival,source_candidate_id:"FST_OTHER_001"},festivalBody).status,"insufficient");
  assert.equal(verifyPohangCandidateCore(performance,performanceBody.replace("ONGOING","CANCELLED")).status,"conflict");
});

test("Busan Dong-gu verifies core facts only from one gallery detail article",()=>{
  const candidate={source:"busan-동",source_candidate_id:"5091365",title:"《재수의 연습장 : 재수 좋은 날》",start_date:"2026-06-20",end_date:"2026-10-25",region:"부산",locality:"동구",venue:"동구 문화플랫폼 시민마당 전시장",official_url:"https://www.bsdonggu.go.kr/board/view.donggu?dataSid=5091365",category:"공연·전시",snippet:null,image_candidate:null} satisfies MunicipalCandidate;
  const fixture=readFileSync("fixtures/municipal-busan-dong-detail.html","utf8");
  assert.deepEqual(verifyBusanDongguCandidateCore(candidate,fixture),{status:"verified",title:true,schedule:true,venue:true});
  assert.deepEqual(verifyBusanDongguCandidateCore({...candidate,title:"다른 전시"},fixture),{status:"conflict",title:false,schedule:true,venue:true});
  assert.deepEqual(verifyBusanDongguCandidateCore({...candidate,start_date:"2026-06-21"},fixture),{status:"conflict",title:true,schedule:false,venue:true});
  assert.deepEqual(verifyBusanDongguCandidateCore({...candidate,end_date:"2026-10-24"},fixture),{status:"conflict",title:true,schedule:false,venue:true});
  assert.deepEqual(verifyBusanDongguCandidateCore({...candidate,venue:"다른 전시장"},fixture),{status:"conflict",title:true,schedule:true,venue:false});
  assert.deepEqual(verifyBusanDongguCandidateCore(candidate,fixture.replace("<li class=\"info_tit\">장소</li><li>동구 문화플랫폼 시민마당 전시장</li>","")),{status:"insufficient",title:true,schedule:true,venue:false});
  const crossed=`<article class="cultrue_gallery_view"><h1 class="view_tit">${candidate.title}</h1><ul class="view_info"><li class="info_tit">기간</li><li>${candidate.start_date} ~ ${candidate.end_date}</li></ul></article><article class="cultrue_gallery_view"><ul class="view_info"><li class="info_tit">장소</li><li>${candidate.venue}</li></ul></article>`;
  assert.deepEqual(verifyBusanDongguCandidateCore(candidate,crossed),{status:"insufficient",title:true,schedule:true,venue:false});
});

test("Pohang new detail checkpoints fetch only their official API and retain failed verification",async()=>{
  const {mf,DB}=await setup(); try {
    const candidates=[
      [{source:"gyeongbuk-포항",source_candidate_id:"EVT_20260831_002",title:"뮤지컬 <마리 퀴리>",start_date:"2026-12-11",end_date:"2026-12-12",region:"경북",locality:"포항",venue:"포항문화예술회관",official_url:"https://www.phcf.or.kr/phcf/performance_detail/view.do?eventId=EVT_20260831_002&menu_site_id=performance_detail",category:"공연",snippet:null,image_candidate:null},"fixtures/municipal-pohang-performance-detail.json","/api/phcf/performance/getPerformanceDetail.do?eventId=EVT_20260831_002"],
      [{source:"gyeongbuk-포항",source_candidate_id:"FST_STEEL_2026_001",title:"2026 포항스틸아트페스티벌",start_date:"2026-10-24",end_date:"2026-11-15",region:"경북",locality:"포항",venue:"동빈문화창고1969",official_url:"https://www.phcf.or.kr/phcf/festival_detail/view.do?festivalId=FST_STEEL_2026_001",category:"축제",snippet:null,image_candidate:null},"fixtures/municipal-pohang-festival-detail.json","/api/template/festival/getSliderDetail.do?PRJ_ID=phcf&FESTIVAL_ID=FST_STEEL_2026_001"],
    ] as const;
    for (const [value,fixture,path] of candidates) {
      await enqueueMunicipalDetailJob(DB,{sourceKey:"gyeongbuk-포항",candidate:value,eventId:`new-${value.source_candidate_id}`});
      let requested="";
      await detailFetchOne(DB,async url=>{requested=String(url);return new Response(readFileSync(fixture,"utf8"));});
      assert.equal(new URL(requested).pathname+new URL(requested).search,path);
      await detailParseOne(DB); await detailPersistOne(DB);
      assert.deepEqual(await DB.prepare("SELECT stage,safe_error_category FROM municipal_detail_jobs WHERE candidate_id=?").bind(value.source_candidate_id).first(),{stage:"DONE",safe_error_category:"candidate_core_verified"});
      const checkpoint=JSON.parse((await DB.prepare("SELECT normalized_json FROM municipal_detail_jobs WHERE candidate_id=?").bind(value.source_candidate_id).first<any>()).normalized_json);
      assert.equal(checkpoint.candidate_snapshot.official_url,value.official_url);
    }
    const failed={...candidates[0][0],source_candidate_id:"EVT_20260831_999",official_url:"https://www.phcf.or.kr/phcf/performance_detail/view.do?eventId=EVT_20260831_999&menu_site_id=performance_detail"};
    await enqueueMunicipalDetailJob(DB,{sourceKey:"gyeongbuk-포항",candidate:failed,eventId:"new-conflict"});
    await detailFetchOne(DB,async()=>new Response(readFileSync("fixtures/municipal-pohang-performance-detail.json","utf8")));
    await detailParseOne(DB); await detailPersistOne(DB);
    assert.deepEqual(await DB.prepare("SELECT stage,safe_error_category FROM municipal_detail_jobs WHERE candidate_id=?").bind(failed.source_candidate_id).first(),{stage:"DONE",safe_error_category:"candidate_core_conflict"});
  } finally {await mf.dispose();}
});

test("only the matched pre-cutoff Pohang verification conflict is reactivated once",async()=>{
  const {mf,DB}=await setup(); try {
    const legacy={source:"gyeongbuk-포항",source_candidate_id:"EVT_20260831_002",title:"뮤지컬 <마리 퀴리>",start_date:"2026-12-11",end_date:"2026-12-12",region:"경북",locality:"포항",venue:"포항문화예술회관",official_url:"https://www.phcf.or.kr/phcf/performance_detail/view.do?eventId=EVT_20260831_002&menu_site_id=performance_detail",category:"공연",snippet:null,image_candidate:null} satisfies MunicipalCandidate;
    const old="2026-10-15T06:13:01.379Z", cutoff="2026-10-15T06:13:01.380Z";
    const prepare=async(id:string,value={...legacy,source_candidate_id:id,official_url:legacy.official_url.replace("EVT_20260831_002",id)},decision="AUTO_RETRY",reason="official_core_not_verified")=>{
      await enqueueMunicipalDetailJob(DB,{sourceKey:value.source,candidate:value,eventId:id});
      await insertCandidateState(DB,id,value,old,decision,reason);
      await DB.prepare("UPDATE municipal_detail_jobs SET stage='DONE',safe_error_category='candidate_core_conflict',updated_at=?,attempt_count=0,expires_at='2099-01-01T00:00:00.000Z' WHERE event_id=?").bind(old,id).run();
      return value;
    };

    const reactivationCandidate=await prepare("pohang-reactivate");
    await enqueueMunicipalDetailJob(DB,{sourceKey:reactivationCandidate.source,candidate:reactivationCandidate,eventId:"pohang-reactivate"});
    const reactivated=await DB.prepare("SELECT stage,safe_error_category,attempt_count,normalized_json FROM municipal_detail_jobs WHERE event_id='pohang-reactivate'").first<any>();
    assert.deepEqual(reactivated,{stage:"FETCH_PENDING",safe_error_category:null,attempt_count:1,normalized_json:null});
    await enqueueMunicipalDetailJob(DB,{sourceKey:reactivationCandidate.source,candidate:reactivationCandidate,eventId:"pohang-reactivate"});
    assert.deepEqual(await DB.prepare("SELECT stage,attempt_count FROM municipal_detail_jobs WHERE event_id='pohang-reactivate'").first(),{stage:"FETCH_PENDING",attempt_count:1});

    const newFailureCandidate=await prepare("pohang-new-failure");
    await DB.prepare("UPDATE municipal_detail_jobs SET updated_at=? WHERE event_id='pohang-new-failure'").bind(cutoff).run();
    await enqueueMunicipalDetailJob(DB,{sourceKey:newFailureCandidate.source,candidate:newFailureCandidate,eventId:"pohang-new-failure"});
    assert.deepEqual(await DB.prepare("SELECT stage,attempt_count FROM municipal_detail_jobs WHERE event_id='pohang-new-failure'").first(),{stage:"DONE",attempt_count:0});

    const mismatchCandidate=await prepare("pohang-state-mismatch");
    await DB.prepare("UPDATE municipal_candidate_state SET title_snapshot='changed' WHERE candidate_id='pohang-state-mismatch'").run();
    await enqueueMunicipalDetailJob(DB,{sourceKey:mismatchCandidate.source,candidate:mismatchCandidate,eventId:"pohang-state-mismatch"});
    assert.deepEqual(await DB.prepare("SELECT stage,attempt_count FROM municipal_detail_jobs WHERE event_id='pohang-state-mismatch'").first(),{stage:"DONE",attempt_count:0});

    const publicCandidate=await prepare("pohang-public");
    await insertEvent(DB,"pohang-public");
    await enqueueMunicipalDetailJob(DB,{sourceKey:publicCandidate.source,candidate:publicCandidate,eventId:"pohang-public"});
    assert.deepEqual(await DB.prepare("SELECT stage,attempt_count FROM municipal_detail_jobs WHERE event_id='pohang-public'").first(),{stage:"DONE",attempt_count:0});

    const pastCandidate=await prepare("pohang-past",{...legacy,source_candidate_id:"pohang-past",official_url:legacy.official_url.replace("EVT_20260831_002","pohang-past"),start_date:"2025-10-11",end_date:"2025-10-12"});
    await enqueueMunicipalDetailJob(DB,{sourceKey:pastCandidate.source,candidate:pastCandidate,eventId:"pohang-past"});
    assert.deepEqual(await DB.prepare("SELECT stage,attempt_count FROM municipal_detail_jobs WHERE event_id='pohang-past'").first(),{stage:"DONE",attempt_count:0});

    const other={...candidate,source_candidate_id:"old-conflict",title:"파주 공식 행사",start_date:"2099-10-03",end_date:"2099-10-04",venue:"파주 문화회관",official_url:"https://tour.paju.go.kr/user/link/cultural/BD_view.do?idx=old-conflict"};
    await prepare("paju-unchanged",other);
    await enqueueMunicipalDetailJob(DB,{sourceKey:other.source,candidate:other,eventId:"paju-unchanged"});
    assert.deepEqual(await DB.prepare("SELECT stage,attempt_count FROM municipal_detail_jobs WHERE event_id='paju-unchanged'").first(),{stage:"DONE",attempt_count:0});
  } finally {await mf.dispose();}
});

test("one verified generic checkpoint publishes once, rechecks gates, and recovers safely",async()=>{
  const {mf,DB}=await setup(); try {
    const at=new Date(Date.now()+60_000).toISOString();
    const env={DB,APP_MODE:"production",TOUR_API_ENABLED:"false",ASSETS:{}} as any;
    const verified={...candidate,source_candidate_id:"verified-register",title:"파주 공식 문화축제",start_date:"2099-10-03",end_date:"2099-10-04",venue:"파주 문화회관",official_url:"https://tour.paju.go.kr/user/link/cultural/BD_view.do?idx=verified",snippet:"파주 시민과 방문객을 위한 공식 문화축제 행사입니다."};
    await enqueueMunicipalDetailJob(DB,{sourceKey:"paju",candidate:verified,eventId:"municipal-paju-verified-register"});
    await insertCandidateState(DB,"municipal-paju-verified-register",verified,at);
    await detailFetchOne(DB,async()=>new Response("<h1>파주 공식 문화축제</h1><table><tr><th>기간</th><td>2099-10-03 ~ 2099-10-04</td></tr><tr><th>장소</th><td>파주 문화회관</td></tr></table>")); await detailParseOne(DB); await detailPersistOne(DB);
    await DB.prepare("UPDATE municipal_detail_jobs SET available_at=? WHERE candidate_id='verified-register'").bind(at).run();
    assert.deepEqual(await runVerifiedGenericMunicipalPublicationOne(env,at),{id:(await DB.prepare("SELECT id FROM municipal_detail_jobs WHERE candidate_id=?").bind("verified-register").first<any>()).id,stage:"AUTO_PUBLISH"});
    assert.equal((await DB.prepare("SELECT COUNT(*) count FROM events WHERE id='municipal-paju-verified-register'").first<any>()).count,1);
    assert.equal((await DB.prepare("SELECT COUNT(*) count FROM alert_events WHERE event_id='municipal-paju-verified-register'").first<any>()).count,1);
    assert.equal((await DB.prepare("SELECT COUNT(*) count FROM event_evidence WHERE event_id='municipal-paju-verified-register'").first<any>()).count,3);
    assert.equal(await runVerifiedGenericMunicipalPublicationOne(env,new Date(Date.parse(at)+60_000).toISOString()),null);
    assert.equal((await DB.prepare("SELECT COUNT(*) count FROM events WHERE id='municipal-paju-verified-register'").first<any>()).count,1);
    // Simulate a crash after the idempotent event batch but before checkpoint
    // terminalization: replay must not add event, alert, or evidence rows.
    await DB.prepare("UPDATE municipal_detail_jobs SET safe_error_category='candidate_core_verified',available_at=? WHERE candidate_id='verified-register'").bind(at).run();
    assert.equal((await runVerifiedGenericMunicipalPublicationOne(env,at))?.stage,"AUTO_PUBLISH");
    assert.equal((await DB.prepare("SELECT COUNT(*) count FROM events WHERE id='municipal-paju-verified-register'").first<any>()).count,1);
    assert.equal((await DB.prepare("SELECT COUNT(*) count FROM alert_events WHERE event_id='municipal-paju-verified-register'").first<any>()).count,1);
    assert.equal((await DB.prepare("SELECT COUNT(*) count FROM event_evidence WHERE event_id='municipal-paju-verified-register'").first<any>()).count,3);

    for (const [id,override,stage,stateOverride] of [
      ["expired",{start_date:"2020-01-01",end_date:"2020-01-01"},"EXPIRED",{}],
      ["stale-state",{},"HOLD",{venue:"파주 이전 문화회관"}],
    ] as const) {
      const next={...verified,source_candidate_id:id,...override};
      await enqueueMunicipalDetailJob(DB,{sourceKey:"paju",candidate:next,eventId:`municipal-paju-${id}`});
      await insertCandidateState(DB,`municipal-paju-${id}`,{...next,...stateOverride},at);
      const job=await DB.prepare("SELECT id,normalized_json FROM municipal_detail_jobs WHERE candidate_id=?").bind(id).first<any>();
      const checkpoint=JSON.parse((await DB.prepare("SELECT normalized_json FROM municipal_detail_jobs WHERE candidate_id='verified-register'").first<any>()).normalized_json);
      checkpoint.candidate_snapshot={...checkpoint.candidate_snapshot,...override};
      await DB.prepare("UPDATE municipal_detail_jobs SET stage='DONE',safe_error_category='candidate_core_verified',normalized_json=?,available_at=?,expires_at=? WHERE id=?").bind(JSON.stringify(checkpoint),at,new Date(Date.parse(at)+86400_000).toISOString(),job.id).run();
      assert.equal((await runVerifiedGenericMunicipalPublicationOne(env,at))?.stage,stage);
      assert.equal((await DB.prepare("SELECT COUNT(*) count FROM events WHERE id=?").bind(`municipal-paju-${id}`).first<any>()).count,0);
    }

    await DB.prepare("INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES('duplicate-source','municipality',2,'duplicate',?,?)").bind(verified.official_url,at).run();
    await DB.prepare("INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,cost,pet_policy,status,verification,is_sample,primary_source_id,checked_at) VALUES('external-duplicate',?,'official','경기',? ,?, ?,?,'unknown','unknown','scheduled','verified',0,'duplicate-source',?)").bind(verified.title,verified.venue,verified.venue,verified.start_date,verified.end_date,at).run();
    await enqueueMunicipalDetailJob(DB,{sourceKey:"paju",candidate:{...verified,source_candidate_id:"duplicate"},eventId:"municipal-paju-duplicate"});
    await insertCandidateState(DB,"municipal-paju-duplicate",{...verified,source_candidate_id:"duplicate"},at);
    const duplicateJob=await DB.prepare("SELECT id FROM municipal_detail_jobs WHERE candidate_id='duplicate'").first<any>();
    const duplicateCheckpoint=JSON.parse((await DB.prepare("SELECT normalized_json FROM municipal_detail_jobs WHERE candidate_id='verified-register'").first<any>()).normalized_json);
    await DB.prepare("UPDATE municipal_detail_jobs SET stage='DONE',safe_error_category='candidate_core_verified',normalized_json=?,available_at=?,expires_at=? WHERE id=?").bind(JSON.stringify(duplicateCheckpoint),at,new Date(Date.parse(at)+86400_000).toISOString(),duplicateJob.id).run();
    assert.equal((await runVerifiedGenericMunicipalPublicationOne(env,at))?.stage,"AUTO_EXCLUDE");
    assert.equal((await DB.prepare("SELECT COUNT(*) count FROM events WHERE id='municipal-paju-duplicate'").first<any>()).count,0);

    // The durable KST-day cap includes prior generic registrations and a
    // crash-safe municipal-event fallback. A cap retry must become eligible
    // again after its bounded backoff instead of becoming terminal.
    for (let index=0; index<9; index+=1) {
      const id=`municipal-paju-prior-${index}`;
      await DB.prepare("INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES(?, 'municipality',2,'prior',?,?)").bind(`municipal-source-prior-${index}`,verified.official_url,at).run();
      await DB.prepare("INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,cost,pet_policy,status,verification,is_sample,primary_source_id,checked_at,created_at) VALUES(?,?,'official','경기',? ,?, ?,?,'unknown','unknown','scheduled','verified',0,?,?,?)").bind(id,`prior-${index}`,verified.venue,verified.venue,verified.start_date,verified.end_date,`municipal-source-prior-${index}`,at,at).run();
    }
    const capped={...verified,source_candidate_id:"capped-retry",title:"파주 발행 제한 재시도 행사",official_url:"https://tour.paju.go.kr/user/link/cultural/BD_view.do?idx=capped"};
    await enqueueMunicipalDetailJob(DB,{sourceKey:"paju",candidate:capped,eventId:"municipal-paju-capped-retry"});
    await insertCandidateState(DB,"municipal-paju-capped-retry",capped,at);
    const cappedJob=await DB.prepare("SELECT id FROM municipal_detail_jobs WHERE candidate_id='capped-retry'").first<any>();
    const cappedCheckpoint=JSON.parse((await DB.prepare("SELECT normalized_json FROM municipal_detail_jobs WHERE candidate_id='verified-register'").first<any>()).normalized_json);
    cappedCheckpoint.candidate_snapshot={...cappedCheckpoint.candidate_snapshot,title:capped.title,official_url:capped.official_url};
    await DB.prepare("UPDATE municipal_detail_jobs SET stage='DONE',safe_error_category='candidate_core_verified',normalized_json=?,available_at=?,expires_at=? WHERE id=?").bind(JSON.stringify(cappedCheckpoint),at,new Date(Date.parse(at)+86400_000).toISOString(),cappedJob.id).run();
    assert.equal((await runVerifiedGenericMunicipalPublicationOne(env,at))?.stage,"AUTO_RETRY");
    const retry=await DB.prepare("SELECT safe_error_category,available_at,retry_at FROM municipal_detail_jobs WHERE id=?").bind(cappedJob.id).first<any>();
    assert.equal(retry.safe_error_category,"candidate_registration_retry");
    assert.ok(Date.parse(retry.available_at)>Date.parse(at));
    assert.equal(retry.available_at,retry.retry_at);
    await DB.prepare("UPDATE events SET created_at='2000-01-01T00:00:00.000Z' WHERE id LIKE 'municipal-paju-prior-%'").run();
    assert.equal((await runVerifiedGenericMunicipalPublicationOne(env,retry.available_at))?.stage,"AUTO_PUBLISH");
    assert.equal((await DB.prepare("SELECT COUNT(*) count FROM events WHERE id='municipal-paju-capped-retry'").first<any>()).count,1);
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
