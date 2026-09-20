import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const DB = "weekend-mwohae-production";
const CONFIG = "wrangler.production.jsonc";
const NOW = "2026-09-20T00:00:00.000Z";
const quote = (value) => `'${String(value ?? "").replaceAll("'", "''")}'`;

// This is deliberately a closed, reviewed set. Do not turn it into a discovery
// or backfill script: production reads and writes must remain event-ID bounded.
export const SELECTED_EVENTS = [
  {
    id: "tourapi-2786391", title: "광안리 M(Marvelous) 드론 라이트쇼", type: "주말 드론 공연",
    source: { id: "official-gwangalli-drone-september-2026", kind: "organizer", priority: 1, name: "광안리 M 드론라이트쇼 공식 9월 프로그램", url: "https://www.gwangallimdrone.co.kr/notice/gwanganri-m-deuronraiteusyo-9weol-gongyeon-peurogeuraem-annae" },
    summary: "광안리해변에서 매주 토요일 열리는 드론 라이트쇼입니다. 계절별 공연 시간과 주간 테마는 공식 공지로 안내됩니다.",
    evidence: "공식 2026년 9월 프로그램: 9월 매주 토요일 공연, 기상·통신 상황에 따라 취소 또는 지연 가능",
    highlights: [["드론 라이트쇼", "performance", 1], ["야간 드론 연출", "night_light", 0]],
    programs: [{ id: "gwangalli-2026-steampunk", name: "스팀펑크", description: "9월 정기 드론 라이트쇼 테마", featured: 1, occurrences: [["2026-09-27", "20:00", null, "광안리 해변", "9월 27일 1부 공연"], ["2026-09-27", "22:00", null, "광안리 해변", "9월 27일 2부 공연"]], tags: ["performance", "night_light"] }],
    factTags: ["performance", "night_light"],
  },
  {
    id: "tourapi-2987489", title: "2026 고흥 녹동항 드론쇼", type: "지역 대표 야간 공연",
    source: { id: "official-nokdong-drone-2026", kind: "organizer", priority: 1, name: "2026 고흥 녹동항 드론쇼 공식 누리집", url: "https://nokdongdrone.co.kr/overview/" },
    summary: "고흥 녹동바다정원에서 매주 토요일 밤 열리는 드론쇼입니다. 매달 마지막 주 금요일에는 고흥군민광장에서 별도 공연이 열립니다.",
    evidence: "공식 공연개요: 4~10월 매주 토요일 21시 녹동항 바다정원, 매달 마지막 주 금요일 21시 고흥군민광장",
    highlights: [["900대 드론쇼", "performance", 1], ["녹동항 야간 공연", "night_light", 0]],
    programs: [{ id: "nokdong-2026-regular-drone", name: "정기 드론쇼", description: "녹동바다정원에서 진행하는 토요일 드론쇼", featured: 1, occurrences: [["2026-09-26", "21:00", null, "녹동항 바다정원", "9월 26일 토요일 공연"], ["2026-10-03", "21:00", null, "녹동항 바다정원", "10월 3일 토요일 공연"], ["2026-10-10", "21:00", null, "녹동항 바다정원", "10월 10일 토요일 공연"], ["2026-10-17", "21:00", null, "녹동항 바다정원", "10월 17일 토요일 공연"], ["2026-10-24", "21:00", null, "녹동항 바다정원", "10월 24일 토요일 공연"], ["2026-10-31", "21:00", null, "녹동항 바다정원", "10월 31일 토요일 공연"]], tags: ["performance", "night_light"] }, { id: "nokdong-2026-county-square", name: "고흥군민광장 드론쇼", description: "매달 마지막 주 금요일에 열리는 별도 드론쇼", featured: 0, occurrences: [["2026-09-25", "21:00", null, "고흥군민광장(고흥군청 앞)", "9월 마지막 주 금요일 공연"], ["2026-10-30", "21:00", null, "고흥군민광장(고흥군청 앞)", "10월 마지막 주 금요일 공연"]], tags: ["performance", "night_light"] }],
    factTags: ["performance", "night_light"],
  },
  {
    id: "tourapi-2657619", title: "2026 화성행궁 야간개장", type: "시즌 야간 문화행사",
    source: { id: "official-hwaseong-night-2026", kind: "municipality", priority: 2, name: "수원시 팔달구 공식 안내", url: "https://paldal.suwon.go.kr/bbsplus/view.asp?bd_gubn=15&code=tbl_bbs_sub200510&menuid=sub200510&no=MTk5NjEg&page=1" },
    summary: "화성행궁 일원에서 문화유산과 연계한 야간 전시 콘텐츠를 운영하는 시즌 행사입니다.",
    evidence: "수원시 공식 안내: 2026.5.1~11.1 매주 금~일요일·공휴일 18:00~21:30, 화성행궁 문화유산 연계 야간 전시콘텐츠 운영",
    hours: [["2026-09-20", "18:00", "21:30", "일요일 야간개장"], ["2026-09-25", "18:00", "21:30", "금요일 야간개장"], ["2026-09-26", "18:00", "21:30", "토요일 야간개장"], ["2026-09-27", "18:00", "21:30", "일요일 야간개장"], ["2026-10-02", "18:00", "21:30", "금요일 야간개장"], ["2026-10-03", "18:00", "21:30", "토요일 야간개장"], ["2026-10-04", "18:00", "21:30", "일요일 야간개장"], ["2026-10-09", "18:00", "21:30", "금요일 야간개장"], ["2026-10-10", "18:00", "21:30", "토요일 야간개장"], ["2026-10-11", "18:00", "21:30", "일요일 야간개장"]],
    highlights: [["문화유산 연계 야간 전시", "night_light", 1]],
    programs: [{ id: "hwaseong-2026-night-exhibition", name: "문화유산 연계 야간 전시 콘텐츠", description: "화성행궁 일원에서 운영", featured: 1, occurrences: [], tags: ["night_light"] }],
    factTags: ["night_light"],
  },
  {
    id: "tourapi-292961", title: "서울 왕궁수문장 교대의식", type: "전통문화 재현 행사",
    source: { id: "official-royalguard-2026", kind: "organizer", priority: 1, name: "왕궁수문장교대의식 공식 안내", url: "https://www.royalguard.kr/content/royalguard" },
    summary: "덕수궁 대한문 앞에서 조선시대 수문장과 수문군의 근무 교대 모습을 재현하는 전통문화 행사입니다.",
    evidence: "공식 안내: 월요일 제외 연중, 교대의식 11:00·14:00, 수위의식 10:00~15:30, 덕수궁 대한문; 기상 상황 등에 따라 취소 가능",
    highlights: [["왕궁수문장 교대의식", "performance", 1], ["순라의식", "parade", 0]],
    programs: [{ id: "royalguard-2026-change", name: "교대의식", description: "수문장과 수문군의 근무 교대를 재현", schedule_text: "월요일 제외 매일 · 오전 11:00 / 오후 2:00", venue: "덕수궁 대한문", featured: 1, occurrences: [["2026-09-20", "11:00", "11:30", "덕수궁 대한문", "월요일 제외 매일 1회"], ["2026-09-20", "14:00", "14:30", "덕수궁 대한문", "월요일 제외 매일 2회"]], tags: ["performance"] }, { id: "royalguard-2026-guard", name: "수위의식", description: "교대의식 전후 대한문 수위의식", schedule_text: "월요일 제외 매일 · 오전 10:00 ~ 오후 3:30", venue: "덕수궁 대한문", featured: 0, occurrences: [["2026-09-20", "10:00", "15:30", "덕수궁 대한문", "월요일 제외" ]], tags: ["performance"] }, { id: "royalguard-2026-patrol", name: "순라의식", description: "교대 뒤 궁궐과 도성 내외를 순찰", schedule_text: "오후 3:00 ~ 오후 4:00 · 화·목 남대문시장 / 수·금·토·일 의정부 터", featured: 0, occurrences: [["2026-09-20", "15:00", "16:00", null, "화·목 남대문시장 / 수·금·토·일 의정부 터"]], tags: ["parade"] }],
    factTags: ["performance", "parade", "traditional_history"],
  },
  {
    id: "tourapi-3107059", title: "2026 숭례문 파수의식", type: "전통문화 재현 행사",
    source: { id: "official-sungnyemun-guard-2026", kind: "organizer", priority: 1, name: "숭례문 파수의식 공식 일정", url: "https://royalguard.kr/content/sungnyemun_process" },
    summary: "숭례문 광장에서 조선시대 파수군의 근무와 교대 모습을 재현하는 전통문화 행사입니다.",
    evidence: "공식 일정: 월요일 제외 10:00~15:40, 12:00~13:00 휴식; 개문의식 10:00·폐문의식 15:30, 기상 상황 등에 따라 취소 가능",
    highlights: [["숭례문 파수의식", "performance", 1], ["개폐문의식", "performance", 0]],
    programs: [{ id: "sungnyemun-2026-opening", name: "숭례문 개문의식", description: "숭례문을 여는 의식", schedule_text: "월요일 제외 매일 · 오전 10:00 ~ 오전 10:10", venue: "숭례문 광장", featured: 1, occurrences: [["2026-09-20", "10:00", "10:10", "숭례문 광장", "월요일 제외 매일"]], tags: ["performance"] }, { id: "sungnyemun-2026-guard", name: "파수의식", description: "숭례문을 수위하는 파수의식", schedule_text: "월요일 제외 매일 · 오전 10:10 ~ 오후 12:00 / 오후 1:00 ~ 오후 3:30", venue: "숭례문 광장", featured: 0, occurrences: [["2026-09-20", "10:10", "12:00", "숭례문 광장", "12:00~13:00 휴식"], ["2026-09-20", "13:00", "15:30", "숭례문 광장", "월요일 제외 매일"]], tags: ["performance"] }, { id: "sungnyemun-2026-closing", name: "숭례문 폐문의식", description: "숭례문을 닫는 의식", schedule_text: "월요일 제외 매일 · 오후 3:30 ~ 오후 3:40", venue: "숭례문 광장", featured: 0, occurrences: [["2026-09-20", "15:30", "15:40", "숭례문 광장", "월요일 제외 매일"]], tags: ["performance"] }],
    factTags: ["performance", "traditional_history"],
  },
];

