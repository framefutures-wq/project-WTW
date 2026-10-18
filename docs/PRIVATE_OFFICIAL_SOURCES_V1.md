# 민간 공식 행사 소스 v1

## 목적과 운영 경계

민간 주최기관의 공식 행사 페이지를 탐색 후보로 검토하는 공통 adapter 프레임워크다. 이번 Phase 7-1은 discovery와 dry-run만 수행하며 production D1 insert/update, migration, Cron 변경, 공개 행사의 자동 등록은 하지 않는다.

공식 페이지의 행사 사실만 사용한다. 검색 결과, 블로그, 카페, 개인 SNS는 행사 근거로 사용하지 않는다. 로그인, CAPTCHA, anti-bot 우회와 과도한 crawling은 금지한다.

## source registry와 adapter

`shared/private-official-sources.ts`에 source registry와 공통 `DiscoveredEventCandidate` 구조를 둔다. 후보에는 source URL, canonical source id, 일정, 장소, `venueType`, 설명, 가격/예약/연락처 후보, fetch 시각, field evidence, eligibility, duplicate 상태, parent/sub-event 후보를 담는다.

현재 registry:

| source key | 공식 hostname                                                      | type               | venue type |
| ---------- | ------------------------------------------------------------------ | ------------------ | ---------- |
| everland   | `web.everland.com`, `www.everland.com`, `reservation.everland.com` | organizer_official | theme_park |

`venue_type=theme_park`는 내부 metadata이며 public 테마파크 필터는 추가하지 않는다. 예약 hostname은 상품·할인·이용권 페이지가 많으므로 행사 adapter의 seed로 자동 순회하지 않는다.

## Everland 1호 dry-run

재현 명령:

```sh
npm run discover:everland
```

seed는 공개 행사 HTML 세 페이지와 공식 예약 상품 페이지 한 페이지로 제한한다. 결과는 `.wrangler/everland-dry-run.json`에 생성되며 `.wrangler`는 commit하지 않는다. 실제 운영 D1을 읽거나 쓰지 않는다.

확인된 공식 페이지 사례:

- Tulip Festival entertainment: 불꽃쇼, 서커스, 퍼레이드, 공연 안내
- Water Festival show: 기간·장소가 있는 워터쇼/파티와 운영시간
- Blood City Zero map: 미션 프로그램과 날씨·현장 상황에 따른 변경 안내

현재 날짜와 완전한 공식 기간이 있는 후보만 `eligible`로 제안한다. 기간이 빠졌거나 페이지가 시즌 안내인지 독립 행사인지 불명확하면 `needs_review`로 남긴다. 이용권, 할인, 쿠폰, 주차, 식음료, 패키지, 멤버십, 대여 상품은 `not_eligible`다.

## fact-tags와 companion

eligible 후보도 기존 `fact_rules_v1` deterministic classifier를 사용한다. 공식 텍스트에 불꽃쇼·공연·체험·퍼레이드·꽃 등이 명시될 때만 해당 fact tag를 만든다. 테마파크라는 장소 유형만으로 불꽃·공연·아이 동행 적합도를 추론하지 않는다. companion_rules_v1도 이후 동일 fact 결과를 입력으로 재사용한다.

이번 단계에서 기존 event_tags나 companion 테이블에는 쓰지 않는다.

## parent/sub-event

시즌 페이지 안에 독립 이름과 완전한 기간/운영시간/장소/예약 조건이 있는 프로그램은 sub-event 후보로 표시한다. 큰 시즌 행사 본문에 포함된 프로그램명이나 불꽃 연출만 있고 독립 일정이 없으면 parent event의 evidence/tag로만 남긴다. 모든 프로그램을 event로 분해하지 않는다.

현재 schema migration은 만들지 않는다. 향후 parent-child를 도입할 때도 자동 merge 없이 `parent_source_id`와 stable canonical source id를 먼저 검토한다.

## duplicate와 source identity

stable identity 우선순위는 source key + canonical official URL + 공식 item id다. 현재 Everland 공개 페이지는 일부 항목에 명시적인 item id가 없어 URL path + 정규화된 heading을 임시 canonical id로 사용한다. 이는 title 단독 identity가 아니다.

TourAPI local snapshot이 제공되지 않은 dry-run에서는 duplicate 판정을 보수적으로 `ambiguous_duplicate`로 둔다. 정확한 TourAPI bounded snapshot을 별도 승인받은 Phase에서만 probable duplicate/new candidate를 확정한다. 자동 merge는 하지 않는다.

