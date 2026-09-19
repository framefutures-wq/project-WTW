# 동행 적합도 v1 설계 및 dry-run QA

실행일: 2026-09-19 UTC
`rule_version`: `companion_rules_v1`

이번 단계는 운영 저장을 위한 사전 검증이다. D1에 suitability를 쓰지 않았고, Worker/API/UI, fact tag, TourAPI raw, 신뢰상태를 변경하지 않았다.

## 데이터 기준

현재 원격 D1의 이전 읽기 검증으로 보관된 TourAPI snapshot과 fact-tag dry-run 결과를 사용했다.

- 행사: 263건
- fact-tag 보유 행사: 243건
- `event_tags` 후보: 1,081행
- fact classifier: `deterministic_rule`
- fact rule version: `fact_rules_v1`
- TourAPI source 최신 시각: `2026-09-18T21:00:18.624Z`
- snapshot: `.wrangler/deployment/tourapi-real.json`

이번 실행 시 Cloudflare D1 무료 일일 row-read 한도에 도달해 원격 재조회는 거절됐다. 따라서 위 snapshot과 이미 검증된 `.wrangler/fact-tag-dry-run.json`을 읽기 전용으로 사용했다. snapshot 행사 수·수집 시각·fact-tag 행 수는 운영 일치성 감사 결과와 같다. 새 수집이나 D1 쓰기는 수행하지 않았다.

## 상태 의미

`child`, `couple`, `parents`는 다음 상태를 사용한다.

- `fit`: 정의된 복수 근거 조합이 있고, 현재 snapshot 표본에서 명백한 오탐이 없었던 경우
- `conditional`: 일부 적합 신호는 있으나 대상 직접 근거나 편의 근거가 부족한 경우
- `unknown`: 적합성 판단에 필요한 근거 조합이 없는 경우

`pet`은 취향 적합도가 아니라 동반 가능 사실이다.

- `allowed`: `pet_allowed` fact tag가 있을 때만
- `unknown`: 그 외 전부

`pet_not_allowed`는 만들거나 추론하지 않았다. 야외·공원·자연·산책 fact tag도 반려동물 허용 근거로 사용하지 않았다.

각 결과에는 `event_id`, `companion_type`, `suitability_state`, `positive_reason_codes`, `caution_reason_codes`, fact tag의 `rule_id`·evidence source/field/excerpt, `rule_id`, `rule_version`을 보존했다. 이는 분석 JSON에만 저장했다.

## 규칙

### child

강한 근거:

- `children_program` → `fit` (`child.direct_children_program`)

가족 대상이 직접 있고 활동 내용이 함께 있는 경우:

- `family_program` + `experience|education|sports|exhibition|nature_scenery` → `fit` (`child.family_activity_combo`)
- `family_program`만 있음 → `conditional` (`child.family_program_only`)

직접 대상 표기가 없는 조합은 추천으로 확정하지 않는다.

- `experience + education`
- `experience + nature_scenery`
- `exhibition + education`
- `traditional_history + experience`
- `sports + experience`

위 조합은 `conditional`이며 `child.direct_audience_missing`를 함께 기록한다. `experience` 단독은 child fit이 아니다.

### couple

다음 복수 축 조합만 `fit`으로 후보화했다.

- `flower_garden + photo_spot`
- `night_light + photo_spot`
- `fireworks + night_light`
- `nature_scenery + photo_spot`
- `performance + night_light`
- `exhibition + photo_spot`

`food + local_specialty`는 초기에는 fit 후보였지만 일반 음식·지역축제에도 너무 넓게 붙어 **23건을 conditional로 강등**했다(`couple.food_local_axis`, `couple.couple_specificity_missing`). 단일 축은 `conditional`, 축이 없으면 `unknown`이다.

### parents

콘텐츠 축은 `traditional_history`, `nature_scenery`, `performance`, `exhibition`, `local_specialty`, `food`, `flower_garden`이다. 편의 축은 `seated_viewing`, `accessibility`, `shuttle`, `indoor`다.

- 콘텐츠 축 + 편의 축 → `fit` (`parents.content_plus_comfort`)
- 콘텐츠 축만 있음 → `conditional` (`parents.content_without_comfort_evidence`, `parents.comfort_evidence_missing`)
- 콘텐츠 축 없음 → `unknown`

편의 태그가 없다는 이유로 부적합으로 만들지 않았다. 장시간 보행·소음·야간 부담 등을 공식 fact tag가 아닌 추측으로 만들지 않았다.

## 전체 dry-run 분포

