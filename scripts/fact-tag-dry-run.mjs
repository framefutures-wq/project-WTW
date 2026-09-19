import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const CONFIG = "wrangler.production.jsonc";
const DB = "weekend-mwohae-production";

function query(sql) {
  const result = spawnSync(
    "npx",
    ["wrangler", "d1", "execute", DB, "--remote", "--config", CONFIG, "--command", sql, "--json"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`${result.stderr || "원격 D1 읽기 실패"}\nSQL: ${sql}`);
  const payload = JSON.parse(result.stdout);
  return payload[0]?.results ?? [];
}
function queryPaged(baseSql, pageSize = 50) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = query(`${baseSql} LIMIT ${pageSize} OFFSET ${offset}`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

const events = query(
  "SELECT e.*,s.fetched_at AS source_fetched_at,s.raw_payload AS tourapi_raw FROM events e JOIN sources s ON s.id=e.primary_source_id WHERE e.is_sample=0 AND s.kind='tourapi' ORDER BY e.id",
);
const evidence = queryPaged(
  "SELECT ev.id,ev.event_id,ev.source_id,ev.field,ev.excerpt,ev.checked_at,s.kind AS source_kind,s.name AS source_name,s.fetched_at AS source_fetched_at FROM event_evidence ev JOIN sources s ON s.id=ev.source_id WHERE ev.event_id IN (SELECT id FROM events WHERE is_sample=0) ORDER BY ev.id",
  100,
);
const audits = queryPaged(
  "SELECT id,event_id,checked_at,detail_json,baseline_json FROM official_source_audits WHERE event_id IN (SELECT id FROM events WHERE is_sample=0) ORDER BY id",
  20,
);
const links = queryPaged(
  "SELECT l.id,l.audit_id,a.event_id,l.url,l.source_types,l.checked_at,l.access_status,l.official,l.excerpt,l.title FROM official_source_links l JOIN official_source_audits a ON a.id=l.audit_id WHERE a.event_id IN (SELECT id FROM events WHERE is_sample=0) ORDER BY l.id",
  50,
);
const comparisons = queryPaged(
  "SELECT c.id,c.audit_id,a.event_id,c.field,c.result,c.tourapi_value,c.official_value,c.excerpt,c.checked_at FROM official_source_comparisons c JOIN official_source_audits a ON a.id=c.audit_id WHERE a.event_id IN (SELECT id FROM events WHERE is_sample=0) ORDER BY c.id",
  100,
);
const syncRuns = query(
  "SELECT id,provider,status,started_at,finished_at,message FROM sync_runs WHERE provider='tourapi' ORDER BY started_at DESC LIMIT 10",
);

const TAGS = {
  food: { group: "콘텐츠", rule: "content.food.v1", words: ["음식", "먹거리", "미식", "푸드트럭", "시식", "음식 판매", "먹거리장터", "푸드 존", "푸드존"] },
  fireworks: { group: "콘텐츠", rule: "content.fireworks.v1", words: ["불꽃놀이", "불꽃쇼", "불꽃축제", "불꽃"] },
  flower_garden: { group: "콘텐츠", rule: "content.flower_garden.v1", words: ["벚꽃", "국화", "장미", "튤립", "꽃 전시", "꽃축제", "꽃 축제", "정원", "가든"] },
  experience: { group: "콘텐츠", rule: "content.experience.v1", words: ["만들기", "공예", "체험", "참여 프로그램", "농촌체험", "전통체험"] },
  performance: { group: "콘텐츠", rule: "content.performance.v1", words: ["공연", "콘서트", "국악", "버스킹", "연극", "뮤지컬", "퍼포먼스", "음악회"] },
  exhibition: { group: "콘텐츠", rule: "content.exhibition.v1", words: ["전시", "작품전", "기획전", "전시회"] },
  traditional_history: { group: "콘텐츠", rule: "content.traditional_history.v1", words: ["전통문화", "문화유산", "역사", "민속", "문화재", "역사체험", "국가유산"] },
  nature_scenery: { group: "콘텐츠", rule: "content.nature_scenery.v1", words: ["자연경관", "숲", "생태", "수목원", "자연 관람", "자연체험", "경관"] },
  night_light: { group: "콘텐츠", rule: "content.night_light.v1", words: ["야간개장", "야경", "빛축제", "조명", "미디어파사드", "라이트쇼", "빛의 터널", "야간 경관"] },
  photo_spot: { group: "콘텐츠", rule: "content.photo_spot.v1", words: ["포토존", "사진 촬영 명소", "사진 콘텐츠", "포토 스팟", "포토스팟"] },
  local_specialty: { group: "콘텐츠", rule: "content.local_specialty.v1", words: ["지역특산물", "농산물", "지역상품", "전통시장", "특산품 판매", "장터"] },
  education: { group: "콘텐츠", rule: "content.education.v1", words: ["교육", "해설", "강좌", "학습", "문화해설", "교육 프로그램"] },
  sports: { group: "콘텐츠", rule: "content.sports.v1", words: ["스포츠 경기", "마라톤", "체육", "운동회", "씨름", "경연대회", "걷기대회"] },
  parade: { group: "콘텐츠", rule: "content.parade.v1", words: ["퍼레이드", "행렬", "거리행진", "거리 행진"] },
  children_program: { group: "대상/프로그램", rule: "audience.children.v1", words: ["어린이 프로그램", "어린이 공연", "어린이 체험", "어린이 놀이터", "어린이 놀이", "아동 프로그램", "유아 프로그램", "키즈존", "키즈 프로그램"] },
  family_program: { group: "대상/프로그램", rule: "audience.family.v1", words: ["가족 대상", "가족 참여", "가족 프로그램", "가족 체험", "온 가족"] },
  indoor: { group: "편의/환경", rule: "environment.indoor.v1", words: ["실내", "실내 행사", "실내 전시", "전시장"] },
  parking: { group: "편의/환경", rule: "environment.parking.v1", words: ["주차장", "주차 안내", "주차정보", "주차 정보"] },
  shuttle: { group: "편의/환경", rule: "environment.shuttle.v1", words: ["셔틀", "셔틀버스", "셔틀 버스"] },
  accessibility: { group: "편의/환경", rule: "environment.accessibility.v1", words: ["무장애", "휠체어", "장애인 접근", "엘리베이터", "장애인 편의"] },
  seated_viewing: { group: "편의/환경", rule: "environment.seated_viewing.v1", words: ["객석", "좌석", "지정석", "좌석 관람"] },
  pet_allowed: { group: "반려동물", rule: "pet.allowed.v1", words: ["반려동물 동반 가능", "반려동물 동반", "애완동물 동반 가능", "동물 동반 가능"] },
  pet_not_allowed: { group: "반려동물", rule: "pet.not_allowed.v1", words: ["반려동물 동반 불가", "반려동물 출입 금지", "반려동물 금지", "애완동물 출입 금지"] },
};

const NEGATIVE = /(없습니다|않습니다|아닙니다|불가|불가능|금지|운영하지|미운영|미제공|제공하지|종료|폐지|취소)/;
const CONDITIONAL = /(우천|날씨|기상|상황에 따라|변경될 수|취소될 수|조건부|매주|회차|일별|특정일|공휴일)/;
const ENDED = /(운영\s*종료|프로그램\s*종료|종료되었습니다|폐지)/;

function parseJson(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}
function compact(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function snippets(text, word) {
  const value = compact(text);
  const out = [];
  let from = 0;
  while (out.length < 3) {
    const index = value.indexOf(word, from);
    if (index < 0) break;
    out.push(value.slice(Math.max(0, index - 90), Math.min(value.length, index + word.length + 120)));
    from = index + word.length;
  }
  return out;
}
function scopeFor(field) {
  if (["program", "subevent", "playtime"].includes(field)) return "program_level";
  if (["title", "overview", "eventplace", "placeinfo"].includes(field)) return "event_level";
  return "scope_unknown";
}

const byEvent = new Map(events.map((e) => [e.id, []]));
function addDoc(eventId, doc) { if (byEvent.has(eventId) && doc.text) byEvent.get(eventId).push(doc); }
for (const e of events) {
  const raw = parseJson(e.tourapi_raw, {}) || {};
  addDoc(e.id, { text: e.title, field: "title", source: "tourapi", source_type: "tourapi", checked_at: e.source_fetched_at, scope: "event_level", strength: "direct_field" });
}
for (const row of evidence) addDoc(row.event_id, { text: row.excerpt, field: row.field, source: row.source_name || row.source_kind, source_type: row.source_kind, checked_at: row.checked_at || row.source_fetched_at, scope: scopeFor(row.field), strength: "direct_field" });
for (const audit of audits) {
  const detail = parseJson(audit.detail_json, {});
  const results = Array.isArray(detail?.results) ? detail.results : [];
  for (const result of results) for (const item of result.items || []) {
    for (const [field, value] of Object.entries(item)) {
      if (typeof value !== "string" || !value.trim() || !["title", "overview", "program", "subevent", "eventplace", "placeinfo", "parking", "parkinginfo", "playtime", "agelimit", "usetimefestival", "homepage"].includes(field)) continue;
      addDoc(audit.event_id, { text: value, field, source: `TourAPI ${result.endpoint}`, source_type: "tourapi", checked_at: result.checkedAt || audit.checked_at, scope: scopeFor(field), strength: "direct_field" });
    }
  }
}
for (const link of links) if (link.official === 1 && link.access_status === "ok" && link.excerpt) {
  let sourceType = "official_source";
  const types = parseJson(link.source_types, []);
  if (types.length) sourceType = types.join(",");
  addDoc(link.event_id, { text: link.excerpt, field: "official_excerpt", source: link.url, source_type: sourceType, checked_at: link.checked_at, scope: "scope_unknown", strength: "direct_text" });
}

const candidates = [];
const byEventTag = new Map();
const conflicts = [];
const conditional = [];
const ended = [];
for (const event of events) {
  const eventTags = new Map();
  for (const [tag, rule] of Object.entries(TAGS)) {
    const positives = [];
    const negatives = [];
    for (const doc of byEvent.get(event.id) || []) {
      if (doc.field === "official_excerpt" || doc.scope === "scope_unknown") continue;
      const allowedFields = {
        children_program: ["title", "program", "subevent", "overview"],
        family_program: ["title", "program", "subevent", "overview"],
        parking: ["parking", "parkinginfo", "placeinfo"],
        shuttle: ["shuttle", "parking", "parkinginfo", "program", "overview"],
        accessibility: ["accessibility", "placeinfo", "program", "overview"],
        seated_viewing: ["program", "subevent", "overview", "playtime"],
        sports: ["title", "program", "subevent", "overview"],
        pet_allowed: ["title", "program", "subevent", "overview", "pet_policy"],
        pet_not_allowed: ["title", "program", "subevent", "overview", "pet_policy"],
      }[tag];
      if (allowedFields && !allowedFields.includes(doc.field)) continue;
      for (const word of rule.words) for (const snippet of snippets(doc.text, word)) {
      const isConditional = CONDITIONAL.test(snippet);
      const isNegative = NEGATIVE.test(snippet) && !isConditional && !(tag === "pet_not_allowed" && /동반 불가|출입 금지|금지/.test(snippet));
      const isEnded = ENDED.test(snippet) && !isConditional && !/(행사명|축제명|역사|문화재)/.test(word);
      const item = { event_id: event.id, event_title: event.title, tag, rule_id: rule.rule, evidence_source: doc.source, evidence_text: snippet, source_type: doc.source_type, source_checked_at: doc.checked_at, scope: doc.scope, evidence_strength: doc.strength, conditional: isConditional };
      if (isNegative) negatives.push(item); else if (isEnded) ended.push(item); else positives.push(item);
      }
    }
    const uniquePositive = [...new Map(positives.map((p) => [`${p.evidence_source}|${p.evidence_text}`, p])).values()];
    const uniqueNegative = [...new Map(negatives.map((p) => [`${p.evidence_source}|${p.evidence_text}`, p])).values()];
    if (uniquePositive.length && uniqueNegative.length) conflicts.push({ event_id: event.id, event_title: event.title, tag, positive: uniquePositive[0], negative: uniqueNegative[0] });
    if (uniquePositive.length) {
      const chosen = uniquePositive[0];
      if (chosen.conditional) conditional.push(chosen);
      candidates.push(chosen);
      eventTags.set(tag, chosen);
    }
  }
  byEventTag.set(event.id, eventTags);
}

const uniqueCandidates = [...new Map(candidates.map((c) => [`${c.event_id}|${c.tag}`, c])).values()];
const tagCounts = Object.fromEntries(Object.keys(TAGS).map((tag) => [tag, new Set(uniqueCandidates.filter((c) => c.tag === tag).map((c) => c.event_id)).size]));
const eventCount = events.length;
const taggedEvents = [...byEventTag.values()].filter((m) => m.size > 0).length;
const distribution = { "0": 0, "1": 0, "2": 0, "3-5": 0, "6+": 0 };
for (const map of byEventTag.values()) { const n = map.size; if (n <= 2) distribution[String(n)]++; else if (n <= 5) distribution["3-5"]++; else distribution["6+"]++; }
const maxTags = Math.max(...[...byEventTag.values()].map((m) => m.size), 0);
const avgTags = eventCount ? uniqueCandidates.length / eventCount : 0;
const groupCounts = {};
for (const [tag, rule] of Object.entries(TAGS)) groupCounts[rule.group] = (groupCounts[rule.group] || 0) + tagCounts[tag];

const officialByEvent = new Map();
for (const link of links) if (link.official === 1 && link.access_status === "ok") officialByEvent.set(link.event_id, true);
const noTagReasons = { A_source_insufficient: [], B_no_matching_tag: [], C_ambiguous: [], D_extraction_issue: [], E_other: [] };
const aiCandidates = [];
for (const event of events) if (!byEventTag.get(event.id).size) {
  const docs = byEvent.get(event.id) || [];
  const contentDocs = docs.filter((d) => d.field !== "title" && d.field !== "official_excerpt" && d.scope !== "scope_unknown");
  const text = contentDocs.map((d) => d.text).join(" ");
  const hasRich = text.length >= 80 || contentDocs.length >= 2;
  const hasConflict = conflicts.some((c) => c.event_id === event.id);
  const hasPotential = Object.values(TAGS).some((rule) => rule.words.some((word) => text.includes(word)));
  if (!hasRich) noTagReasons.A_source_insufficient.push(event);
  else if (hasConflict) noTagReasons.C_ambiguous.push(event);
  else if (hasRich && hasPotential) { noTagReasons.C_ambiguous.push(event); aiCandidates.push(event); }
  else if (hasRich) noTagReasons.B_no_matching_tag.push(event);
  else noTagReasons.E_other.push(event);
}
const samples = {};
for (const tag of Object.keys(TAGS)) samples[tag] = uniqueCandidates.filter((c) => c.tag === tag).slice(0, 10);
const highTagEvents = events.filter((e) => byEventTag.get(e.id).size >= 6).map((e) => ({ event_id: e.id, title: e.title, tags: [...byEventTag.get(e.id).keys()] }));
const negatives = [...new Map([...conflicts.flatMap((c) => [c.negative]), ...ended].map((x) => [`${x.event_id}|${x.tag}|${x.evidence_text}`, x])).values()];
const dateLimitedCandidates = uniqueCandidates.filter((c) => c.scope === "program_level" && /(?:20\d{2}[./-]?\d{1,2}[./-]?\d{1,2}|\d{1,2}월\s*\d{1,2}일|매주|공휴일|특정일|일차|회차)/.test(c.evidence_text));
const latestTourapi = events.map((e) => e.source_fetched_at).sort().at(-1) || null;
const latestAudit = audits.map((a) => a.checked_at).sort().at(-1) || null;
const latestOfficialLink = links.map((l) => l.checked_at).sort().at(-1) || null;
const latestSync = syncRuns[0] || null;
const output = { generated_at: new Date().toISOString(), snapshot: { event_count: eventCount, latest_tourapi_source_fetched_at: latestTourapi, latest_official_audit_checked_at: latestAudit, latest_official_link_checked_at: latestOfficialLink, latest_tourapi_sync: latestSync }, tag_definitions: TAGS, candidates: uniqueCandidates, tag_counts: tagCounts, group_counts: groupCounts, event_distribution: distribution, tagged_events: taggedEvents, untagged_events: eventCount - taggedEvents, coverage_percent: eventCount ? taggedEvents / eventCount * 100 : 0, average_tags: avgTags, max_tags: maxTags, conflicts, conditional_programs: conditional, date_limited_program_candidates: dateLimitedCandidates, negative_or_ended: negatives, no_tag_reasons: Object.fromEntries(Object.entries(noTagReasons).map(([k, v]) => [k, { count: v.length, examples: v.slice(0, 10).map((e) => ({ event_id: e.id, title: e.title })) }])), ai_candidate_count: aiCandidates.length, ai_candidate_examples: aiCandidates.slice(0, 20).map((e) => ({ event_id: e.id, title: e.title })), high_tag_events: highTagEvents, samples, source_counts: { events: events.length, event_evidence: evidence.length, official_audits: audits.length, official_links: links.length, official_comparisons: comparisons.length }, rules_version: "fact-tags-dry-run-v1" };
mkdirSync("/tmp/wtw-fact-tag", { recursive: true });
writeFileSync("/tmp/wtw-fact-tag/report.json", JSON.stringify(output, null, 2));
writeFileSync(".wrangler/fact-tag-dry-run.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify({ ...output.snapshot, event_count: eventCount, tagged_events: taggedEvents, untagged_events: eventCount - taggedEvents, coverage_percent: output.coverage_percent, average_tags: avgTags, max_tags: maxTags, tag_counts: tagCounts, distribution, no_tag_reasons: Object.fromEntries(Object.entries(output.no_tag_reasons).map(([k, v]) => [k, v.count])), conflict_count: conflicts.length, conditional_count: conditional.length, date_limited_program_candidate_count: dateLimitedCandidates.length, negative_or_ended_count: negatives.length, ai_candidate_count: aiCandidates.length }, null, 2));
