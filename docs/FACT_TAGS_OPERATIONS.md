# fact tag v1 운영 반영

## 현재 버전과 적용 범위

- `classifier_type`: `deterministic_rule`
- `rule_version`: `fact_rules_v1`
- v1 적용 태그: `food`, `fireworks`, `flower_garden`, `experience`, `performance`, `exhibition`, `traditional_history`, `nature_scenery`, `night_light`, `photo_spot`, `local_specialty`, `education`, `sports`, `parade`, `children_program`, `family_program`, `indoor`, `shuttle`, `accessibility`, `seated_viewing`, `pet_allowed`
- 보류: `parking`, `pet_not_allowed`

새 taxonomy, 동행 적합도, AI 분류는 포함하지 않는다.

## 저장 구조

`0006_fact_tag_provenance.sql`은 기존 `event_tags` 행을 `legacy` classifier로 보존하면서 다음 provenance 필드를 추가한다.

- `classifier_type`, `rule_version`
- `rule_id`
- `evidence_source_ref`, `evidence_field`, `evidence_excerpt`
- `created_at`, `updated_at`

동일 `event_id + tag + classifier_type + rule_version`은 복합 primary key로 한 번만 저장된다. 기존 수동/기타 classifier 태그는 `legacy`로 복사되며 v1 재분류 대상이 아니다.

## 최초 backfill 결과

2026-09-19 UTC 기준 원격 D1의 실제 행사 263건을 공통 deterministic 엔진으로 dry-run했다.

| 항목 | 결과 |
| --- | ---: |
| 태그 행사 | 243건 |
| 미태깅 행사 | 20건 |
| 예정 v1 row | 1,081건 |
| 행사당 평균 태그 | 4.11개 |
| 행사당 최대 태그 | 11개 |
| 중복 예정 | 0 |
| unknown/제외 태그 | 0 |

실제 backfill 후에도 1,081행, 243개 행사로 dry-run과 일치했다. duplicate 0, orphan 0, v1_ready 외 태그 0, `parking` 0, `pet_not_allowed` 0이다.

주요 태그별 행사 수는 `performance` 203, `experience` 192, `exhibition` 117, `food` 98, `traditional_history` 93, `nature_scenery` 59, `sports` 47, `education` 41, `local_specialty` 39, `parade` 37이다.

각 row에는 규칙 ID와 함께 dry-run이 선택한 근거 source reference, field, 최대 1,000자 evidence excerpt가 저장된다. 원본 `events`, TourAPI raw, 신뢰상태, 이미지, 공식 감사 테이블은 수정하지 않았다.

## 실행 순서

```sh
npm run fact-tags:dry-run
npm run fact-tags:apply
npm run fact-tags:verify
```

dry-run은 원격 D1을 읽고 `.wrangler/fact-tag-dry-run.json`을 만든다. apply는 report에서 v1_ready 후보만 검증하고 행사 25건 단위의 idempotent 요청으로 해당 행사·classifier·version 범위만 삭제 후 재생성한다. D1 CLI가 명시적 SQL `BEGIN`을 허용하지 않으므로 각 chunk는 재실행 가능하게 구성되어 있으며, 실패 시 같은 명령을 다시 실행해도 중복되지 않는다. verify는 예정 key와 실제 key, 허용 태그, orphan, provenance를 비교한다.

## TourAPI sync lifecycle

`saveFestivalSnapshot`은 event/source 저장과 같은 D1 batch에 fact-tag 변경문을 포함한다.

- 신규 행사: 저장 성공 transaction에 v1 계산·저장
- 기존 행사: TourAPI event 필드 또는 classifier 입력 raw field(`title`, `overview`, `program`, `subevent`, `eventplace`, `placeinfo`, `playtime`, `parking`, `parkinginfo`, `agelimit`, `usetimefestival`)가 변경된 경우에만 해당 event의 v1 deterministic 태그를 재계산
- 변경 없는 행사: v1 tag delete/insert를 실행하지 않음
- 저장 실패: 같은 batch가 실패하므로 tag만 남지 않음

재계산은 해당 행사의 TourAPI primary source가 유지되는 경우에만 수행한다. 기존 legacy 태그는 항상 보존한다. 현재 sync가 저장하는 TourAPI raw와 event fields만으로 판단하므로 공식 출처 audit의 별도 변경은 다음 공식 감사 흐름에서 다시 반영할 수 있다.

## 검증과 주의사항

공통 규칙은 `shared/fact-tags.ts`에 있고 dry-run과 Worker sync가 함께 사용한다. 부정·조건부·충돌 문구는 deterministic 엔진의 기존 처리 규칙을 따른다. `pet_allowed`는 명시적인 동반 가능 문구만 근거로 하며 야외/공원 행사에서 추론하지 않는다. `parking`과 `pet_not_allowed`는 schema상 보류 목록으로 생성되지 않는다.

향후 v2에서는 새 `rule_version`을 사용하고 v1을 덮어쓰지 않는다. 전체 재분류가 필요할 때도 dry-run → invariant 확인 → apply → verify 순서를 유지한다.
