# D1 Row Read / N+1 감사

감사일: 2026-09-19. 이 감사는 원격 D1 또는 공개 production API를 호출하지 않았다. 정적 코드, 기존 local snapshot, local D1(실행 전 263개 실행 행사·1,052개 evidence·526개 official audit)과 `EXPLAIN QUERY PLAN`만 사용했다. D1의 실제 billing row-read는 쿼리 플랜의 행 수와 같다고 단정할 수 없으므로, 아래의 위험도는 전체 scan·OFFSET 반복·호출 횟수 구조를 기준으로 한다.

## 결론

일일 5M row-read를 소진할 가장 유력한 경로는 일반 사용자 목록 요청 하나가 아니라, 원격 D1을 기본 대상으로 한 대량 QA/감사 스크립트를 여러 단계에서 반복 실행한 구조다. 특히 기존 fact-tag dry-run은 `event_evidence`, `official_source_audits`, `official_source_links`, `official_source_comparisons`를 작은 `LIMIT/OFFSET` 페이지로 끝까지 다시 읽었다. OFFSET 페이지는 뒤쪽 페이지일수록 앞 행을 다시 지나갈 수 있으므로, 같은 감사의 재실행과 다른 감사의 중복 snapshot이 합쳐지면 row-read가 빠르게 누적될 수 있다.

사용자 목록 API도 개선 대상이었다. 이전 날짜순 경로는 조건 일치 행사 전체를 Worker로 가져온 뒤 JS에서 page slice했다. 이제 날짜순은 DB `LIMIT/OFFSET`으로 카드 9개만 읽고, 첫 요청에서만 정확한 total count를 계산한다. Phase 5-0G의 추가 페이지 요청은 `includeTotal=0`을 사용해 이미 확보한 total을 재사용한다. 거리순은 현재 좌표 거리 계산이 Worker JS에 있으므로 모든 일치 행사를 읽는 예외 경로로 남아 있으며, 향후 SQL 거리 계산 또는 cursor 설계 시 별도 검토가 필요하다.

## D1 read 경로

| 구분      | 경로                                | 주요 테이블                                                     | 호출/scan 특성                                                                                               | 위험            |
| --------- | ----------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------- |
| 사용자    | `GET /api/events` 날짜순            | events, sources, trust, images, legacy tags, evidence           | 첫 page: date range + count + 9개 page query. 추가 page: date range cache miss 시 aggregate + 9개 page query | Medium          |
| 사용자    | `GET /api/events` 거리순            | 위 테이블                                                       | 거리 계산을 위해 조건 일치 전부를 Worker로 읽고 JS 정렬                                                      | Medium          |
| 사용자    | `GET /api/events/:id`               | events/sources/trust/images/tags + evidence                     | event query 1회, 해당 event evidence query 1회                                                               | Low             |
| 사용자    | `GET /api/meta`                     | events/sources/evidence/tags                                    | 제공 기간 MIN/MAX. DB binding별 60초 cache                                                                   | Low             |
| 사용자    | `GET /api/health`                   | events                                                          | `SELECT 1 … LIMIT 1` 1회                                                                                     | Low             |
| 자동 운영 | Cron + TourAPI ingestion            | events, sources, evidence, tags                                 | sync 후보별 기존 event/source 1회 조회 후 batch write; 변경 행사의 fact-tag만 재분류                         | Medium          |
| QA/분석   | fact-tag/companion/image/trust 감사 | events, sources, evidence, official audit/link/comparison, tags | 과거에는 여러 script가 원격 전체 읽기를 독립 실행                                                            | **High (기존)** |
| 관리      | migration/backfill/verify           | schema, event_tags 등                                           | 명시 실행. verify는 전체 fact-tag read 가능                                                                  | Medium          |

## N+1 및 반복 조회 결과

Worker API에는 JavaScript loop 안에서 event마다 D1 `SELECT`를 실행하는 N+1은 없다.

- 목록: 단일 page query 안의 legacy tag scalar subquery와 production visibility `EXISTS`가 후보 행마다 평가될 수 있는 correlated SQL이다. 애플리케이션 N+1은 아니지만 index가 중요하다.
- 상세: event 정보 1 query + 해당 event evidence 1 query로 bounded 되어 있다. evidence는 event id로 제한된다.
- TourAPI sync: 신규/변경 후보마다 이전 event/source를 1회 읽는 ingest-time 경로다. 전체 사용자 요청 path가 아니며, 변경 없는 event는 fact-tag를 다시 쓰지 않는다.
- 가장 명백한 반복 전체 조회는 QA scripts였다. fact-tag dry-run의 `queryPaged`와 image pipeline의 `paged`는 OFFSET을 증가시키며 원격 전체 테이블을 반복 read했고, trust scripts는 여러 테이블의 `SELECT *` snapshot을 before/after/verify 단계에서 다시 생성했다.

따라서 발견한 애플리케이션 N+1은 0건이며, scan 위험 SQL은 목록 날짜순 기존 전체 materialization, 거리순 전체 materialization, QA의 OFFSET 반복과 전체 `SELECT *` snapshot으로 4개 유형이다.

## 사용자 API query 구조

날짜순 목록은 다음 구조다.

1. 제공 가능 기간 aggregate (`availableDateRange`) — DB binding당 최대 60초 cache
2. 첫 page만 `COUNT(*)`으로 정확한 total 계산
3. `WHERE` / `ORDER BY e.start_date,e.id` / `LIMIT ? OFFSET ?`으로 현재 page만 선택

