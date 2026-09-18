# TourAPI 수집 거절 기록

정상 행사 테이블은 유지하고, 별도 `tourapi_rejections` 테이블에 수집 중 저장이 거절된 항목을 보관한다. `0002_tourapi_rejections.sql`은 이 테이블과 조회용 인덱스만 추가한다. 기존 Worker·D1·Cron·공개 URL을 재사용한다.

## 저장 필드

| 필드        | 내용                                                 |
| ----------- | ---------------------------------------------------- |
| id          | 거절 기록 고유 ID                                    |
| content_id  | 응답의 contentId. 누락 시 NULL이며 추측하지 않음     |
| title       | 응답의 행사명. 누락 시 NULL                          |
| raw_payload | 항목 JSON 전체. 원문 필드를 삭제하거나 보정하지 않음 |
| reason      | 거절 사유 코드 배열 JSON. 여러 이상을 함께 기록      |
| rejected_at | 실제 거절 기록 저장 시각, UTC ISO 8601               |
| sync_run_id | 해당 sync_runs.id 외래키                             |

거절 기록은 실행별로 남긴다. 같은 항목이 다음 동기화에서도 거절되면 새 기록을 추가해 각 실행을 추적한다. 인증키·요청 URL은 기록하지 않으며 응답 항목만 저장한다. 거절 원문을 노출하는 공개 API는 추가하지 않는다.

## 사유 코드

| 코드                       | 의미                                                      |
| -------------------------- | --------------------------------------------------------- |
| INVALID_CONTENT_ID         | contentId 누락 또는 숫자 형식 불일치                      |
| NOT_FESTIVAL_CONTENT_TYPE  | 행사/축제 contenttypeid=15가 아님                         |
| MISSING_TITLE              | 행사명 누락                                               |
| UNKNOWN_REGION_CODE        | 공식 지역 코드 매핑에 없음                                |
| MISSING_ADDRESS            | addr1/addr2 모두 비어 있음                                |
| INVALID_START_DATE         | 시작일 누락·형식 오류·불가능한 달력 날짜                  |
| INVALID_END_DATE           | 종료일 누락·형식 오류·불가능한 달력 날짜                  |
| START_AFTER_END            | 시작일이 종료일보다 늦음                                  |
| UNSUPPORTED_PROGRESS_TYPE  | 기존 허용 목록 밖 진행 상태값                             |
| DUPLICATE_CONTENT_ID       | 같은 응답 스냅샷에서 중복 ID 발견                         |
| SNAPSHOT_DUPLICATE_ABORTED | 중복으로 스냅샷 전체 저장 중단, 정상 후보도 저장하지 않음 |
| EVENT_TRANSACTION_FAILED   | 정상 행사 저장 트랜잭션 실패로 후보 항목 저장 불가        |

기존 수집 정책을 바꾸지 않는다. 날짜 범위 밖 항목은 정상 필터링이며 거절로 기록하지 않는다. 좌표가 없거나 유효하지 않은 항목은 기존처럼 좌표 NULL로 저장하고 거리순에 임의 좌표를 쓰지 않는다.

## 실패 시 보존

거절 항목 저장은 정상 행사 저장보다 먼저 별도 D1 트랜잭션으로 커밋한다. 정상 행사 트랜잭션이 롤백되어도 거절 기록은 남는다. 이때 정상 후보는 EVENT_TRANSACTION_FAILED로 추가 기록한다. 중복 ID 또는 전체 후보 없음으로 스냅샷이 실패해도 이미 판정된 거절 항목을 저장한다.

거절 기록 저장 자체가 실패하면 해당 동기화도 실패한다. 기록 실패를 무시하고 success로 처리하지 않는다. HTTP 오류·타임아웃처럼 항목 응답 자체가 없는 실패는 기존 sync_runs에 기록하며 contentId나 원문을 만들어내지 않는다.

## 운영 조회

```sql
SELECT r.id, r.content_id, r.title, r.reason, r.rejected_at,
       r.sync_run_id, s.status, s.started_at, s.finished_at, r.raw_payload
FROM tourapi_rejections r
JOIN sync_runs s ON s.id = r.sync_run_id
ORDER BY r.id DESC;
```