function sourceSql(event) {
  const s = event.source;
  return `INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload) VALUES(${quote(s.id)},${quote(s.kind)},${s.priority},${quote(s.name)},${quote(s.url)},${quote(NOW)},NULL) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,priority=excluded.priority,name=excluded.name,url=excluded.url,fetched_at=excluded.fetched_at;`;
}
export function buildSql() {
  const statements = [];
  for (const event of SELECTED_EVENTS) {
    statements.push(sourceSql(event));
    statements.push(`INSERT INTO event_enrichments(event_id,summary,source_id,evidence_excerpt,updated_at) VALUES(${quote(event.id)},${quote(event.summary)},${quote(event.source.id)},${quote(event.evidence)},${quote(NOW)}) ON CONFLICT(event_id) DO UPDATE SET summary=excluded.summary,source_id=excluded.source_id,evidence_excerpt=excluded.evidence_excerpt,updated_at=excluded.updated_at;`);
    event.highlights.forEach(([label, tag, featured], index) => statements.push(`INSERT INTO event_highlights(event_id,label,tag,featured,sort_order,source_id,evidence_excerpt) VALUES(${quote(event.id)},${quote(label)},${quote(tag)},${featured},${index + 1},${quote(event.source.id)},${quote(event.evidence)}) ON CONFLICT(event_id,sort_order) DO UPDATE SET label=excluded.label,tag=excluded.tag,featured=excluded.featured,source_id=excluded.source_id,evidence_excerpt=excluded.evidence_excerpt;`));
    (event.hours ?? []).forEach(([date, start, end, text]) => statements.push(`INSERT INTO event_operating_hours(id,event_id,start_date,end_date,start_time,end_time,human_time_text,sort_order,source_id,evidence_excerpt) VALUES(${quote(`${event.id}-hours-${date}`)},${quote(event.id)},${quote(date)},${quote(date)},${quote(start)},${quote(end)},${quote(text)},0,${quote(event.source.id)},${quote(event.evidence)}) ON CONFLICT(event_id,start_date,end_date,sort_order) DO UPDATE SET start_time=excluded.start_time,end_time=excluded.end_time,human_time_text=excluded.human_time_text,source_id=excluded.source_id,evidence_excerpt=excluded.evidence_excerpt;`));
    event.programs.forEach((program, index) => {
      statements.push(`INSERT INTO event_programs(id,event_id,program_name,program_date,start_time,end_time,schedule_text,venue_name,description,featured,sort_order,source_id,evidence_excerpt,updated_at) VALUES(${quote(program.id)},${quote(event.id)},${quote(program.name)},NULL,NULL,NULL,${program.schedule_text ? quote(program.schedule_text) : "NULL"},${program.venue ? quote(program.venue) : "NULL"},${quote(program.description)},${program.featured ? 1 : 0},${index + 1},${quote(event.source.id)},${quote(event.evidence)},${quote(NOW)}) ON CONFLICT(id) DO UPDATE SET program_name=excluded.program_name,schedule_text=excluded.schedule_text,venue_name=excluded.venue_name,description=excluded.description,featured=excluded.featured,sort_order=excluded.sort_order,source_id=excluded.source_id,evidence_excerpt=excluded.evidence_excerpt,updated_at=excluded.updated_at;`);
      program.occurrences.forEach(([date, start, end, venue, text], occurrenceIndex) => statements.push(`INSERT INTO event_program_occurrences(id,program_id,start_date,end_date,start_time,end_time,human_time_text,venue_name,source_id,evidence_excerpt,sort_order) VALUES(${quote(`${program.id}-${occurrenceIndex + 1}`)},${quote(program.id)},${quote(date)},${quote(date)},${quote(start)},${end ? quote(end) : "NULL"},${quote(text)},${venue ? quote(venue) : "NULL"},${quote(event.source.id)},${quote(event.evidence)},${occurrenceIndex + 1}) ON CONFLICT(program_id,sort_order) DO UPDATE SET start_date=excluded.start_date,end_date=excluded.end_date,start_time=excluded.start_time,end_time=excluded.end_time,human_time_text=excluded.human_time_text,venue_name=excluded.venue_name,source_id=excluded.source_id,evidence_excerpt=excluded.evidence_excerpt,updated_at=${quote(NOW)};`));
      program.tags.forEach((tag) => statements.push(`INSERT OR IGNORE INTO event_program_tags(program_id,tag) VALUES(${quote(program.id)},${quote(tag)});`));
    });
    event.factTags.forEach((tag) => statements.push(`INSERT INTO event_tags(event_id,tag,classifier_type,rule_version,rule_id,evidence_source_ref,evidence_field,evidence_excerpt,updated_at) VALUES(${quote(event.id)},${quote(tag)},'deterministic_rule','fact_rules_v1','official_enrichment_program',${quote(event.source.id)},'program',${quote(event.evidence)},${quote(NOW)}) ON CONFLICT(event_id,tag,classifier_type,rule_version) DO UPDATE SET rule_id=excluded.rule_id,evidence_source_ref=excluded.evidence_source_ref,evidence_field=excluded.evidence_field,evidence_excerpt=excluded.evidence_excerpt,updated_at=excluded.updated_at;`));
  }
  return statements.join("\n");
}
function run(sql) {
  const result = spawnSync("npx", ["wrangler", "d1", "execute", DB, "--remote", "--config", CONFIG, "--json", "--command", sql], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "remote D1 command failed");
  return JSON.parse(result.stdout)[0];
}
function verifyEventIdentity() {
  const ids = SELECTED_EVENTS.map((event) => quote(event.id)).join(",");
  const result = run(`SELECT id,title,start_date,end_date,venue FROM events WHERE id IN (${ids}) ORDER BY id`);
  assert.equal(result.results.length, SELECTED_EVENTS.length, "one or more selected events are absent from production");
  for (const event of SELECTED_EVENTS) assert.equal(result.results.find((row) => row.id === event.id)?.title, event.title, `title mismatch for ${event.id}`);
  return result.meta;
}
function main() {
  const mode = process.argv[2] ?? "plan";
  if (mode === "plan") return console.log(JSON.stringify({ mode, events: SELECTED_EVENTS.map(({ id, title, type, source }) => ({ id, title, type, source: source.url })), statement_count: buildSql().split("\n").length }, null, 2));
  if (mode !== "apply") throw new Error("usage: node scripts/enrich-selected-events.mjs [plan|apply]");
  const readMeta = verifyEventIdentity();
  const writeMeta = run(buildSql()).meta;
  const ids = SELECTED_EVENTS.map((event) => quote(event.id)).join(",");
  const verification = run(`SELECT e.id,(SELECT count(*) FROM event_enrichments x WHERE x.event_id=e.id) AS enrichments,(SELECT count(*) FROM event_highlights h WHERE h.event_id=e.id) AS highlights,(SELECT count(*) FROM event_programs p WHERE p.event_id=e.id) AS programs,(SELECT count(*) FROM event_program_occurrences o JOIN event_programs p ON p.id=o.program_id WHERE p.event_id=e.id) AS occurrences,(SELECT count(*) FROM event_operating_hours h WHERE h.event_id=e.id) AS operating_hours FROM events e WHERE e.id IN (${ids}) ORDER BY e.id`);
  assert.ok(verification.results.every((row) => row.enrichments === 1 && row.highlights > 0 && row.programs > 0), "enrichment verification failed");
  console.log(JSON.stringify({ mode, event_ids: SELECTED_EVENTS.map((event) => event.id), rows_read: (readMeta.rows_read ?? 0) + (verification.meta.rows_read ?? 0), rows_written: writeMeta.rows_written ?? 0, verification: verification.results }, null, 2));
}
if (process.argv[1]?.endsWith("enrich-selected-events.mjs")) main();
