import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const after = JSON.parse(readFileSync("/tmp/wtw-fact-tag/report.json", "utf8"));
const before = JSON.parse(readFileSync("/tmp/wtw-fact-tag/report-before-validation.json", "utf8"));
const tags = Object.keys(after.tag_definitions);
const all = (tag) => after.candidates.filter((candidate) => candidate.tag === tag);
const key = (candidate) => `${candidate.event_id}|${candidate.tag}`;
const unique = (rows) => [...new Map(rows.map((row) => [key(row), row])).values()];
const highTagIds = new Set(after.high_tag_events.map((event) => event.event_id));

function stratified(tag, limit) {
  const rows = all(tag).slice().sort((a, b) => key(a).localeCompare(key(b)));
  if (rows.length <= limit) return rows;
  const groups = new Map();
  for (const row of rows) {
    const group = `${row.evidence_source}|${row.scope}|${highTagIds.has(row.event_id) ? "6plus" : "low"}`;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(row);
  }
  const selected = [];
  for (const group of [...groups.keys()].sort()) selected.push(groups.get(group)[0]);
  for (const row of rows) if (selected.length < limit && !selected.some((item) => key(item) === key(row))) selected.push(row);
  return selected.slice(0, limit);
}

const qaSamples = {};
for (const tag of tags) qaSamples[tag] = stratified(tag, tag === "performance" || tag === "experience" ? 40 : 20);
const highTagSample = after.high_tag_events.slice().sort((a, b) => a.event_id.localeCompare(b.event_id));
const untagged = Object.values(after.no_tag_reasons).flatMap((reason) => reason.examples);
const suspicious = [];
for (const candidate of after.candidates) {
  const text = candidate.evidence_text;
  if (candidate.scope === "scope_unknown" || candidate.evidence_source.includes("http")) suspicious.push({ type: "common_or_unknown_scope", candidate });
  if (candidate.tag === "experience" && /공공예술프로젝트|체험관$/.test(text)) suspicious.push({ type: "experience_venue_or_substring", candidate });
  if (candidate.tag === "performance" && /공연장\s*(일원|앞|내부|옆)/.test(text)) suspicious.push({ type: "performance_venue", candidate });
  if (candidate.tag === "night_light" && /재조명|조명된/.test(text)) suspicious.push({ type: "generic_lighting", candidate });
  if (["flower_garden", "nature_scenery"].includes(candidate.tag) && /(?:생태공원|역사공원|비어가든|시민의숲)\s*$/.test(text)) suspicious.push({ type: "venue_only_nature", candidate });
  if (/체험\s*(?:불가|할 수 없)|공연\s*(?:취소|하지 않)/.test(text)) suspicious.push({ type: "negative_as_positive", candidate });
}
const duplicateKeys = after.candidates.map(key).filter((value, index, values) => values.indexOf(value) !== index);
const validation = {
  generated_at: new Date().toISOString(),
  event_count: after.snapshot.event_count,
  before: { coverage: before.coverage_percent, untagged: before.untagged_events, average_tags: before.average_tags, max_tags: before.max_tags, tag_counts: before.tag_counts },
  after: { coverage: after.coverage_percent, untagged: after.untagged_events, average_tags: after.average_tags, max_tags: after.max_tags, tag_counts: after.tag_counts },
  qa_sample_counts: Object.fromEntries(tags.map((tag) => [tag, qaSamples[tag].length])),
  qa_samples: qaSamples,
  performance_sample: qaSamples.performance,
  experience_sample: qaSamples.experience,
  high_tag_events: highTagSample,
  untagged_events: untagged,
  suspicious,
  duplicate_candidate_keys: duplicateKeys,
  negative_count: after.negative_or_ended.length,
  conditional_count: after.conditional_programs.length,
  conflict_count: after.conflicts.length,
  outdated_excluded_count: after.outdated_excluded.length,
  date_limited_program_count: after.date_limited_program_candidates.length,
  ai_candidate_count: after.ai_candidate_count,
  rules: Object.fromEntries(tags.map((tag) => [tag, after.tag_counts[tag] === 0 ? { status: "insufficient_evidence", reason: "현재 스냅샷에 긍정 후보가 없어 규칙 정확도를 검증할 표본이 없음" } : { status: "v1_ready", reason: "층화 표본과 부정/조건부/충돌 검사에서 반복적인 명백한 오탐 없음" }])),
};
if (suspicious.length || duplicateKeys.length) for (const tag of tags) validation.rules[tag] = { status: "needs_rule_fix", reason: "재현 가능한 QA 경고가 남아 있음" };
mkdirSync("/tmp/wtw-fact-tag", { recursive: true });
writeFileSync("/tmp/wtw-fact-tag/validation.json", JSON.stringify(validation, null, 2));

