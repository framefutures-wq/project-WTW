# fact tag rules v1 정확도 검증

검증 실행 시각: 2026-09-19T12:28:10.851Z (UTC). 실제 TourAPI 수집·공식 출처 수집·운영 D1 쓰기는 수행하지 않았다.

- 실제 대상 행사: **263건**
- 검증 방식: performance/experience 각 **40건/40건** 층화 표본, 20건 이하 태그 전수, 그 외 태그 최대 20건 표본
- 층화 기준: evidence_source, scope, 6개 이상 태그 행사 여부

저장된 공식 페이지 excerpt는 본문 범위가 `scope_unknown`인 기록만 남아 있어 공통 메뉴·footer 오염을 배제할 수 없었다. 따라서 공식 excerpt를 후보 근거로 사용하지 않았고, 공식 excerpt 기반 후보 표본은 0건으로 별도 집계했다. 이는 공식성 기준을 낮추지 않기 위한 보수적 처리다.

## 수정 전후 분포

| 지표 | 수정 전 | 수정 후 |
|---|---:|---:|
| 커버리지 | 92.40% | 92.40% |
| 무태그 행사 | 20 | 20 |
| 행사당 평균 태그 | 4.21 | 4.11 |
| 최대 태그 수 | 11 | 11 |

| 태그 | 전 | 후 |
|---|---:|---:|
| `food` | 102 | 98 |
| `fireworks` | 26 | 26 |
| `flower_garden` | 31 | 28 |
| `experience` | 193 | 192 |
| `performance` | 203 | 203 |
| `exhibition` | 117 | 117 |
| `traditional_history` | 95 | 93 |
| `nature_scenery` | 61 | 59 |
| `night_light` | 41 | 28 |
| `photo_spot` | 33 | 33 |
| `local_specialty` | 39 | 39 |
| `education` | 41 | 41 |
| `sports` | 47 | 47 |
| `parade` | 37 | 37 |
| `children_program` | 10 | 10 |
| `family_program` | 16 | 16 |
| `indoor` | 8 | 8 |
| `parking` | 0 | 0 |
| `shuttle` | 2 | 2 |
| `accessibility` | 1 | 1 |
| `seated_viewing` | 2 | 2 |
| `pet_allowed` | 1 | 1 |
| `pet_not_allowed` | 0 | 0 |

수정한 rule은 4개 영역이다: experience의 `공예` 부분일치·장소명 오인 제거, performance/콘텐츠 태그의 eventplace 근거 제외, night_light의 일반 `조명`·`재조명` 제외, 전년도/업데이트 중인 stale 문구 제외. 수정 후 커버리지 하락 없이 태그 수만 정확도 방향으로 감소했다.

## QA 결과

- 명백한 오탐: **0건**
- 중복 후보: **0건**
- performance: **40건 표본, 명백한 오탐 없음**. 제목·overview·program 상세의 공연 근거를 확인했고 공연장 주소만으로 남은 후보는 제거했다.
- experience: **40건 표본, 명백한 오탐 없음**. APAP의 공공예술 내 공예 부분일치와 장소명 체험관 오인을 제거했다.
- 부정 표현 제외: **5건**, 조건부: **32건**, 충돌: **5건**, stale 제외: **33건**
- 현재 출력 후보에는 `scope_unknown`·공식 공통 excerpt·주소만으로 생성된 후보가 없다.

### 태그별 QA 표본

| 태그 | 후보 수 | QA 표본 | 판정 |
|---|---:|---:|---|
| `food` | 98 | 20 | v1_ready |
| `fireworks` | 26 | 20 | v1_ready |
| `flower_garden` | 28 | 20 | v1_ready |
| `experience` | 192 | 40 | v1_ready |
| `performance` | 203 | 40 | v1_ready |
| `exhibition` | 117 | 20 | v1_ready |
| `traditional_history` | 93 | 20 | v1_ready |
| `nature_scenery` | 59 | 20 | v1_ready |
| `night_light` | 28 | 20 | v1_ready |
| `photo_spot` | 33 | 20 | v1_ready |
| `local_specialty` | 39 | 20 | v1_ready |
| `education` | 41 | 20 | v1_ready |
| `sports` | 47 | 20 | v1_ready |
| `parade` | 37 | 20 | v1_ready |
| `children_program` | 10 | 10 | v1_ready |
| `family_program` | 16 | 16 | v1_ready |
| `indoor` | 8 | 8 | v1_ready |
| `parking` | 0 | 0 | insufficient_evidence |
| `shuttle` | 2 | 2 | v1_ready |
| `accessibility` | 1 | 1 | v1_ready |
| `seated_viewing` | 2 | 2 | v1_ready |
| `pet_allowed` | 1 | 1 | v1_ready |
| `pet_not_allowed` | 0 | 0 | insufficient_evidence |

