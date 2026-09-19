# 프론트 통합 회귀 QA (Phase 5-0H)

## 범위와 제한

2026-09-19 기준 로컬 Vite와 Playwright mock API만 사용해 Phase 5 탐색 기능을 하나의 사용자 흐름으로 점검했다. 원격 D1 `SELECT`/`write`, 운영 API 반복 호출, TourAPI sync, 원격 migration, Cloudflare production 배포는 수행하지 않았다. 테스트 데이터는 기존 프론트 계약에 맞춘 로컬 mock과 기존 fixture를 사용했다.

## 통합 시나리오

자동화한 핵심 흐름은 다음과 같다.

1. 메인 진입 → 목록 첫 9개 → 더보기 18·27·36개
2. 36개 뒤 탐색 CTA → 카테고리 필터 위치 이동/포커스 → `체험` 선택 → 첫 batch 초기화
3. 첫 batch 복귀 → 다음 행사 보기 → 37번째부터 새 batch 시작
4. 두 번째 batch 행사 상세 진입 → 브라우저 뒤로가기 → batch 카드와 필터 상태 유지
5. 추가 page 실패 → 기존 카드 유지 → 실패한 page만 retry
6. desktop과 390px mobile에서 동일 흐름 실행

`tests/browser/integrated-regression-mock.spec.ts`에 위 흐름과 추가 page 오류 재시도 회귀를 남겼다. 로컬 Playwright 결과는 desktop 2건, mobile 2건으로 **4/4 통과**했다. 기존 별도 로컬 목록 QA에서 360px·390px·430px 및 1440px 3열 grid의 overflow와 36개/다음 batch 화면도 확인했다.

## 기능별 결과

### 필터와 날짜

날짜 preset(오늘·이번 주말·다음 주말)과 직접 날짜/기간은 기존 `period`, `date`, `startDate`, `endDate` URL 계약을 유지한다. 지역·검색·누구와·무엇을·비용·정렬 변경은 현재 effect를 통해 page 1, 첫 batch, 로드 page 1 상태로 초기화한다. `전국`은 빈 `region` query로 돌아간다. 직접 선택 날짜는 결과 범위와 조건 요약에 표시된다.

### 목록/정렬/묶음

`PAGE_SIZE=9`, `PAGES_PER_BATCH=4`, `MAX_VISIBLE_ITEMS=36` 상수를 공유한다. 프론트는 서버 page 순서를 다시 정렬하지 않으며 Phase 5-0F의 날짜 정렬 계약을 그대로 소비한다. 다음 batch는 page 5, 9, 13처럼 9개 단위로 시작하고 기존 카드 DOM을 교체한다. 같은 batch 안의 중복 event id는 한 번만 표시한다.

추가 요청 실패 시 전체 오류 화면으로 전환하지 않고 기존 카드와 retry를 유지한다. retry는 실패 page만 재요청한다. 요청 중 버튼은 비활성화된다. unit 경계 테스트는 total 0·1·7·9·18·27·36·37·72·120을 확인하며 36/37/120 경계와 9개 단위 범위를 검증한다.

### 상세 왕복과 상태 복원

상세는 현재 모달 route를 사용하고 `history.pushState`/`popstate`로 닫는다. 따라서 목록의 필터, batch, 로드 page, 카드 DOM은 컴포넌트에 유지되고 상세에서 뒤로 오면 첫 page부터 다시 fetch하지 않는다. 묶음 간 이동은 `batchProgress`에 로드 page와 scroll 위치를 저장한다. 공유 URL에 batch/scroll을 넣지 않아 새 방문자는 첫 batch로 시작한다.

### empty/error

- 결과 0: 조건에 맞는 행사가 없다는 empty state와 필터 초기화 동선을 표시한다.
- 데이터 범위 밖: `현재 등록된 행사 일정 범위를 벗어난 날짜입니다.`를 별도로 표시한다.
- 첫 API 실패: `잠시 연결이 어려워요`와 다시 시도를 표시한다.
- 추가 page 실패: 기존 결과를 유지하고 `추가 행사를 불러오지 못했어요`와 retry를 표시한다.
- 상세 not found와 상세 API 오류는 서로 다른 문구와 재시도 동선을 사용한다.

### 비용·동행·위치 상태

기존 snapshot 문서 기준 운영 비용 값은 모두 `unknown`이므로 무료/유료 filter를 선택해도 unknown이 양쪽에 섞이지 않는다. 운영 데이터 coverage가 확보되기 전에는 무료/유료 filter를 강한 발견 기능으로 홍보하지 않는 것이 안전하다. 현재 `누구와`는 기존 API의 audience query 계약을 표시할 뿐 companion suitability 운영 결과를 새로 연결하지 않는다.

