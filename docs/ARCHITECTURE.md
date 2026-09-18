# 주말뭐해? 구조 설계

React + TypeScript → Cloudflare Static Assets → `/api/*` Worker → Cloudflare D1.
동일 도메인 API로 운영하며 Vite는 React 정적 번들 생성에 사용한다. 로컬은 실제 workerd와 D1 SQLite를 실행하는 Wrangler를 사용한다.

## 정보 정확성

공식 행사/주최기관(1), 지자체(2), TourAPI(3), 공공데이터포털(4) 순으로 출처를 선택한다. 원문 URL·원문 보관·확인 시각·필드별 근거·변경 이력을 함께 저장한다. 여러 출처가 충돌하면 높은 우선순위의 최신 근거를 검토하고 해결 전에는 게시하지 않는다. AI 생성값은 행사 사실로 입력하지 않는다.

실제 행사는 `verified` + 출처 URL + 확인 시각 + 필수 필드 근거가 있어야 노출한다. 확인 후 72시간이 지난 정보는 추천에서 제외하며 Cron이 `stale`로 전환한다. 취소·연기된 행사는 추천에서 제외하되 상세에서 상태를 보여준다. `scheduled`는 마지막 확인 상태이며 실시간 개최 보장이 아니다. 알 수 없는 비용·반려동물 정책은 `unknown`으로 보존하고 관련 필터에 매칭시키지 않는다. 동반자/주제 태그도 근거가 있는 경우에만 입력한다.

## D1

`events`: 날짜(한국 현지 날짜), 좌표, 지역, 비용, 행사 상태, 검증 상태, 샘플 여부.
`sources`: 출처 종류와 우선순위, URL, 확인 시각, 원문.
`event_evidence`: 일정·장소·가격·상태·태그 등의 필드별 근거.
`event_tags`: 동반자와 주제. `event_changes`: 감사 이력.
`sync_runs`: Cron 성공·실패·수집 비활성 이력.

날짜/지역/검증 인덱스로 조회하고 태그 조건은 EXISTS 바인딩 쿼리로 처리한다. 좌표가 있을 때 Haversine 직선거리를 계산하고 전체 매칭 결과를 정렬한 후 페이지를 나눈다. 이동시간/도로거리가 아니며 좌표가 없는 행사는 마지막에 표시한다.

## API

`GET /api/health`, `GET /api/meta`, `GET /api/events`, `GET /api/events/:id`.
목록 필터: `period=today|weekend|next-weekend`, `region`, `audience`, `cost`, `theme`, `q`, `sort=date|distance`, `lat`, `lng`, `page`, `limit`.
이번 주말은 해당 주 토·일(일요일은 같은 주말), 다음 주말은 그 다음 토·일. 진행 중인 다일 행사도 겹치는 구간으로 포함한다. 모든 입력은 허용 목록/범위를 검증한다.

## 수집과 운영 경계

매일 06:00 KST(21:00 UTC) Cron: 오래된 근거를 stale로 전환하고 실행 이력을 남긴다. TourAPI 어댑터는 준비 상태 확인만 구현되어 있으며 키가 있어도 실제 수집·게시하지 않는다. 후속 단계에서 API 계약 확인, 공식 원문 검토, 중복 처리, 충돌 검토, 필드 근거 저장 후 게시를 구현한다.

샘플은 명백한 가상 행사이며 기본 seed는 로컬 DB에만 적용한다. 실행 시점 기준 오늘/이번/다음 주말 샘플 날짜를 생성한다. 공개 샘플 검증을 위해서는 별도 `wrangler.sample.jsonc`의 `APP_MODE=sample`로 실제 원격 D1에 로컬 샘플 스냅샷을 복제해 배포한다. 실제 행사 운영 설정은 `APP_MODE=production`으로 샘플을 조회하지 않는다. 배포 스크립트는 실제 D1 ID 입력을 요구한다. TourAPI 키는 Worker Secret으로만 보관하고 프론트엔드 환경 변수에 넣지 않는다. 운영 데이터 입력용 공개 쓰기 API는 제공하지 않는다.