performance/experience 각 40건은 근거 source·scope·태그 수를 나눈 뒤 정렬된 순서로 선택했다. 후보가 20건 이하인 태그는 전수 확인했다.

## 부정·조건부·충돌 전수 검증

- 부정/종료 표현 5건은 현재 긍정 후보로 승격되지 않았다.
- 우천·기상·매주·회차·특정일 등 조건부 32건은 후보를 유지하되 조건부로 표시되며 행사 전체 기간으로 확장하지 않는다.
- 충돌 5건은 자동 해소하지 않는다. 대표 사례는 왕가의 산책의 전시장/행렬 문맥, EX펌킨나잇의 체험 가능 문구와 특정 대상 체험 제한 문구다.

## 무태그 20건 전수 검증

- A. 공식 설명 부족: **18건**
- B. 현재 태그 체계에 해당 콘텐츠 없음: **2건**
- C. 특징은 있으나 deterministic 확정 불가: **0건**
- D. 추출 문제: **0건**
- E. 기타: **0건**
무태그 행사에서 기존 태그로 억지 확정할 D/E 사례는 발견하지 않았다. C 후보도 없으므로 AI 보완 후보는 계속 0건이다.

## 6개 이상 태그 행사

6개 이상 후보 행사는 **70건**이다. 최대 11개 행사와 주요 다중태그 표본을 확인했으며, 공연·체험·전시·역사·먹거리·야간 등 서로 다른 프로그램이 실제로 함께 기술된 복합 축제 사례였다. 동일 행사·동일 태그 중복은 0건이고 공통 footer/주소 오염도 없었다.

## 행사 전체와 프로그램 범위

program_level 후보 중 날짜·회차·요일 문구가 포함된 사례는 **52건**이다. fireworks 등은 프로그램 존재의 사실만 의미하며 행사 전체 기간을 의미하지 않는다. valid_from/valid_to는 다음 schema 단계 후보로 남기고 이번 작업에서는 추가하지 않았다.

## v1 판정

현재 후보가 있는 태그는 `v1_ready` 후보로 판정하고, 후보가 0건인 `parking`, `pet_not_allowed`는 `insufficient_evidence`로 보류한다. 이는 운영 D1에 적용했다는 뜻이 아니며, 이번 표본·전수 검사 범위에서 반복적인 명백한 오탐이 발견되지 않았다는 의미다. 운영 적용 전에는 본문 범위 저장, program 날짜 범위, 충돌 검토 큐가 남아 있다.

- v1_ready: `food`, `fireworks`, `flower_garden`, `experience`, `performance`, `exhibition`, `traditional_history`, `nature_scenery`, `night_light`, `photo_spot`, `local_specialty`, `education`, `sports`, `parade`, `children_program`, `family_program`, `indoor`, `shuttle`, `accessibility`, `seated_viewing`, `pet_allowed`
- insufficient_evidence: `parking`, `pet_not_allowed`

추가 후보는 콘텐츠 태그와 분리한다.
- 콘텐츠 후보: 캠핑/숙박, 시장·판매
- 운영/이용조건: 예약·사전신청
- 시간정보: 야간 운영시간
- 정보/안내: 해설·투어

## 운영 보호

운영 D1의 events, event_tags, event_evidence, 신뢰상태, 공식 감사 기록을 수정하지 않았다. TourAPI sync·공식 페이지 재수집·UI·Cloudflare 배포도 하지 않았다.