`내 주변 찾기`는 브라우저 위치 권한을 사용하도록 이미 구현된 기존 기능이며, 권한 거부·미지원 시 오류를 표시하고 지역 필터를 훼손하지 않는다. 이번 QA에서 새 위치 기능은 추가하지 않았다.

## 모바일·데스크톱 QA

- 360px: 기존 로컬 viewport QA에서 날짜/필터/카드/CTA 가로 overflow 없음.
- 390px: 통합 Playwright 2건 통과, 9→36·CTA·다음 batch·오류 retry와 카드 레이아웃 확인.
- 430px: 기존 로컬 viewport QA에서 필터 wrapping과 CTA overflow 없음.
- tablet/desktop: 1440px 3열 grid에서 36개(12줄) 뒤 CTA가 목록 아래에 이어지고, 1440px mock 통합 흐름 통과.

이미지 영역은 기존 고정 비율/placeholder 정책을 유지하고 이번 작업에서 pipeline이나 crop 정책을 변경하지 않았다. 카드·상세의 이미지 실패 fallback은 기존 구현을 사용한다.

## 접근성·중복 요청

필터는 `label`, `aria-label`, `aria-pressed`를 사용하고 CTA/더보기/retry는 button semantics를 사용한다. CTA가 카테고리 영역으로 이동하면 필터 영역의 첫 버튼에 focus하고, 지역 CTA는 select에 focus한다. 로딩 중 추가 요청 버튼은 disabled다. mock 네트워크 기록에서 최초 목록, 필터 변경, page 추가, next batch, 상세 왕복, retry의 동일 page 불필요 중복은 발견되지 않았다. 개발 StrictMode 이중 effect와 production 요청은 별도로 구분했다.

## migration 0007 안전성

`migrations/0007_read_path_indexes.sql`은 아래 두 개의 `CREATE INDEX IF NOT EXISTS`만 포함한다.

- `idx_events_listing_order`
- `idx_event_tags_classifier_tag_event`

`DROP`, `DELETE`, `UPDATE`, destructive `ALTER`, table rebuild가 없으며 이번 단계에서는 원격 적용하지 않았다. 로컬 EXPLAIN 결과와 D1 read audit는 이전 단계 문서에 기록된 대로 목록 정렬과 tag lookup이 해당 index를 사용할 수 있음을 확인한다.

## 발견·수정·남은 문제

통합 실행에서 기능 버그 0건을 확인했다. 첫 QA assertion은 CTA가 포커스하는 실제 대상(카테고리 영역의 `모두` 버튼)과 달리 `체험` 버튼을 직접 기대하고 있어 테스트를 기존 접근성 계약에 맞게 수정했다. 제품 코드의 동작 변경은 없고, 경계값 unit test와 mock browser regression test만 추가했다.

남은 사전 배포 확인 사항은 운영 데이터에 의존한다.

- D1 quota 복구 후 최소 요청으로 실제 usage 증가량 확인
- production API가 main의 Phase 5 프론트/읽기 최적화 commit을 포함하는지 확인
- 실제 비용 값이 계속 unknown이면 무료/유료 filter의 사용자 노출 강도 재검토
- companion suitability는 운영 DB 미반영 상태를 유지하고 실제 필터처럼 노출하지 않기

## GitHub main과 production 차이

이번 turn에는 production API와 Cloudflare deployment metadata를 조회하지 않았다. 따라서 운영 version을 원격으로 단정하지 않는다. 현재 GitHub `main`에는 Phase 5-0A~0G 프론트 변경과 `bb2d933`의 D1 read-path guard/0007 migration이 포함되어 있으며, 이 변경들이 production에 배포됐는지는 다음 배포 직전 확인해야 한다. 배포 대상은 기존 Worker `weekend-mwohae`, D1 `weekend-mwohae-production`, 공개 URL을 유지한다.

## D1 복구 후 배포 체크리스트

1. D1 quota 정상화 확인
2. health 1회와 목록 첫 page 1회로 최소 usage 확인
3. 필요 시 migration 0007을 원격 적용하고 index 존재만 확인
4. 최신 GitHub `main` build와 민감정보 검사
5. 기존 Worker에 배포
6. health → 목록 → 더보기(`includeTotal=0`) → 상세 순서로 smoke 확인
7. 날짜·지역·콘텐츠·비용·검색·정렬과 모바일을 짧게 회귀 확인
8. D1 usage 증가량과 오류 로그 확인

이번 Phase에서는 위 절차를 준비만 했으며 production deploy와 원격 D1 접근은 0회다.
