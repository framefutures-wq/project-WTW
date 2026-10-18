# Fact-tag v1 운영 일치성 감사

감사 실행: 2026-09-19 UTC
범위: 원격 D1 읽기, 기존 dry-run 산출물 비교, 규칙 구현 비교. TourAPI 동기화·공식 출처 재수집·D1 쓰기·schema 변경·배포는 수행하지 않았다.

## 결론

현재 운영 `event_tags` 결과는 현재의 `fact_rules_v1` 공통 deterministic 엔진과 정확히 일치한다. 운영 verify에서 dry-run 후보 1,081행과 실제 1,081행이 일치했고 `missing=0`, `extra=0`, `duplicate=0`, `orphan=0`, `invalid=0`이었다.

사용자가 비교 대상으로 제시한 이전 수치는 최종 QA 문서의 **수정 전** 수치다. 해당 산출물과 현재 산출물의 snapshot 메타데이터는 다음처럼 완전히 같다.

| 항목 | 이전 QA 산출물 | 현재 산출물 |
|---|---|---|
| 행사 수 | 263 | 263 |
| TourAPI source 최신 시각 | 2026-09-18T21:00:18.624Z | 2026-09-18T21:00:18.624Z |
| 공식 감사 최신 시각 | 2026-09-19T03:40:46.778Z | 2026-09-19T03:40:46.778Z |
| 공식 링크 최신 시각 | 2026-09-19T03:52:35.445Z | 2026-09-19T03:52:35.445Z |
| TourAPI sync | `55b7a9d6-c189-45de-8448-caef5bdd1bf9` | 동일 |

따라서 이번 차이는 A(후속 데이터 변경)나 B(서로 다른 snapshot)가 아니다. 이전 QA의 수정 전 inline 규칙과, QA 후 운영화된 공통 규칙 사이의 **의도된 정확도 보정**이다. 현재 validation dry-run과 운영 classifier 사이에는 C/D에 해당하는 구현 차이나 unintended rule drift가 없다. 과거 수정 전 baseline과 현재 사이에는 구현 차이가 있었지만, 그 변경은 QA에서 기록하고 승인한 규칙 보정이다.

## 요청된 count 차이의 event diff

아래는 이전 QA `report-before-validation.json`과 현재 공통 엔진 `report.json`을 `event_id|tag`로 비교한 결과다. 추가된 후보는 없고, 모두 이전 후보에서 제거된 행이다.

### `experience`: 193 → 192 (−1)

| event_id | 행사 | 이전 근거 | 제거 이유 |
|---|---|---|---|
| `tourapi-3113265` | APAP 작품투어 (안양공공예술프로젝트) | 제목의 `공예` 부분일치, `content.experience.v1` | `공예` 일반 부분일치를 제거하고 `공예체험`·`공예 프로그램`·`공예품`처럼 행사 참여/콘텐츠를 직접 나타내는 표현만 허용 |

이는 장소명이나 본문 공통영역이 바뀐 것이 아니라, APAP 제목의 `공공예술` 문맥을 체험으로 오인하지 않도록 한 QA 규칙 수정이다.

### `food`: 102 → 98 (−4)

| event_id | 행사 | 이전 근거 | 제거 이유 |
|---|---|---|---|
| `tourapi-293084` | 영동난계국악축제 | TourAPI detailCommon2의 전년도 먹거리 문구 | `전년도` 및 `2026년 업데이트 중` 문구를 현재 사실 근거로 사용하지 않도록 stale 후보 제외 |
| `tourapi-506690` | 안성맞춤 남사당 바우덕이축제 | TourAPI detailCommon2의 전년도 먹거리 문구 | 동일 |
| `tourapi-506766` | 영주 풍기인삼축제 | TourAPI detailCommon2의 전년도 먹거리 문구 | 동일 |
| `tourapi-506926` | 진주남강유등축제 | TourAPI detailCommon2의 전년도 먹거리 문구 | 동일 |

