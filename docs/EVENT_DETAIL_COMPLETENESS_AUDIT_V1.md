# 대표 행사 상세정보 Completeness Audit v1

감사일: 2026-09-20 (Asia/Seoul 기준)

이 감사는 전체 263건을 확장하기 전, 실제 production 행사 8건에서 공식 근거가 DB, detail API와 UI 계약까지 보존되는지 확인한 품질 게이트다. 뉴스·블로그·개인 SNS는 근거로 사용하지 않았다.

## 범위와 방법

- 대상은 production `today` 목록의 bounded 결과에서 서로 다른 형태를 골라 8건으로 고정했다.
- 원격 D1은 한 번의 ID-bounded snapshot으로만 읽었다. `events`, enrichment, programs, occurrences, operating hours, fact tags만 조회했고 write는 하지 않았다.
- 각 대상은 공식 행사·주최기관·지자체 페이지를 우선 확인했다. 공식 개별 페이지를 찾지 못한 두 항목은 TourAPI의 명시된 상세정보까지만 lower-priority evidence로 검토했다.
- program time은 event-wide operating hours로 저장하거나 카드에 표시하지 않았다.
- 재현 명령은 아래와 같다. 두 번째 인수는 production API에서 저장한 **로컬 임시 snapshot**이며, 명령 자체는 network/D1 write를 하지 않는다.

```sh
npm run audit:event-detail-completeness -- fixtures/event-detail-completeness-v1.json /path/to/bounded-api-snapshot.json
```

## 결과

| Event ID          | 행사                         | 유형                             | 공식 근거                                                                                                                          | 현재 결과                                                                                              |
| ----------------- | ---------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `tourapi-1100492` | 고양호수예술축제             | 불꽃·공연·체험·날짜별 occurrence | [고양특례시](https://www.goyang.go.kr/news/user/bbs/BD_selectBbs.do?q_bbsCode=1090&q_bbscttSn=20260914143031770&q_estnColumn1=Y)   | summary, highlights, 3개 프로그램, 4개 occurrence가 API까지 일치                                       |
| `tourapi-2657619` | 2026 화성행궁 야간개장       | event-wide operating hours       | [수원시 팔달구](https://paldal.suwon.go.kr/bbsplus/view.asp?bd_gubn=15&code=tbl_bbs_sub200510&menuid=sub200510&no=MTk5NjEg&page=1) | 운영시간은 일치. summary는 extraction omission                                                         |
| `tourapi-2987489` | 2026 고흥 녹동항 드론쇼      | 드론·반복 프로그램               | [공식 누리집](https://nokdongdrone.co.kr/overview/)                                                                                | summary·program extraction omission; 반복 일정 모델도 별도 검토 필요                                   |
| `tourapi-2786391` | 광안리 M 드론 라이트쇼       | 계절별 program time              | [공식 공지](https://www.gwangallimdrone.co.kr/notice/gwanganri-m-deuronraiteusyo-hajeolgi-gongyeon-sigan-annae)                    | summary·program extraction omission; 20:00/22:00은 event-wide 시간이 아님                              |
| `tourapi-292961`  | 서울 왕궁수문장 교대의식     | 공연·체험·세부 장소              | [공식 행사 안내](https://www.royalguard.kr/content/royalguard)                                                                     | summary·교대의식 extraction omission; 11:00/14:00은 program time                                       |
| `tourapi-2809535` | 남산봉수의식 등 전통문화행사 | 여러 장소·프로그램을 묶은 parent | [공식 누리집](https://namsanbongsu.kr/)                                                                                            | summary·program extraction omission. parent/sub-event source identity를 먼저 분리해야 함               |
| `tourapi-2434545` | 새연교 주말 문화공연         | 공연·불꽃·정보 부족              | [TourAPI 공개 명세](https://www.data.go.kr/data/15101578/openapi.do)                                                               | 현재 TourAPI 상세 외 독립 공식 일정표를 bounded inspection에서 확보하지 못함; summary·program omission |
| `tourapi-3473295` | DDP 건축투어                 | 반복 투어·회차 시간              | [TourAPI 공개 명세](https://www.data.go.kr/data/15101578/openapi.do)                                                               | 현재 TourAPI 상세의 회차 정보는 존재하나 enrichment 없음; summary·program omission                     |

### 고양호수예술축제 기준 회귀

- `Hey, Listen`: 2026-09-19 19:30, 한울광장.
- `불꽃 드론 쇼와 불꽃놀이`: 2026-09-19 및 2026-09-20, 각각 20:30. 프로그램 장소는 공식 근거가 없어 null로 유지한다.
- `서커스 빌리지`: 9월 18일 15:00~19:00, 9월 19~20일 14:00~19:00, 일산호수공원 내 가로수정원.
- 이 시간들은 `event_operating_hours`가 아니라 `event_program_occurrences`에만 있고, event-level fireworks tag는 유지된다.

### 양방향 판정

API snapshot 기준으로 고양의 저장 프로그램/occurrence는 manifest와 일치했다. 대상 8건에서 저장된 값 중 unsupported field, wrong date, wrong time, wrong venue, source identity mismatch, program/event-time mix는 발견되지 않았다.

반면 summary 또는 주요 program이 공식 근거에 있는데 현재 enrichment에 없는 항목은 13건의 extraction omission으로 확인됐다. 이들은 DB/API/UI 중 뒤 단계에서 사라진 것이 아니라, 현재 enrichment extraction/write 단계가 고양 외 행사에 적용되지 않은 결과다.

`새연교`와 `DDP`는 별도 organizer page의 날짜별 일정까지 확보하지 못했다. 이 둘은 현재 데이터 외 정보를 생성하지 않았으며, official source depth가 부족한 **true missing / source coverage limitation**으로 함께 기록한다. `남산봉수의식`은 서로 다른 장소·프로그램을 하나의 TourAPI parent event로 묶어 source identity가 모호하다.

## 운영시간 판정

- 화성행궁은 공식 안내가 행사 전체의 금~일·공휴일 18:00~21:30 운영을 명시하므로 `event_operating_hours` 86개 날짜 row가 유효하다. 2026-09-20 선택 시 18:00~21:30이 카드/API에서 선택된다.
- 고양의 불꽃 20:30, 고흥의 드론쇼 21:00, 광안리의 20:00/22:00, 왕궁수문장의 11:00/14:00은 모두 특정 프로그램 시간이다. event-wide operating hours에 저장하지 않았다.

## 품질 게이트 결론

판정은 **C. 불안정**이다. 고양과 화성행궁의 기존 구조는 정확하지만, 8개 대표군에서 공식 근거가 있는 summary/program 13건이 아직 enrichment extraction 단계에 도달하지 않았다. 또한 주간·계절 반복 일정과 parent/sub-event source identity의 정책이 확정되지 않았다.

263건 전체 확대는 진행하지 않는다. 다음 단계는 3~5개 source 유형별로 (1) 공식 source identity, (2) recurrence를 occurrence로 안전하게 표현하는 범위, (3) audited manifest → idempotent bounded write 흐름을 구현하고 같은 8건을 재감사하는 것이다.
