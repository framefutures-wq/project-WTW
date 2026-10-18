export const FACT_RULE_VERSION = "fact_rules_v1" as const;
export const FACT_CLASSIFIER = "deterministic_rule" as const;

export const FACT_TAG_RULES = {
  food: { group: "콘텐츠", rule: "content.food.v1", words: ["음식", "먹거리", "미식", "푸드트럭", "시식", "음식 판매", "먹거리장터", "푸드 존", "푸드존"] },
  fireworks: { group: "콘텐츠", rule: "content.fireworks.v1", words: ["불꽃놀이", "불꽃쇼", "불꽃축제", "불꽃"] },
  flower_garden: { group: "콘텐츠", rule: "content.flower_garden.v1", words: ["벚꽃", "국화", "장미", "튤립", "꽃 전시", "꽃축제", "꽃 축제", "정원", "가든"] },
  experience: { group: "콘텐츠", rule: "content.experience.v1", words: ["만들기", "공예체험", "공예 프로그램", "공예품", "체험", "참여 프로그램", "농촌체험", "전통체험"] },
  performance: { group: "콘텐츠", rule: "content.performance.v1", words: ["공연", "콘서트", "국악", "버스킹", "연극", "뮤지컬", "퍼포먼스", "음악회"] },
  exhibition: { group: "콘텐츠", rule: "content.exhibition.v1", words: ["전시", "작품전", "기획전", "전시회"] },
  traditional_history: { group: "콘텐츠", rule: "content.traditional_history.v1", words: ["전통문화", "문화유산", "역사", "민속", "문화재", "역사체험", "국가유산"] },
  nature_scenery: { group: "콘텐츠", rule: "content.nature_scenery.v1", words: ["자연경관", "숲", "생태", "수목원", "자연 관람", "자연체험", "경관"] },
  night_light: { group: "콘텐츠", rule: "content.night_light.v1", words: ["야간개장", "야경", "빛축제", "경관조명", "조명 콘텐츠", "조명 연출", "야간 조명", "미디어파사드", "라이트쇼", "빛의 터널", "야간 경관"] },
  photo_spot: { group: "콘텐츠", rule: "content.photo_spot.v1", words: ["포토존", "사진 촬영 명소", "사진 콘텐츠", "포토 스팟", "포토스팟"] },
  local_specialty: { group: "콘텐츠", rule: "content.local_specialty.v1", words: ["지역특산물", "농산물", "지역상품", "전통시장", "특산품 판매", "장터"] },
  education: { group: "콘텐츠", rule: "content.education.v1", words: ["교육", "해설", "강좌", "학습", "문화해설", "교육 프로그램"] },
  sports: { group: "콘텐츠", rule: "content.sports.v1", words: ["스포츠 경기", "마라톤", "체육", "운동회", "씨름", "경연대회", "걷기대회"] },
  parade: { group: "콘텐츠", rule: "content.parade.v1", words: ["퍼레이드", "행렬", "거리행진", "거리 행진"] },
  children_program: { group: "대상/프로그램", rule: "audience.children.v1", words: ["어린이 프로그램", "어린이 공연", "어린이 체험", "어린이 놀이터", "어린이 놀이", "아동 프로그램", "유아 프로그램", "키즈존", "키즈 프로그램"] },
  family_program: { group: "대상/프로그램", rule: "audience.family.v1", words: ["가족 대상", "가족 참여", "가족 프로그램", "가족 체험", "온 가족"] },
  indoor: { group: "편의/환경", rule: "environment.indoor.v1", words: ["실내", "실내 행사", "실내 전시", "전시장"] },
  shuttle: { group: "편의/환경", rule: "environment.shuttle.v1", words: ["셔틀", "셔틀버스", "셔틀 버스"] },
  accessibility: { group: "편의/환경", rule: "environment.accessibility.v1", words: ["무장애", "휠체어", "장애인 접근", "엘리베이터", "장애인 편의"] },
  seated_viewing: { group: "편의/환경", rule: "environment.seated_viewing.v1", words: ["객석", "좌석", "지정석", "좌석 관람"] },
  pet_allowed: { group: "반려동물", rule: "pet.allowed.v1", words: ["반려동물 동반 가능", "반려동물 동반", "애완동물 동반 가능", "동물 동반 가능"] },
} as const;
export const FACT_TAGS = Object.keys(FACT_TAG_RULES) as Array<keyof typeof FACT_TAG_RULES>;
export type FactTag = keyof typeof FACT_TAG_RULES;
export type FactDocument = { text: string; field: string; source: string; source_type?: string; checked_at?: string | null; scope?: string; strength?: string };
export type FactCandidate = FactDocument & { event_id: string; event_title: string; tag: FactTag; rule_id: string; evidence_text: string; evidence_source: string; scope: string; evidence_strength: string; conditional: boolean };

