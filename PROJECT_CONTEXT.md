# 갈틈 프로젝트 컨텍스트

> 마지막 갱신: 2026-09-22
>
> 이 문서는 대화 전체를 그대로 저장하는 로그가 아니라, 새 ChatGPT/Codex 세션에서도 작업을 바로 이어갈 수 있도록 **현재 상태·결정사항·운영 원칙·다음 작업**만 압축해 보존하는 handoff 문서다.

## 1. 프로젝트 정체성

- 사용자 공개 브랜드: **갈틈**
- 핵심 문구: **드디어, 놀러 갈 틈이 생겼다.**
- Header tagline: **오늘, 어디 가지?**
- 초기 핵심 사용 시나리오는 오늘 / 이번 주말 / 다음 주말 / 직접 날짜 선택 기반 행사·축제·체험 탐색이다.
- 브랜드는 주말에 한정하지 않는다. 향후 평일, 연휴, 방학, 팝업, 공연, 전시, 체험, 여행, 지역 콘텐츠까지 확장 가능해야 한다.
- 내부 관리용 프로젝트명은 **project-WTW**를 유지한다.

## 2. 공식 도메인과 내부 리소스

### 사용자 공개 주소

- 메인: **https://galteum.com**
- **www.galteum.com → galteum.com** 301 redirect를 Cloudflare Dashboard에서 설정했다.
- galteum.com은 기존 Worker에 Custom Domain으로 연결되어 있다.

### 유지할 내부 리소스

- GitHub: `framefutures-wq/project-WTW`
- branch: `main`
- Worker: `weekend-mwohae`
- D1: `weekend-mwohae-production`
- 기존 Cron과 Secrets 유지
- 내부 리소스 이름을 브랜드 변경 때문에 rename/recreate하지 않는다.

### 아직 남은 도메인 정리

- legacy Worker URL `https://weekend-mwohae.framefutures.workers.dev`는 코드/문서 일부에 남아 있다.
- 향후 host cutover 작업에서 legacy Worker host를 **galteum.com으로 301 redirect**하고 path/query를 보존한다.
- `WEB_PUSH_VAPID_SUBJECT`, README, Analytics/Search Console 문서를 galteum.com 기준으로 정리해야 한다.
- SEO foundation(행사 canonical URL, sitemap, robots, Event JSON-LD)은 production에 배포되며,
  Search Console sitemap 제출을 기다린다.

## 3. 운영 아키텍처

- Cloudflare Workers + Static Assets
- Cloudflare D1
- Cloudflare Cron Triggers
- Cloudflare Secrets
- React + TypeScript
- GitHub source of truth
- GitHub Codespaces + Codex CLI

Production Cron:

- 매일 10:00 KST base sync: `0 1 * * *` UTC
- 매일 11:00 KST TourAPI detail enrichment: `0 2 * * *` UTC
- 11시 detail run은 같은 KST 운영일의 10시 base run이 `success`로 끝난 것을 D1 `sync_runs`에서 자동 확인한 뒤에만 실행한다. 실패·running·누락이면 `tourapi-detail` run을 `skipped`로 기록하며, 일상적인 사람 승인은 필요 없는 Zero-Human 방식이다.

## 4. 데이터/정확성 원칙

공식 근거 우선순위:

1. 행사/주최기관 공식 홈페이지·공식 공지
2. 지자체
3. 한국관광공사 TourAPI
4. 공공데이터포털
5. 기타 공식 공공 출처

핵심 원칙:

- 일정·장소·가격·취소 여부 등 행사 사실을 AI로 만들어내지 않는다.
- 모르는 optional field는 `확인 필요` 행을 늘어놓지 말고 **UI에서 숨긴다**.
- optional 정보가 없다는 이유만으로 행사 자체를 막지 않는다.
- 취소·연기는 공식적으로 명시된 근거가 있을 때만 반영한다.
- 날씨나 listing disappearance만으로 취소 처리하지 않는다.
- 기존 게시 행사의 core 변경은 last-known-good를 유지하고 동일 변경을 후속 관측에서 재확인한 뒤 반영한다.
- 사람의 일상 검수/승인을 운영 루프에 넣지 않는다.

## 5. Zero-Human 운영 정책

Production decision states:

- `AUTO_PUBLISH`
- `AUTO_RETRY`
- `AUTO_EXCLUDE`
- `POLICY_SKIP`
- `EXPIRED`

운영 철학:

- 확실한 것은 자동 등록·자동 업데이트
- 애매한 것은 사람에게 묻지 않고 자동 retry
- 명확한 제외는 자동 제외
- NEARBY_ONLY는 현재 `POLICY_SKIP`
- 끝까지 불명확하면 자동 소멸
- source/parser 하나가 깨져도 다른 ingestion과 push를 막지 않는다.