| 유형 | fit/allowed | conditional | unknown |
|---|---:|---:|---:|
| child | 24 | 109 | 130 |
| couple | 42 | 74 | 147 |
| parents | 13 | 226 | 24 |
| pet | 1 allowed | - | 262 |

부모님 결과의 `conditional` 226건은 부모님 추천 확정이 아니라 콘텐츠는 있으나 관람 편의 근거가 없다는 보수적 상태다. `fit`은 13건으로 제한했다.

### 여러 유형 동시 fit

| fit 유형 수 | 행사 수 |
|---:|---:|
| 0 | 188 |
| 1 | 70 |
| 2 | 5 |
| 3 | 0 |
| 4 | 0 |

모든 행사에 여러 동행 유형이 붙는 현상은 없었다.

## 층화 QA

QA는 66개 고유 행사, 121개 상태별 결과를 대상으로 했다. 각 동행 유형의 fit/conditional/unknown(반려동물은 allowed/unknown)을 나누고, fact tag source/evidence field/rule을 함께 확인했다.

대표 확인 사례:

| 행사 | 결과 | fact 근거 | 판정 |
|---|---|---|---|
| 동해 무릉제 | child fit | `children_program`의 어린이 체험관 | 직접 대상 근거 |
| 홍천 인삼한우 명품축제 | child fit | `family_program` + `experience` | 가족 대상과 체험 조합 |
| 나오라쇼 | couple fit | `performance` + `night_light` | 상호 보완 경험 조합 |
| 평창농악·산골푸드축제 | couple conditional | `food` + `local_specialty` | 커플 특수성 부족으로 강등 |
| 동강국제사진제 | parents fit | `exhibition` + `indoor` | 콘텐츠와 실내 근거 |
| 국립극장 쏙쏙들이페스티벌 | parents fit | `performance` + `seated_viewing` | 공연과 좌석 근거 |
| 기장군반려동물문화축제 | pet allowed | `pet_allowed`의 동반 걷기대회 | 명시 근거 |

### QA 결과

- 수정 전 명백한 false positive 후보: 23건 (`food + local_specialty`를 couple fit으로 보던 사례)
- 수정: 해당 조합을 `conditional`로 강등
- 수정 후 반복되는 명백한 fit false positive: 0건
- false negative 후보: 0건
- `single_tag_overreach`: fit 결과에는 없음. 단일 축은 conditional/unknown으로 제한했다.
- `weak_combination`: `food + local_specialty` 23건. 규칙에 반영해 해소했다.
- `venue_name_bias`, `stale_evidence`, `context_mismatch`, `generic_keyword_bias`: suitability 규칙에서 새로 발생한 사례 없음

일부 conditional은 공식 fact tag가 존재하지만 동행 대상 직접 근거가 부족한 사례다. 이는 false positive fit으로 승격하지 않고 의도적으로 보류했다. upstream fact tag 자체의 오탐 가능성은 이번 단계에서 수정하지 않고 별도 fact-tag 이슈로 남긴다.

## false negative 검토

unknown 표본에서 child/couple/parents의 조합 근거가 없는 상태를 확인했다. 예를 들어 단순 공연·전통·체험 하나만 있는 행사는 해당 유형 fit으로 승격하지 않았다. 공식 대상·편의 근거가 추가되지 않은 상태에서 규칙을 넓히지 않았으므로 확정 가능한 false negative 후보는 0건이다.

## 판정과 다음 단계

현재 규칙은 다음 의미의 **dry-run v1 후보**로는 정리됐다.

- 단일 fact tag 1:1 추천 금지
- fit보다 conditional/unknown 우선
- 반려동물은 명시된 `pet_allowed`만 허용
- reason code와 fact provenance 추적 가능
- 반복 weak combination 제거

다만 운영 반영은 **보류**한다. 부모님 `conditional` 비율이 높고, 커플·부모님 적합성은 직접적인 공식 문장보다 fact 조합에 의존한다. 다음 단계에서 더 넓은 층화 QA와 제품 문구 검토를 거친 뒤에만 suitability 저장/API 반영을 결정한다. 이번 단계에서는 `companion_rules_v1`을 운영 D1에 적용하지 않는다.

## 변경 및 검증

- fact tag 수정: 없음
- 운영 D1 변경: 없음
- suitability schema/API/UI 변경: 없음
- Cloudflare 재배포: 없음
- 실행 스크립트: `scripts/companion-suitability-dry-run.mjs`
- 실행 예: `node scripts/companion-suitability-dry-run.mjs --snapshot .wrangler/deployment/tourapi-real.json`