## 접근·robots·parser 안전성

2026-09-20 확인 결과 공개 HTML seed는 로그인/CAPTCHA/우회 없이 HTTP 200으로 읽혔다. `reservation.everland.com/robots.txt`와 `www.everland.com/robots.txt`는 robots 규칙을 제공한다. `web.everland.com/robots.txt`는 HTTP 200이지만 robots 문서가 아닌 오류 HTML을 반환해 허용 규칙으로 해석하지 않았다. 따라서 adapter는 확인된 명시적 seed만 읽고 web host를 광범위하게 crawl하지 않는다.

공식 약관 링크인 `https://www.everland.com/terms`는 JS shell만 반환되어 이번 단계에서 내용을 우회해 수집하지 않았다. 따라서 약관의 자동수집 허용 범위를 확정하지 않고, 공개 HTML의 제한된 seed를 수동 검토용 dry-run으로만 사용한다.

parser 실패는 빈 행사나 취소로 해석하지 않는다. 이전 결과를 덮어쓰거나 삭제하지 않고 parse error를 report한다.

## 가격·연락처·이미지

공식 가격 text는 행사 참가비, 입장권, 선택 체험비, 할인 상품을 구분해 raw 후보로만 기록한다. 이번 Phase에서는 cost_rules_v1이나 production cost_status에 연결하지 않는다.

공식 행사별 문의전화가 명시된 경우만 후보로 기록하며 에버랜드 대표번호를 모든 행사에 복제하지 않는다. 공식 image URL은 metadata 후보로만 확인하고 다운로드·publish·D1 저장하지 않는다.

## Phase 7-2 판단

자동수집 진입에는 날짜 추출, stable item identity, TourAPI 중복 비교, parent/sub-event 판정, parser failure 감지가 모두 안정적이어야 한다. 날짜가 여러 비연속 구간이면 이를 하나의 연속 행사 기간으로 합치지 않는다. 예약/상품 페이지의 판매·이용 가능 기간도 행사 기간으로 사용하지 않는다. 현재는 seed가 제한적이고 일부 공개 페이지에 완전한 기간/item id가 없으므로, dry-run 결과에 따라 **C. 자동수집 비추천** 또는 제한적 수동 검토만 가능하다고 판단한다.

## 2026-09-20 dry-run 결과

최종 seed 4개를 4회 요청해 11개 콘텐츠 후보를 만들었다.

| 항목                                                     |         수 |
| -------------------------------------------------------- | ---------: |
| 전체 후보                                                |         11 |
| eligible / not eligible / needs review                   |  3 / 1 / 7 |
| active / upcoming / ended                                |  0 / 0 / 3 |
| 완전한 날짜 / 장소 추출                                  |      3 / 5 |
| fireworks / performance / experience 후보                |  1 / 5 / 1 |
| probable duplicate / new candidate / ambiguous duplicate | 0 / 0 / 11 |
| parent / sub-event 후보                                  |      8 / 3 |
| 연락처 / 가격 / 이미지 URL 추출                          |  0 / 0 / 0 |

`experience=1`은 공식 예약 페이지의 윙즈 오브 메모리 상품 텍스트에서 나온 검토 후보이며, 완전한 행사 기간이 없어 `needs_review`다. eligible 3건은 모두 ended라 운영 등록 대상이 아니다. 이번 dry-run의 D1 read/write는 0회, migration 0, Cron 변경 0이다.

## 2026-09-20 Phase 7-1B production readiness audit

Phase 7-1 결과를 다시 만들지 않고 같은 공식 seed를 제한적으로 다시 요청했다. 4개 페이지가 같은 11개 후보를 반환했고, 로그인·CAPTCHA·anti-bot 우회는 사용하지 않았다. 이 감사는 production D1에 쓰지 않았고, TourAPI 중복 비교에 필요한 필드만 한 번 읽어 로컬 `.wrangler/everland-production-readiness.json` 보고서로 남겼다.