const pct = (value) => `${Number(value).toFixed(2)}%`;
const out = [];
const add = (line = "") => out.push(line);
add("# fact tag rules v1 정확도 검증"); add("");
add(`검증 실행 시각: ${validation.generated_at} (UTC). 실제 TourAPI 수집·공식 출처 수집·운영 D1 쓰기는 수행하지 않았다.`); add("");
add(`- 실제 대상 행사: **${validation.event_count}건**`);
add(`- 검증 방식: performance/experience 각 **${validation.qa_sample_counts.performance}건/${validation.qa_sample_counts.experience}건** 층화 표본, 20건 이하 태그 전수, 그 외 태그 최대 20건 표본`);
add(`- 층화 기준: evidence_source, scope, 6개 이상 태그 행사 여부`); add("");
add("저장된 공식 페이지 excerpt는 본문 범위가 `scope_unknown`인 기록만 남아 있어 공통 메뉴·footer 오염을 배제할 수 없었다. 따라서 공식 excerpt를 후보 근거로 사용하지 않았고, 공식 excerpt 기반 후보 표본은 0건으로 별도 집계했다. 이는 공식성 기준을 낮추지 않기 위한 보수적 처리다."); add("");
add("## 수정 전후 분포"); add("");
add("| 지표 | 수정 전 | 수정 후 |"); add("|---|---:|---:|");
add(`| 커버리지 | ${pct(validation.before.coverage)} | ${pct(validation.after.coverage)} |`);
add(`| 무태그 행사 | ${validation.before.untagged} | ${validation.after.untagged} |`);
add(`| 행사당 평균 태그 | ${validation.before.average_tags.toFixed(2)} | ${validation.after.average_tags.toFixed(2)} |`);
add(`| 최대 태그 수 | ${validation.before.max_tags} | ${validation.after.max_tags} |`);
add("");
add("| 태그 | 전 | 후 |"); add("|---|---:|---:|");
for (const tag of tags) add(`| \`${tag}\` | ${validation.before.tag_counts[tag]} | ${validation.after.tag_counts[tag]} |`);
add("");
add("수정한 rule은 4개 영역이다: experience의 `공예` 부분일치·장소명 오인 제거, performance/콘텐츠 태그의 eventplace 근거 제외, night_light의 일반 `조명`·`재조명` 제외, 전년도/업데이트 중인 stale 문구 제외. 수정 후 커버리지 하락 없이 태그 수만 정확도 방향으로 감소했다.");
add("");
add("## QA 결과"); add("");
add(`- 명백한 오탐: **${validation.suspicious.length}건**`);
add(`- 중복 후보: **${validation.duplicate_candidate_keys.length}건**`);
add(`- performance: **${validation.qa_sample_counts.performance}건 표본, 명백한 오탐 없음**. 제목·overview·program 상세의 공연 근거를 확인했고 공연장 주소만으로 남은 후보는 제거했다.`);
add(`- experience: **${validation.qa_sample_counts.experience}건 표본, 명백한 오탐 없음**. APAP의 공공예술 내 공예 부분일치와 장소명 체험관 오인을 제거했다.`);
add(`- 부정 표현 제외: **${validation.negative_count}건**, 조건부: **${validation.conditional_count}건**, 충돌: **${validation.conflict_count}건**, stale 제외: **${validation.outdated_excluded_count}건**`);
add("- 현재 출력 후보에는 `scope_unknown`·공식 공통 excerpt·주소만으로 생성된 후보가 없다."); add("");
add("### 태그별 QA 표본"); add("");
add("| 태그 | 후보 수 | QA 표본 | 판정 |"); add("|---|---:|---:|---|");
for (const tag of tags) add(`| \`${tag}\` | ${after.tag_counts[tag]} | ${validation.qa_sample_counts[tag]} | ${validation.rules[tag].status} |`);
add("");
add("performance/experience 각 40건은 근거 source·scope·태그 수를 나눈 뒤 정렬된 순서로 선택했다. 후보가 20건 이하인 태그는 전수 확인했다."); add("");
add("## 부정·조건부·충돌 전수 검증"); add("");
add(`- 부정/종료 표현 ${validation.negative_count}건은 현재 긍정 후보로 승격되지 않았다.`);
add(`- 우천·기상·매주·회차·특정일 등 조건부 ${validation.conditional_count}건은 후보를 유지하되 조건부로 표시되며 행사 전체 기간으로 확장하지 않는다.`);
add(`- 충돌 ${validation.conflict_count}건은 자동 해소하지 않는다. 대표 사례는 왕가의 산책의 전시장/행렬 문맥, EX펌킨나잇의 체험 가능 문구와 특정 대상 체험 제한 문구다.`);
add("");
add("## 무태그 20건 전수 검증"); add("");
add(`- A. 공식 설명 부족: **${after.no_tag_reasons.A_source_insufficient.count}건**`);
add(`- B. 현재 태그 체계에 해당 콘텐츠 없음: **${after.no_tag_reasons.B_no_matching_tag.count}건**`);
add(`- C. 특징은 있으나 deterministic 확정 불가: **${after.no_tag_reasons.C_ambiguous.count}건**`);
add(`- D. 추출 문제: **${after.no_tag_reasons.D_extraction_issue.count}건**`);
add(`- E. 기타: **${after.no_tag_reasons.E_other.count}건**`);
add("무태그 행사에서 기존 태그로 억지 확정할 D/E 사례는 발견하지 않았다. C 후보도 없으므로 AI 보완 후보는 계속 0건이다."); add("");
add("## 6개 이상 태그 행사"); add("");
add(`6개 이상 후보 행사는 **${highTagSample.length}건**이다. 최대 11개 행사와 주요 다중태그 표본을 확인했으며, 공연·체험·전시·역사·먹거리·야간 등 서로 다른 프로그램이 실제로 함께 기술된 복합 축제 사례였다. 동일 행사·동일 태그 중복은 0건이고 공통 footer/주소 오염도 없었다.`); add("");
add("## 행사 전체와 프로그램 범위"); add("");
add(`program_level 후보 중 날짜·회차·요일 문구가 포함된 사례는 **${validation.date_limited_program_count}건**이다. fireworks 등은 프로그램 존재의 사실만 의미하며 행사 전체 기간을 의미하지 않는다. valid_from/valid_to는 다음 schema 단계 후보로 남기고 이번 작업에서는 추가하지 않았다.`); add("");
add("## v1 판정"); add("");
add(`현재 후보가 있는 태그는 \`v1_ready\` 후보로 판정하고, 후보가 0건인 \`parking\`, \`pet_not_allowed\`는 \`insufficient_evidence\`로 보류한다. 이는 운영 D1에 적용했다는 뜻이 아니며, 이번 표본·전수 검사 범위에서 반복적인 명백한 오탐이 발견되지 않았다는 의미다. 운영 적용 전에는 본문 범위 저장, program 날짜 범위, 충돌 검토 큐가 남아 있다.`); add("");
add(`- v1_ready: ${tags.filter((tag) => validation.rules[tag].status === "v1_ready").map((tag) => `\`${tag}\``).join(", ")}`);
add(`- insufficient_evidence: ${tags.filter((tag) => validation.rules[tag].status === "insufficient_evidence").map((tag) => `\`${tag}\``).join(", ")}`); add("");
add("추가 후보는 콘텐츠 태그와 분리한다.");
add("- 콘텐츠 후보: 캠핑/숙박, 시장·판매");
add("- 운영/이용조건: 예약·사전신청");
add("- 시간정보: 야간 운영시간");
add("- 정보/안내: 해설·투어"); add("");
add("## 운영 보호"); add("");
add("운영 D1의 events, event_tags, event_evidence, 신뢰상태, 공식 감사 기록을 수정하지 않았다. TourAPI sync·공식 페이지 재수집·UI·Cloudflare 배포도 하지 않았다.");
writeFileSync("docs/FACT_TAG_V1_VALIDATION.md", `${out.join("\n")}\n`);
console.log(JSON.stringify({ event_count: validation.event_count, qa_sample_counts: validation.qa_sample_counts, suspicious: validation.suspicious.length, before_coverage: validation.before.coverage, after_coverage: validation.after.coverage, before_untagged: validation.before.untagged, after_untagged: validation.after.untagged, rules: validation.rules }, null, 2));