## 6. 현재까지 완료된 핵심 기능

- TourAPI 자동 수집 / D1 저장 / Cron
- Municipal official source Zero-Human ingestion
- Private official source framework
- 한국민속촌 첫 private production source
- 날짜 기반 deterministic 추천순
- 추천 이유 배지
- Alert Engine
  - `NEW_EVENT`
  - `SCHEDULE_CHANGED`
  - `CANCELLED_OR_POSTPONED`
- Web Push
  - 조건 매칭
  - delivery queue
  - retry
  - dead subscription cleanup
  - service worker
- Analytics foundation
  - privacy-safe client tracking module
  - `/api/analytics/config`
  - GA4 + Cloudflare Web Analytics production enabled
- 공개 브랜드 리브랜딩: 주말뭐해? → 갈틈
- Custom Domain `galteum.com` 연결

## 7. Analytics 현재 상태

GA4와 Cloudflare Web Analytics는 production에서 활성화되어 있다. 기존 client-side
loader는 best-effort이며, 분석 장애가 앱/API/ingestion을 막지 않는다.

현재 정책:

- 정확한 GPS 좌표 전송 금지
- raw 검색어 전송 금지
- push endpoint/auth/key 전송 금지
- User-ID 사용 금지
- 광고/리마케팅 용도 아님

Search Console domain property `galteum.com`은 DNS ownership verification까지 완료됐다.
SEO sitemap 배포 뒤 사용자가 Search Console에 `sitemap.xml`을 제출한다.

## 8. TourAPI Zero-Human Detail Enrichment

일반 TourAPI 행사의 상세가 지나치게 빈약한 문제가 확인됐고, 현재 `main`에는 자동 상세 보강 코드가 추가되어 있다.

관련 commit:

- `2dcc976` — `feat: enrich TourAPI event details automatically`

구현 내용:

- TourAPI `detailCommon2`
- TourAPI `detailIntro2`
- TourAPI `detailInfo2`
- 행사별 상세 상태 추적용 additive migration `tourapi_detail_state`
- 1회 최대 25 events
- 1회 최대 75 TourAPI detail requests
- 성공 detail refresh TTL 7일
- 실패 시 bounded exponential retry
- detail subsystem 실패가 TourAPI base ingestion / municipal / private / push 전체를 막지 않도록 격리
- 공식 organizer/municipal 등 더 높은 priority enrichment가 있으면 TourAPI detail이 덮어쓰지 않음
- TourAPI list sync가 detail에서 확인된 venue/price를 다음 base sync에서 되돌리지 않도록 보호

현재 자동 보강 대상:

- 행사 소개: `detailCommon2.overview`
- 행사장: `detailIntro2.eventplace`
- 행사별 비용: `detailIntro2.usetimefestival` 중 명확히 판정 가능한 값
- whole-event 운영시간: 단일 명확한 `HH:MM~HH:MM` 형태만
- 프로그램: `detailInfo2` 중 stable serial + 명시적 프로그램 구조인 항목만
- 문의: detail common/intro의 공식 전화 필드를 detail API에서 우선 사용

정확성 원칙:

- generic/category prose를 프로그램으로 오인하지 않는다.
- detailInfo2의 여러 설명 블록을 임의의 일정으로 만들지 않는다.
- 전체 행사 운영시간과 개별 프로그램 시간을 섞지 않는다.
- 불명확한 fee/time/program은 저장하지 않는다.
- optional field가 비어도 행사 core publish를 막지 않는다.

중요:

- 이 기능은 코드가 `main`에 존재한다는 사실과 production에서 migration/deploy/first run이 모두 정상 완료됐다는 사실을 구분해야 한다.
- **production 검증 완료 (2026-09-21):** migration `0020_tourapi_detail_state.sql` 적용, Worker deployment `30f67067-8a51-4927-bf6e-90a5d597199d`, 첫 bounded run 성공.
- 첫 run 결과: candidates 25, requested 75, enriched 16, empty 0, failed 9. 실패 9건은 failure_count 1 및 2시간 bounded retry로 보존됐고 base TourAPI/municipal/private/push flow를 막지 않았다.
- production D1에는 detail success 16건과 failed 9건이 기록됐다. detail source summary 12건, whole-event hours 5건이 저장됐고 detail source program row는 0건이다. 즉 `행사소개`/`행사내용` category prose를 program으로 오인하지 않았다.
- `https://galteum.com`에서 5개 enriched detail을 desktop/mobile로 확인했으며, summary·hours·price 등 값이 있는 섹션만 표시되고 console error는 0이었다.

## 10. 상세 관련 현재 코드 포인트

Frontend:

- `src/App.tsx`
  - `detail.enrichment?.summary`
  - `detail.enrichment?.highlights`
  - `detail.enrichment?.programs`
  - `detail.operating_hours`
  - `usefulDescription()`

Detail API:

- `worker/index.ts`
  - `GET /api/events/:id`
  - enrichment/highlights/programs/occurrences/operating_hours를 D1에서 조회

TourAPI:

- `worker/sources/tourapi.ts`
  - base list snapshot 기반 core event 저장
  - detail enrichment가 확인한 venue/price를 후속 base sync가 되돌리지 않도록 보호

자동 detail enrichment:

- `worker/sources/tourapi-detail.ts`
  - `detailCommon2`, `detailIntro2`, `detailInfo2`
  - bounded candidate selection / refresh TTL / retry / priority protection
- `worker/cron.ts`
  - 10시 base TourAPI·stale maintenance·municipal·private·alert/push flow와 11시 detail-only flow를 분리
  - detail은 당일 base 성공 확인 후에만 실행하며 각 결과를 `sync_runs.provider='tourapi-detail'`로 별도 기록

Read-only provider audit:

- `scripts/tourapi-detail-audit.mjs`
- `scripts/official-source-details-worker.ts`

기존 수동 enrichment:

- `scripts/enrich-selected-events.mjs`
  - 대표 5개 이벤트 전용
  - 역사적/대표행사 보강용 폐쇄형 스크립트로 유지

Audit:

- `scripts/audit-event-detail-completeness.mjs`
- `shared/event-detail-completeness-audit.ts`

## 11. 로드맵

완료:

- Phase 1~10: 기반/수집/Zero-Human
- Phase 11: Recommendation
- Phase 12: Alerts + Web Push
- Phase 13: Private official source pilot
- Analytics foundation
- 갈틈 리브랜딩
- galteum.com 구매/Custom Domain 연결
- 10시 base / 11시 detail 스케줄 분리
- GA4 + Cloudflare Web Analytics production enabled
- Search-ready event pages, canonical metadata, sitemap, robots, Event JSON-LD

현재 우선순위:

1. Search Console에 `sitemap.xml` 제출
2. 무료 공개 후 실제 traffic 관찰
3. 행사/지역 coverage 확대
4. 수익화는 traffic 확보 뒤 진행

수익화는 현재 보류한다.

## 12. Git / 작업 종료 규칙

- 정상 완료 시 relevant tests → git status/diff → secret check → commit → push main
- Worker/API/frontend/production behavior 변경이면 기존 Worker에 deploy 후 public verify
- docs/tests/dev scripts만 변경이면 불필요한 Cloudflare deploy 금지
- D1 파괴적 변경은 사용자 승인 전 자동 실행 금지
- 실패한 테스트, 미완성 작업, Secret 노출 가능성, destructive migration, resource replacement 필요 시 자동 종료 절차 중단

## 13. 최근 기준점

주요 최근 commit:

- `2dcc976` — `feat: enrich TourAPI event details automatically`
- `716f5f2` — `feat: rebrand public service as 갈틈`
- `d3c4026` — `feat: add privacy-safe analytics foundation`
- `8bb3346` — private source description safety fix
- `8c13a85` — Korean Folk Village private source

이 문서를 읽을 때는 GitHub의 최신 `main`을 항상 다시 확인하고, commit hash나 운영 데이터 count처럼 변할 수 있는 값은 현재 상태를 우선한다.

## 14. UI 탐색 구조 최신 상태 (2026-09-22)

- UI 벤치마크 방향은 Klook의 탐색 효율, Fever의 비주얼 감성, 갈틈의 공식정보 신뢰성을 결합한다.
- PC 홈은 검색 우선 구조로 개편했다.
- 히어로 검색 → 빠른 카테고리 → 날짜/지역/세부필터 → 행사 목록 순서다.
- 스크롤 후에는 sticky header가 compact 검색으로 전환된다.
- 기존 전역 지역/카테고리 퀵 스위치를 유지하고, 중복 sticky 컨트롤은 제거했다.
- 데스크톱 콘텐츠 폭은 1280px 기준으로 조정했고 4열 카드, 모바일 2열을 유지한다.
- 초기 화면은 1920×900 / 100% 기준 자동 회귀 테스트를 추가했다.
  - 히어로 높이 230px 이하
  - 빠른 카테고리 카드 높이 54px 이하
  - production 기준 첫 행사 이미지가 Y=820px 이전에 시작
  - 가로 overflow 없음