| 후보                                   | 페이지 유형        | 날짜 판정                                  | eligibility  | fact tags                         | 구조                    | TourAPI 중복 |
| -------------------------------------- | ------------------ | ------------------------------------------ | ------------ | --------------------------------- | ----------------------- | ------------ |
| 슈팅 워터펀 시즌 2 : 게임 속으로       | 공식 프로그램      | reliable (2026-06-19~08-30)                | eligible     | performance, seated_viewing       | sub 후보                | new          |
| 밤밤맨 키즈 워터파티                   | 공식 프로그램      | reliable (2026-06-19~08-30)                | eligible     | 없음                              | sub 후보                | new          |
| 밤밤 썸머 나이트                       | 공식 프로그램      | ambiguous: 2개 비연속 기간                 | eligible     | performance                       | sub 후보                | ambiguous    |
| BLOOD CITY ZERO                        | 공식 landing       | missing                                    | needs_review | 없음                              | parent 후보             | ambiguous    |
| 에버랜드 스페셜 불꽃쇼 : 빛의 수호자들 | 공식 시즌 프로그램 | ambiguous: 종료일 없음                     | needs_review | fireworks, nature_scenery, parade | parent 후보             | ambiguous    |
| 에버랜드 서커스 : 윙즈 오브 메모리     | 공식 시즌 프로그램 | ambiguous: 종료일 없음                     | needs_review | performance, parade               | parent 후보             | ambiguous    |
| 카니발 판타지 퍼레이드                 | 공식 시즌 프로그램 | ambiguous: 종료일 없음                     | needs_review | performance, parade               | parent 후보             | ambiguous    |
| 레니와 라라의 매지컬 스케치북          | 공식 시즌 프로그램 | ambiguous: 종료일 없음                     | needs_review | performance, parade               | parent 후보             | ambiguous    |
| 문라이트 퍼레이드                      | 공식 시즌 프로그램 | ambiguous: 종료일 없음                     | needs_review | parade                            | parent 후보             | ambiguous    |
| 야간권                                 | 공식 예약 상품     | ambiguous: 판매/이용 기간은 행사 기간 아님 | not_eligible | night_light                       | parent 플래그 대상 아님 | ambiguous    |
| 윙즈 오브 메모리                       | 공식 예약 상품     | ambiguous: 판매/이용 기간은 행사 기간 아님 | needs_review | experience                        | parent 후보             | ambiguous    |

날짜 판정은 reliable 2, ambiguous 8, missing 1이다. 특히 `밤밤 썸머 나이트`의 두 공식 운영 구간을 `2026-07-24~08-16`이라는 하나의 연속 기간으로 저장하면 안 된다. 예약 페이지의 기간도 판매·이용 가능 기간일 수 있으므로 행사 기간으로 사용하지 않는다.

현재 canonical identity는 `URL pathname + normalized heading` fallback이며 11건 모두 `fallback_unstable`이다. seed URL의 `idx`, `index_id`, `menu_id`는 개별 행사에 안정적으로 연결되는 공식 item ID로 확인하지 못했다. Phase 7-2에서는 공식 item ID를 확보했을 때만 `source_key + official item ID`를 stable identity로 사용한다.

TourAPI 중복 비교는 `events`와 primary `sources`에서 `id`, title, start/end date, venue, address, lat/lng, primary source ID, source URL만 읽은 단일 bounded snapshot 263행으로 수행했다. 결과는 probable 0, new 2, ambiguous 9다. 날짜가 부족한 9건은 자동 merge 또는 publish 대상으로 만들지 않는다.

현재의 parent 8 / sub 3 플래그는 dry-run 분류다. sub 3건은 고유 이름과 완전한 운영기간이 확인된 물놀이 프로그램이다. 나머지 parent 플래그는 parent-child 관계를 확정한 뜻이 아니며, 특히 상품 페이지 항목은 행사 parent가 아니다. 실제 parent-child 저장은 독립 이름과 일정·시간·장소·참여조건 중 충분한 근거가 있을 때만 Phase 7-2에서 검토한다.

robots 재확인에서는 `www.everland.com`이 `Allow: /`, `reservation.everland.com`이 마이페이지·결제 경로만 금지했다. `web.everland.com/robots.txt`는 유효한 robots 정책 대신 오류 HTML을 반환했다. `www.everland.com/terms`도 JavaScript shell만 반환해 약관상 자동수집 허용 범위를 확인할 수 없었다. 이는 법적 판단이 아니라, 제한된 공개 seed의 dry-run 이상으로 자동수집 범위를 넓히지 않는 근거다.

따라서 Phase 7-2 판단은 **C. 자동수집 비추천**을 유지한다. 완전한 행사 날짜, 안정 item ID, 신뢰할 수 있는 장소 추출, 명시적인 자동 접근 정책을 함께 확보하기 전에는 수동 검토용 discovery로만 사용한다.