네 행사 모두 현재 snapshot의 TourAPI 본문에 과거 연도/업데이트 중임이 명시되어 있었다. 현재 운영 엔진은 해당 문장을 `outdated`로 기록하고 positive tag로 저장하지 않는다.

### `traditional_history`: 95 → 93 (−2)

| event_id | 행사 | 이전 근거 | 제거 이유 |
|---|---|---|---|
| `tourapi-4103259` | 2026 DMZ PEACE FESTA | TourAPI detailIntro2의 `역사공원` | 장소·시설 필드만으로 콘텐츠 태그를 만들지 않도록 `eventplace`/`placeinfo`를 역사 규칙의 허용 필드에서 제외 |
| `tourapi-506838` | 전주한지문화축제 | TourAPI detailIntro2의 `한국전통문화전당` | 행사 프로그램/설명 근거가 아닌 장소명만으로 `traditional_history`를 만들지 않도록 제외 |

두 건은 행사 자체의 전통·역사 프로그램이 변경된 사례가 아니라, 장소명에 포함된 단어를 행사 콘텐츠로 오인한 이전 후보였다.

## 전체 diff 확인

요청된 세 태그 외에도 이전 수정 전 baseline 대비 다음 의도된 제거가 있다.

| 태그 | 이전 | 현재 | 제거 수 | 보정 |
|---|---:|---:|---:|---|
| `flower_garden` | 31 | 28 | 3 | 장소명만으로 꽃·정원 태그를 만들지 않음 |
| `nature_scenery` | 61 | 59 | 2 | 장소명만으로 자연·경관 태그를 만들지 않음 |
| `night_light` | 41 | 28 | 13 | 일반 `조명`·`재조명` 표현을 야간 콘텐츠로 확정하지 않음 |

그 밖의 태그는 event 집합과 후보 집합이 동일했다. 이전·현재 후보 event ID의 합집합은 각각 255개이며, 두 산출물 모두 나머지 8개 행사를 무태그로 집계했다. 역사 산출물은 무태그 전체 ID manifest를 저장하지 않고 유형별 최대 10개 예시만 저장했으므로, 8개 무태그 ID 각각의 독립적인 역사 diff는 artifact만으로 복원할 수 없다. 다만 두 산출물의 sync/audit 시각과 행사 수가 완전히 같고, 현재 D1의 전체 행사 수·현재 dry-run·운영 행이 모두 일치해 snapshot 변경으로 볼 근거는 없다. 향후에는 재현성을 위해 dry-run에 전체 `event_id` manifest를 저장해야 한다.

## 구현 일치성

- 검증 dry-run: `scripts/fact-tag-dry-run.mjs`
- 운영 sync: `worker/sources/tourapi.ts`
- 공통 규칙: `shared/fact-tags.ts`의 `classifyFactTags`, `FACT_RULE_VERSION="fact_rules_v1"`
- 운영 저장 식별자: `classifier_type="deterministic_rule"`, `rule_version="fact_rules_v1"`

운영화 commit `e10ff54`에서 dry-run과 TourAPI sync가 `shared/fact-tags.ts`를 함께 사용하도록 통합했고, 현재 운영 verify는 같은 report 후보 key와 D1 key를 비교한다. negative/conditional/stale 필터, 허용 field, evidence scope 처리는 이 공통 함수에서 동일하게 실행된다. `parking`, `pet_not_allowed`는 공통 v1 tag 목록에 없으므로 현재도 0행이다.

## 운영 수정 여부와 판정

- 운영 D1 수정: **없음**
- 규칙 튜닝: **없음**
- schema 변경: **없음**
- Cloudflare 재배포: **없음** (문서·읽기 감사만 수행)
- 판정: **현재 운영 결과는 fact-tag v1 최종 QA 후 규칙과 일치한다. Phase 3-1을 최종 완료 처리해도 된다.**