- 최신 홈 UI는 큰 포스터형 첫 화면을 낮은 검색 배너형으로 바꿨고, 1365×768 / 1920×900 데스크톱 기준 첫 행사 노출과 가로 overflow를 자동 검증한다.
- 행사 상세는 Klook/GetYourGuide의 정보 위계를 참고해 **결정 우선형**으로 개편했다.
  - 대표 이미지 + 핵심정보 2열 데스크톱 상단
  - 일정 / 운영시간 / 장소 / 비용 / 문의를 소개문보다 먼저 노출
  - 공식 안내 CTA를 핵심정보 영역에 배치
  - 소개 / 볼거리 / 주요 일정 / 프로그램은 아래 콘텐츠 영역
  - 모바일은 이미지 → 핵심정보 → 소개/프로그램의 단일 컬럼
  - 모르는 optional field는 기존 원칙대로 숨긴다.
- 최신 상세 UI main commit: `934bb92a`
- 모바일 홈·상세 전체 흐름은 Playwright 실제 브라우저 CI로 검증한다.
  - desktop 1440×1000 / mobile 390×844
  - 초기 화면 1365×768 / 1920×900
  - sticky 검색 전환과 데스크톱 검색/지역 버튼 비겹침
  - 모바일 홈 → 상세 → 출처까지 흐름
  - 상세 dialog 가로 overflow와 핵심정보 우선 위계
- 샘플 seed도 현재 deterministic fact/companion classifier 계약에 맞췄다.
- 기간 변경 시 결과 제목이 실제 선택 기간과 맞도록 보정했다.
- 최신 모바일/브라우저 QA main commit: `176d1b0e`
- 행사/지역 coverage 확대를 시작했다. 한 번에 한 소스씩 공식 목록 안정성·파서 안전성을 확인해 추가한다.
- 2026-09-22 기준 부천시 공식 **부천페스타·가을 > 9월~10월 기타 축제 및 행사**를 municipal source로 추가했다.
  - source key: `bucheon`
  - canonical list: `https://www.bucheon.go.kr/site/homepage/menu/viewMenu?menuid=145007003`
  - 연도/기간/장소/주요내용만 보수적으로 파싱
  - per-event detail URL이 없는 공식 city schedule로 취급
  - 기존 duplicate/retry/last-known-good/Zero-Human gate를 그대로 적용
  - main commit: `87cc6419`
- 다음 coverage 작업은 **다음 공식 소스 1개를 조사·추가**하는 것이다.

## 15. 현재 즉시 이어갈 상태 (2026-09-22)

- 최신 기능/UI 코드 기준 commit: `367dedd6` — `UI: stabilize detail image frame`
- GitHub Actions run `35704201196`: **success**
- 이 수정은 상세페이지 이미지가 좁고 세로로 길게 눌려 보이던 문제를 겨냥했다.
  - legacy `styles.css`의 600px detail dialog 제한을 최신 `redesign.css`에서 확실히 override
  - 상세 이미지 프레임을 bounded 4:3 중심으로 안정화
  - 세로 포스터 이미지의 과도한 blurred side fill을 완화
  - 상세 이미지 프레임 회귀테스트 추가
- 사용자에게서 확인된 직전 문제:
  - 상세페이지 자체 정보 구조보다 **대표 이미지 표현이 부자연스러운 것이 가장 큰 문제**였다.
  - 스크롤 후 홈 sticky UI는 현재 정상으로 평가됐다.
  - 홈 첫 화면도 큰 포스터형에서 낮은 검색 배너형으로 정리되어 해결된 상태다.
- 이 대화에서는 `367dedd6`의 **production deploy 완료 로그를 아직 확인하지 못했다.**
- 새 세션의 첫 실무 순서:
  1. 최신 `origin/main`과 Actions success 재확인
  2. `367dedd6` 이후 추가 commit이 없다면 production 배포 필요 여부 확인
  3. 배포 후 상세 이미지 프레임을 코드/production smoke 기준으로 확인
  4. 상세 UI가 안정되면 **지자체 상세보강(부천부터) → 다음 공식 지역 coverage** 순서로 진행
- 부천 municipal source는 main에 들어가 있다.
  - source key: `bucheon`
  - 기본 수집은 행사명/날짜/장소/주요내용 중심
  - 다음 데이터 작업은 부천 공식 보도자료/행사별 페이지를 안전하게 연결해 대표이미지/운영시간/상세소개/문의 등을 보강하는 방식이 유력하다.

## 16. 새 세션 시작 방법

새 ChatGPT/Codex 세션에서는 먼저:

1. `AGENTS.md` 확인
2. **`PROJECT_CONTEXT.md` 확인**
3. 최신 `origin/main` 확인
4. working tree 확인
5. 이 문서의 "현재 우선순위"와 실제 repo 상태가 일치하는지 검증
6. 이전 대화 전체를 다시 재구성하려 하지 말고 이 문서를 handoff 기준으로 사용

이 문서는 중요한 제품 결정이나 운영 상태가 바뀔 때 갱신한다.
