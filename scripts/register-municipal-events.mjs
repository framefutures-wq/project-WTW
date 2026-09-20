import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { canRegisterMunicipalEvent } from "../shared/municipal-duplicate.ts";
import { lookupMunicipalDuplicate } from "./municipal-duplicate-lookup.mjs";

const DB = "weekend-mwohae-production";
const CONFIG = "wrangler.production.jsonc";
const NOW = "2026-09-20T00:00:00.000Z";
const quote = (value) => `'${String(value ?? "").replaceAll("'", "''")}'`;

// Closed MAIN-only manifest. This is a registration path, never a discovery job.
export const MUNICIPAL_EVENTS = [
  {
    id: "municipal-paju-munsan-street-2026", title: "2026년 제18회 문산거리축제", region: "경기", start_date: "2026-09-19", end_date: "2026-09-20", venue: "문산천노을길", address: "경기도 파주시 문산읍 내포리 68-1번지 일원", cost: "free", price_text: "무료", gate: "MAIN",
    source: { id: "municipal-paju-munsan-2026", name: "파주시 공식 문산거리축제 안내", url: "https://tour.paju.go.kr/user/link/cultural/BD_selectCulturalView.do?cultMstSn=940" },
    evidence: "파주시 공식 안내: 2026.9.19~20 12:00~21:00, 문산천노을길, 무료, 먹거리·체험부스·무대프로그램·청소년댄스경연대회·임진강가요제",
    summary: "문산천노을길에서 공연, 체험, 먹거리를 함께 즐기는 이틀간의 지역 거리축제입니다.",
    hours: ["12:00", "21:00"], highlights: [["먹거리 및 체험부스", "experience"], ["다양한 무대 프로그램", "performance"]], programs: [["청소년댄스경연대회", "청소년 댄스경연대회와 임진강가요제 등 무대 프로그램"]], tags: ["experience", "performance", "food"],
  },
  {
    id: "municipal-paju-simhaksan-trail-2026", title: "2026년 제11회 심학산 둘레길 축제", region: "경기", start_date: "2026-10-03", end_date: "2026-10-03", venue: "심학초등학교 운동장", address: "경기도 파주시 교하로681번길 33", cost: "free", price_text: "무료", gate: "MAIN",
    source: { id: "municipal-paju-cultural-list-2026-09", name: "파주시 공식 이달의 문화행사", url: "https://tour.paju.go.kr/user/link/cultural/BD_index.do" },
    evidence: "파주시 공식 목록: 2026.10.3 심학초등학교 운동장, 공연·체험·먹거리·농산물 판매·노래자랑",
    summary: "심학산 가을을 배경으로 공연, 체험, 먹거리와 농산물 판매를 함께 운영하는 지역 축제입니다.",
    highlights: [["공연과 체험", "experience"], ["먹거리와 농산물 판매", "food"]], programs: [], tags: ["experience", "performance", "food"],
  },
  {
    id: "municipal-suwon-hwaseong-media-art-2026", title: "2026 수원화성 미디어아트", region: "경기", start_date: "2026-09-19", end_date: "2026-10-06", venue: "화서문, 장안공원, 장안문 일원", address: "경기도 수원시 팔달구 화서문, 장안공원, 장안문 일원", cost: "unknown", price_text: null, gate: "MAIN",
    source: { id: "municipal-suwon-media-art-2026", name: "수원문화재단 공식 미디어아트 안내", url: "https://www.swcf.or.kr/?p=317" },
    evidence: "수원문화재단 공식 안내: 2026.9.19~10.6 화서문·장안공원·장안문, 축제 운영 18:00~22:00; 화서문 미디어아트 상영 19:30·20:30·21:30",
    summary: "수원화성의 화서문, 장안공원, 장안문 일원에서 열리는 야간 미디어아트 축제입니다.",
    hours: ["18:00", "22:00"], highlights: [["수원화성 미디어아트", "night_light"], ["장안공원 체험 공간", "experience"]], programs: [["화서문 미디어아트 상영", "화서문 19:30 / 20:30 / 21:30"]], tags: ["night_light", "experience", "performance"],
  },
];