추가 Load More page는 `includeTotal=0`으로 2번을 생략한다. 프런트는 첫 응답의 total을 session state에서 계속 사용한다. API의 기존 기본 계약은 유지된다. `includeTotal`을 생략한 외부 호출에는 계속 total이 있다.

목록에는 TourAPI raw payload, official page body, full evidence text를 선택하지 않는다. event table의 화면용 필드, source/trust/image metadata, legacy tag aggregate만 읽는다.

현재 9개 단위 OFFSET은 263개 규모에서는 유지한다. 수천 건 이상에서 깊은 page를 자주 제공하거나 거리순 SQL화가 필요해질 때 `(start_date,id)` keyset/cursor를 검토한다. 이 감사에서 cursor pagination은 도입하지 않았다.

## Local EXPLAIN QUERY PLAN

local D1에 비파괴 migration `0007_read_path_indexes.sql`을 적용해 확인했다.

| query                           | 결과 요약                                                                                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 날짜순 page query               | `SEARCH e USING INDEX idx_events_listing_order (is_sample, verification, start_date<?)` 및 source PK lookup. 기존 plan의 `USE TEMP B-TREE FOR ORDER BY`가 제거됨                 |
| tag filter `e.id IN (SELECT …)` | event PK lookup + `SEARCH t USING COVERING INDEX idx_event_tags_classifier_tag_event (classifier_type=? AND tag=?)`                                                              |
| 상세 evidence                   | `SEARCH ev USING COVERING INDEX sqlite_autoindex_event_evidence_1 (event_id=?)`; source PK lookup. source priority ordering의 temp B-tree는 한 event의 작은 evidence 집합에 한정 |

새 index는 아래 두 개다. 모두 `CREATE INDEX IF NOT EXISTS`이며 데이터 변경·삭제·table rebuild가 없다.

- `idx_events_listing_order(is_sample, verification, start_date, id, end_date)`
- `idx_event_tags_classifier_tag_event(classifier_type, tag, event_id)`

원격 migration 적용은 하지 않았다. D1 한도 리셋 후 별도 운영 반영 단계에서만 적용한다.

## Snapshot-first 정책 및 안전장치

`npm run fact-tags:snapshot`은 기본적으로 local D1 snapshot을 `.wrangler/deployment/fact-tag-snapshot.json`에 만든다. fact-tag dry-run, companion dry-run, image pipeline은 이 snapshot을 기본으로 읽으며 원격 D1을 기본 실행하지 않는다.

원격 전체 snapshot이 정말 필요한 경우에만 다음처럼 명시한다.

```sh
npm run fact-tags:snapshot -- --remote --allow-expensive-remote-read
```

`real-snapshot`, trust audit의 `--remote`, official source save의 `--remote`, fact-tag verify도 동일한 `--allow-expensive-remote-read` 확인을 요구한다. 실행 전 remote target과 전체 snapshot 성격을 메시지로 알린다. 일반 dry-run은 remote option 자체가 없다.

권장 운영 순서는 다음과 같다.

1. 필요할 때만 remote snapshot을 한 번 생성하고 timestamp/source를 저장한다.
2. dry-run, QA, companion/image 분석은 그 local artifact를 반복 사용한다.
3. final apply만 명시적으로 remote write한다.
4. final verify는 필요한 한 번의 bounded query만 수행한다.

## Frontend fetch 감사

목록 mount는 `/api/meta` 1회와 첫 page 1회를 요청한다. 검색은 300ms debounce 뒤 첫 page만 다시 요청한다. Phase 5-0G의 더보기는 성공한 page를 append하며, 추가 요청 실패는 실패한 page만 재시도한다. 상세는 선택 event의 detail API 1회만 요청하고, 모달 왕복/scroll restoration은 목록 첫 page를 다시 요청하지 않는다.

React StrictMode의 development effect 재실행은 개발 환경 현상이며 production row-read 산정에는 포함하지 않는다.

## D1 reset 뒤 최소 검증

한도 리셋 뒤에는 전체 audit를 재실행하지 않는다.

1. `/api/health` 1회
2. 날짜순 목록 첫 page 1회
3. 목록 Load More 1회 (`includeTotal=0` 확인)
4. 상세 API 1회
5. Cloudflare D1 usage 증가량을 확인

증가량이 비정상적일 때만 해당 단일 query의 plan/로그를 추가 확인한다. TourAPI sync, full fact-tag audit, image audit, official source audit은 이 검증 단계에서 실행하지 않는다.

## 향후 주의사항

- production visibility의 freshness/evidence `EXISTS`는 정확성 때문에 남아 있다. 데이터가 커지면 event evidence의 event-first index와 visibility query를 별도 profile한다.
- companion suitability 운영 반영 시 event별 suitability detail query를 만들지 말고, 목록 filter에는 indexed set query 또는 join을 사용한다.
- `COUNT(*)`, `DISTINCT`, `GROUP BY`는 hot page path에 새로 넣지 않는다. 필요하면 first page/session 수준에서만 사용한다.
- 날짜순 backend 정렬을 Phase 5-0F의 ‘선택 기간 내 신규 시작 우선’으로 바꿀 때에는 expression sort가 index를 무력화할 수 있으므로 local plan으로 복합 index/두 단계 ordering을 다시 검토한다.