const NEGATIVE = /(없습니다|않습니다|아닙니다|불가|불가능|금지|운영하지|미운영|미제공|제공하지|종료|폐지|취소)/;
const CONDITIONAL = /(우천|날씨|기상|상황에 따라|변경될 수|취소될 수|조건부|매주|회차|일별|특정일|공휴일)/;
const ENDED = /(운영\s*종료|프로그램\s*종료|종료되었습니다|폐지)/;
const OUTDATED = /(전년도|2025년.*(?:내용|정보).*2026년.*(?:업데이트|미정)|2026년.*(?:업데이트 중|업데이트중))/;
const allowedFields: Record<FactTag, string[]> = {
  food: ["title", "program", "subevent", "overview"], fireworks: ["title", "program", "subevent", "overview"], flower_garden: ["title", "program", "subevent", "overview"], experience: ["title", "program", "subevent", "overview"], performance: ["title", "program", "subevent", "overview"], exhibition: ["title", "program", "subevent", "overview"], traditional_history: ["title", "program", "subevent", "overview"], nature_scenery: ["title", "program", "subevent", "overview"], night_light: ["title", "program", "subevent", "overview"], photo_spot: ["title", "program", "subevent", "overview"], local_specialty: ["title", "program", "subevent", "overview"], education: ["title", "program", "subevent", "overview"], sports: ["title", "program", "subevent", "overview"], parade: ["title", "program", "subevent", "overview"], children_program: ["title", "program", "subevent", "overview"], family_program: ["title", "program", "subevent", "overview"], indoor: ["title", "overview", "program", "subevent", "eventplace", "placeinfo", "playtime", "usetimefestival", "agelimit"], shuttle: ["title", "program", "subevent", "overview"], accessibility: ["title", "program", "subevent", "overview"], seated_viewing: ["title", "program", "subevent", "overview"], pet_allowed: ["title", "program", "subevent", "overview", "pet_policy"],
};
function snippets(text: string, word: string) { const value = text.replace(/\s+/g, " ").trim(); const out: string[] = []; let from = 0; while (out.length < 3) { const i = value.indexOf(word, from); if (i < 0) break; out.push(value.slice(Math.max(0, i - 90), Math.min(value.length, i + word.length + 120))); from = i + word.length; } return out; }

export function classifyFactTags(event: { id: string; title: string }, documents: FactDocument[]) {
  const candidates: FactCandidate[] = [], conflicts: Array<{ tag: FactTag; positive: FactCandidate; negative: FactCandidate }> = [], conditional: FactCandidate[] = [], outdated: FactCandidate[] = [], negativeOrEnded: FactCandidate[] = [];
  const tags = new Map<FactTag, FactCandidate>();
  for (const tag of FACT_TAGS) {
    const rule = FACT_TAG_RULES[tag]; const positives: FactCandidate[] = [], negatives: FactCandidate[] = [];
    for (const doc of documents) {
      if (doc.field === "official_excerpt" || doc.scope === "scope_unknown" || !allowedFields[tag].includes(doc.field)) continue;
      for (const word of rule.words) for (const evidence_text of snippets(doc.text, word)) {
        const isConditional = CONDITIONAL.test(evidence_text);
        const base = { ...doc, event_id: event.id, event_title: event.title, tag, rule_id: rule.rule, evidence_text, evidence_source: doc.source, scope: doc.scope || "scope_unknown", evidence_strength: doc.strength || "direct_field", conditional: isConditional } as FactCandidate;
        if (OUTDATED.test(evidence_text)) { outdated.push(base); continue; }
        const isNegative = NEGATIVE.test(evidence_text) && !isConditional && !(tag === "pet_allowed" && /동반 가능/.test(evidence_text));
        const isEnded = ENDED.test(evidence_text) && !isConditional && !/(행사명|축제명|역사|문화재)/.test(word);
        if (isNegative || isEnded) { negatives.push(base); negativeOrEnded.push(base); } else positives.push(base);
      }
    }
    const positive = [...new Map(positives.map((p) => [`${p.evidence_source}|${p.evidence_text}`, p])).values()];
    const negative = [...new Map(negatives.map((p) => [`${p.evidence_source}|${p.evidence_text}`, p])).values()];
    if (positive.length && negative.length) conflicts.push({ tag, positive: positive[0], negative: negative[0] });
    if (positive.length) { tags.set(tag, positive[0]); candidates.push(positive[0]); if (positive[0].conditional) conditional.push(positive[0]); }
  }
  return { tags, candidates: [...new Map(candidates.map((c) => [`${c.event_id}|${c.tag}`, c])).values()], conflicts, conditional, outdated, negativeOrEnded };
}