특정 실행은 `WHERE r.sync_run_id = ?`로 조회한다. 원격 조회는 기존 `wrangler.production.jsonc`와 D1을 사용한다. 로컬은 `npm run db:migrate`, 원격은 `npx wrangler d1 migrations apply weekend-mwohae-production --remote --config wrangler.production.jsonc`로 마이그레이션한다. 실제 수집은 `npm run tourapi:sync`이며 등록된 Cloudflare Secret만 사용한다.

## 자동 검증

- 타입 검사, 단위 테스트 9개, 기존 workerd/D1 통합 검사와 빌드.
- 여러 필드의 거절 사유와 원문 보존, 불가능한 날짜·시작일 역전·누락값 판정.
- 실제 격리 D1에서 거절 항목 6개 필드와 sync_run_id 외래키 확인.
- 정상 항목 수집과 거절 항목 저장, 전체 거절 및 중복 스냅샷 실패 기록.
- 행사 저장 실패를 강제로 발생시켜 정상 테이블 롤백과 거절 기록 보존 확인.
- 기존 Cron·취소 제외·기간/지역 필터·공개 가시성 검사 유지.

## 실제 수집 및 배포 검증

2026-09-18 UTC에 로컬·원격의 기존 D1에 0002 마이그레이션을 적용했다. 적용 전후 sqlite_master의 events·sources·event_evidence·event_tags·sync_runs 정의를 대조해 모두 동일함을 확인했다. 새 테이블 외에는 정상 행사 구조를 바꾸지 않았다.

첫 실행은 ldongCode2의 HTTP 522로 항목 조회 전에 실패했다. 해당 실패는 sync_runs의 `88d48027-eeb0-4957-b371-e803821ad77c`에 기록됐다. 이후 재시도 1회가 success로 완료됐다. 성공한 실제 동기화는 1회이며 합계 실행 시도는 2회다.

| 실제 검증 항목             | 값                                                   |
| -------------------------- | ---------------------------------------------------- |
| 성공 sync_run_id           | f6396827-3c14-4a64-8787-a04e4091fc4f                 |
| 시작 / 종료 (UTC)          | 2026-09-18T18:27:09.661Z / 2026-09-18T18:27:11.142Z  |
| 결과                       | fetched 916, imported 251, rejected 1, stale_count 0 |
| 거절 기록 ID / contentId   | 1 / 4067214                                          |
| 행사명                     | 2026 섬 방문의 해                                    |
| 실제 원문 값               | progresstype=온라인                                  |
| 거절 사유                  | UNSUPPORTED_PROGRESS_TYPE                            |
| 거절 시각 (UTC)            | 2026-09-18T18:27:10.797Z                             |
| 기존 원격 정상 행사 / 샘플 | 251 / 0                                              |
| 원격 외래키 오류           | 0                                                    |

기존 허용 상태값에 없는 ‘온라인’을 다른 개최 상태로 해석하거나 정상 행사로 저장하지 않았다. 전체 raw payload를 별도 테이블에서 조회했고 행사명·contentId가 원문과 같고 성공 sync_runs에 연결됨을 확인했다. 과거에 저장되지 않은 원문을 복원했다고 주장하지 않는다.

기존 Worker에 수정 로직을 배포해 향후 기존 Cron에서도 같은 기록을 남긴다. 배포 버전은 `d12e1ab8-fb39-4d72-8e2f-d97fa67294a5`, URL은 https://weekend-mwohae.framefutures.workers.dev 이며 Cron은 `0 21 * * *`로 유지했다. Static Assets는 기존과 동일하다. 자연 Cron 실행 관찰과 실제 수집 검증은 구분한다.

최종 공개 Chromium 데스크톱·모바일 회귀 테스트 12개가 26.1초에 모두 통과했다. 로컬·공개 API 기본 검사도 통과했다. 거절 원문 검증은 `test-results/real/rejection-verification.json`, 공개 브라우저 결과는 `test-results/rejections-deployed/browser-report.json`에 저장했다. 생성 결과는 Git에서 제외한다.

2026-09-18T18:30:28.264Z에 새 동기화 스냅샷의 로컬·공개 API 234회(고유 행사 123건) 대조와 HTML·JS·CSS 동일성 검사도 통과했다. 결과는 `test-results/real/parity.json`에 저장했다.