function run(sql) {
  const result = spawnSync("npx", ["wrangler", "d1", "execute", DB, "--remote", "--config", CONFIG, "--json", "--command", sql], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "remote D1 command failed");
  return JSON.parse(result.stdout)[0];
}
function duplicateCheck(event) {
  return lookupMunicipalDuplicate(event, run);
}
export function buildSql() {
  const sql = [];
  for (const event of MUNICIPAL_EVENTS) {
    sql.push(`INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload) VALUES(${quote(event.source.id)},'municipality',2,${quote(event.source.name)},${quote(event.source.url)},${quote(NOW)},NULL) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,fetched_at=excluded.fetched_at;`);
    sql.push(`INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,lat,lng,cost,price_text,pet_policy,status,verification,is_sample,primary_source_id,checked_at,updated_at) VALUES(${quote(event.id)},${quote(event.title)},${quote("공식 지자체 행사 안내를 바탕으로 등록된 행사입니다.")},${quote(event.region)},${quote(event.venue)},${quote(event.address)},${quote(event.start_date)},${quote(event.end_date)},NULL,NULL,${quote(event.cost)},${event.price_text ? quote(event.price_text) : "NULL"},'unknown','scheduled','verified',0,${quote(event.source.id)},${quote(NOW)},${quote(NOW)}) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,region=excluded.region,venue=excluded.venue,address=excluded.address,start_date=excluded.start_date,end_date=excluded.end_date,cost=excluded.cost,price_text=excluded.price_text,status=excluded.status,verification=excluded.verification,primary_source_id=excluded.primary_source_id,checked_at=excluded.checked_at,updated_at=excluded.updated_at;`);
    for (const field of ["schedule", "venue", "status", ...(event.cost === "unknown" ? [] : ["price"])]) sql.push(`INSERT INTO event_evidence(event_id,source_id,field,excerpt,checked_at) VALUES(${quote(event.id)},${quote(event.source.id)},${quote(field)},${quote(event.evidence)},${quote(NOW)}) ON CONFLICT(event_id,source_id,field) DO UPDATE SET excerpt=excluded.excerpt,checked_at=excluded.checked_at;`);
    sql.push(`INSERT INTO event_enrichments(event_id,summary,source_id,evidence_excerpt,updated_at) VALUES(${quote(event.id)},${quote(event.summary)},${quote(event.source.id)},${quote(event.evidence)},${quote(NOW)}) ON CONFLICT(event_id) DO UPDATE SET summary=excluded.summary,source_id=excluded.source_id,evidence_excerpt=excluded.evidence_excerpt,updated_at=excluded.updated_at;`);
    event.highlights.forEach(([label, tag], index) => sql.push(`INSERT INTO event_highlights(event_id,label,tag,featured,sort_order,source_id,evidence_excerpt) VALUES(${quote(event.id)},${quote(label)},${quote(tag)},${index === 0 ? 1 : 0},${index + 1},${quote(event.source.id)},${quote(event.evidence)}) ON CONFLICT(event_id,sort_order) DO UPDATE SET label=excluded.label,tag=excluded.tag,featured=excluded.featured,source_id=excluded.source_id,evidence_excerpt=excluded.evidence_excerpt;`));
    if (event.hours) sql.push(`INSERT INTO event_operating_hours(id,event_id,start_date,end_date,start_time,end_time,human_time_text,sort_order,source_id,evidence_excerpt) VALUES(${quote(`${event.id}-hours`)},${quote(event.id)},${quote(event.start_date)},${quote(event.end_date)},${quote(event.hours[0])},${quote(event.hours[1])},NULL,0,${quote(event.source.id)},${quote(event.evidence)}) ON CONFLICT(event_id,start_date,end_date,sort_order) DO UPDATE SET start_time=excluded.start_time,end_time=excluded.end_time,source_id=excluded.source_id,evidence_excerpt=excluded.evidence_excerpt;`);
    event.programs.forEach(([name, schedule], index) => sql.push(`INSERT INTO event_programs(id,event_id,program_name,program_date,start_time,end_time,schedule_text,venue_name,description,featured,sort_order,source_id,evidence_excerpt,updated_at) VALUES(${quote(`${event.id}-program-${index + 1}`)},${quote(event.id)},${quote(name)},NULL,NULL,NULL,${quote(schedule)},NULL,NULL,${index === 0 ? 1 : 0},${index + 1},${quote(event.source.id)},${quote(event.evidence)},${quote(NOW)}) ON CONFLICT(id) DO UPDATE SET program_name=excluded.program_name,schedule_text=excluded.schedule_text,featured=excluded.featured,source_id=excluded.source_id,evidence_excerpt=excluded.evidence_excerpt,updated_at=excluded.updated_at;`));
    event.tags.forEach((tag) => sql.push(`INSERT INTO event_tags(event_id,tag,classifier_type,rule_version,rule_id,evidence_source_ref,evidence_field,evidence_excerpt,updated_at) VALUES(${quote(event.id)},${quote(tag)},'deterministic_rule','fact_rules_v1','municipal_official_program',${quote(event.source.id)},'program',${quote(event.evidence)},${quote(NOW)}) ON CONFLICT(event_id,tag,classifier_type,rule_version) DO UPDATE SET rule_id=excluded.rule_id,evidence_source_ref=excluded.evidence_source_ref,evidence_field=excluded.evidence_field,evidence_excerpt=excluded.evidence_excerpt,updated_at=excluded.updated_at;`));
  }
  return sql.join("\n");
}
function main() {
  const mode = process.argv[2] ?? "plan";
  if (mode === "plan") return console.log(JSON.stringify({ mode, events: MUNICIPAL_EVENTS.map(({ id, title, source, start_date, end_date, gate }) => ({ id, title, source: source.url, start_date, end_date, gate })) }, null, 2));
  if (mode !== "apply") throw new Error("usage: node scripts/register-municipal-events.mjs [plan|apply]");
  const checks = MUNICIPAL_EVENTS.map((event) => ({ event, ...duplicateCheck(event) }));
  for (const { event, decision } of checks) assert.ok(canRegisterMunicipalEvent(event.gate, decision, event.id), `registration blocked: ${event.id}=${decision}`);
  const write = run(buildSql()).meta;
  const ids = MUNICIPAL_EVENTS.map((event) => quote(event.id)).join(",");
  const verify = run(`SELECT id,title FROM events WHERE id IN (${ids}) ORDER BY id`);
  assert.equal(verify.results.length, MUNICIPAL_EVENTS.length, "municipal insert verification failed");
  console.log(JSON.stringify({ mode, decisions: checks.map(({ event, decision }) => ({ id: event.id, decision })), rows_read: checks.reduce((total, item) => total + (item.exact.meta.rows_read ?? 0) + (item.nearby.meta.rows_read ?? 0), 0) + (verify.meta.rows_read ?? 0), rows_written: write.rows_written ?? 0 }, null, 2));
}
if (process.argv[1]?.endsWith("register-municipal-events.mjs")) main();
