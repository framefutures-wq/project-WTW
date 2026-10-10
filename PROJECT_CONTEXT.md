# 갈틈 프로젝트 컨텍스트

> 마지막 갱신: 2026-09-23
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

Production Cron 현재 상태:

- 매일 10:00 KST base sync: `0 1 * * *` UTC
- 매일 11:00 KST TourAPI detail enrichment: `0 2 * * *` UTC
- retry recovery: 매일 11:45 / 13:50 / 17:55 KST (`45 2 * * *`, `50 4 * * *`, `55 8 * * *` UTC)
- 현재 11시 detail run은 같은 KST 운영일의 10시 base run이 `success`로 끝난 것을 D1 `sync_runs`에서 확인한 뒤 실행한다.

2026-10-08 운영 변경:
- 10:00 base invocation은 TourAPI base sync → base finalize → 성공 시 TourAPI detail `base_handoff`만 수행한다. municipal, private official, official-detail recovery는 실행하지 않는다.
- municipal shard 0/1/2는 각각 11:00 watchdog / 11:45 retry / 13:50 retry window로 분리한다. private official은 17:55 retry window에서 실행한다.
- official-detail recovery는 11:00, 11:45, 13:50, 17:55 later windows에서 base 상태와 독립적으로 실행한다. 10/05~10/08 stuck base rows는 보존하며 수정하지 않았다.

2026-10-10 scheduled-window observability update:
- watchdog/retry runs create a `sync_runs` invocation ledger before municipal, official-detail, or private work; its message records trigger and phase (`started`, `municipal`, `official_detail`, `private`, `tourapi_detail`, `finished`).
- A prior hard-terminated window ledger does not block the next window's municipal/official-detail/private work. TourAPI detail retains its own concurrent-run protection.
- Scheduled official-detail recovery has a 90-second wall-clock budget. It clamps direct/Reader/poster work to remaining time and returns a budget-exhaustion result before the platform deadline, allowing later private and TourAPI-detail subsystems to continue.
- Base missing/running/failed still finalizes the current window ledger with subsystem results while skipping only TourAPI detail. Await natural production-window verification after deployment.

Zero-Human v2 (production 배포 완료):

- 10시 base 완료 후 11시까지 기다리지 않는다.
- base에서 새 행사/변경 행사가 확인되는 즉시 detail 단계로 자동 handoff한다.
- 전체 base가 10:05에 끝났다면 detail도 10:05부터 진행한다.
- 11:00 Cron은 주 작업이 아니라 미완료·실패·재시도 대상을 보충하는 watchdog 역할로 유지한다.
- 이미 완료한 detail을 11시에 중복 처리하지 않도록 상태 기반 idempotency를 유지한다.

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
- 실패 시 bounded exponential retry (첫 실패 30분, 이후 2/4/8/16시간, 최대 24시간)
- 후보 우선순위: retry-due failed → never-processed → TTL refresh. 각 그룹 안에서는 진행중·시작일·id 순서를 유지한다.
- `sync_runs.message`에는 민감 원문 없이 `failure_reasons` category 집계가 남는다.
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
  - 10시 base TourAPI·stale maintenance·push flow를 municipal/private/official-detail later windows와 분리
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

## 작업 운영 계약

- 프롬프트 작성, 모델 선택, 작업 크기, 테스트·CI·배포·최종보고 규칙은 `docs/WORKING_RULES.md`를 따른다.
- 새 세션에서도 이 문서를 먼저 읽고 가장 낮은 충분한 모델(Luna → Terra/Medium → 필요한 경우에만 Sol/High)을 선택한다.

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

1. 태백시 전체일정캘린더와 서울 한강 행사·공연 정보의 `generic_fallback` onboarding을 완료했다. 태백시의 행정·회의·교육 등 비행사 일정은 exclusion gate로 차단하고, 서울 한강은 source card의 명시적 축제·문화예술·공연 category만 후보로 허용한다.
2. **홈 UI v2와 상세 UI v2 production release를 완료했다.** 새로운 회귀가 없는 한 다시 열지 않는다.
3. **TourAPI detail backlog/recovery는 관찰 대기 상태다.** 2026-09-23 최신 read-only snapshot은 대상 219 / success 123 / empty 0 / failed 18 / never_processed 78, retry-due 18 / retry-waiting 0이다. 다음 실제 scheduled watchdog은 2026-09-24 11:00 KST이며, 그 전에는 manual detail run이나 TourAPI detail 코드 변경으로 관찰 조건을 섞지 않는다.
4. **공식 상세 enrichment 품질 강화는 위 scheduled recovery 확인 전까지 보류한다.** TourAPI detail 계통은 동결한다.
5. **현재 작업 위치는 전국 municipal/source coverage 확대다.** TourAPI detail과 독립적인 범위에서 공식 source를 한 번에 하나씩 조사·onboarding한다. `generic_fallback`은 전용 parser 없이 allowlisted 공식 HTTPS source의 JSON-LD / PDF / image 및 self-contained HTML table row / list item / card에서 진입하며, 불명확한 core는 기존 retry·confirmation/last-known-good 정책을 유지한다. 상세 survey: `docs/municipal-source-survey-2026-09-22.md`.
6. Search Console `sitemap.xml` 제출 상태 확인 → 무료 공개 traffic 관찰 → traffic 확보 뒤 수익화 순서로 진행한다.

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
- 상세 이미지 수정의 production 반영은 **2026-09-22 완료**됐다.
  - 배포 기준 HEAD: `4b8bc6631ff99243407ef67eed6632567b80303d`
  - Cloudflare Version ID: `5e2d5068-a88d-49f0-b059-3a89ef3f880c`
  - production smoke 통과
  - production UI desktop/mobile 2/2 통과
  - 실제 `galteum.com` 상세 대표이미지 조건 desktop 높이 ≤360px·비율 1.15~1.5, mobile 높이 ≤300px·비율 >1.15 통과
- 이후 dev dry-run에도 Bucheon source를 포함하도록 `scripts/municipal-discover.mjs`를 보완했다.
  - main commit: `e740bf0f`
  - Project checks: success
  - production behavior 변경이 아닌 dev QA 보완이라 추가 Cloudflare deploy는 하지 않는다.
- 다음 실무 순서:
  1. 최신 `origin/main`과 Actions success 확인
  2. **지자체 상세보강(부천부터)** 진행
  3. core 일정/장소와 충돌하는 공식 상세자료는 덮어쓰지 않고 last-known-good/재시도 원칙 유지
  4. 부천 보강이 안정되면 다음 공식 지역 coverage 추가
- 부천 municipal source는 main에 들어가 있다.
  - source key: `bucheon`
  - 기본 수집은 행사명/날짜/장소/주요내용 중심
  - 공식 상세자료 사전조사 결과:
    - 시민어울림한마당 전용 관광 페이지는 2026-10-09 및 문의처 등 core와 일치하는 상세정보를 제공
    - 복사골청소년예술제는 canonical 가을 목록/최근 안전관리 보도자료가 2026-10-10, 별도 관광 페이지가 2026-10-11로 공식 소스 충돌 상태
    - 2026 부천페스타 가을 공식 소셜 안내에는 제13회 부천시민 자전거대축제 2026-10-24 13:00~16:00이 명시됨
  - 다음 데이터 작업은 **canonical core는 유지하고 충돌 없는 공식 상세자료만 non-core enrichment에 연결**해 운영시간/상세소개/문의/이미지 후보를 보강하는 것이다.

## 16. 새 세션 시작 방법

새 ChatGPT/Codex 세션에서는 먼저:

1. `AGENTS.md` 확인
2. **`PROJECT_CONTEXT.md` 확인**
3. 최신 `origin/main` 확인
4. working tree 확인
5. 이 문서의 "현재 우선순위"와 실제 repo 상태가 일치하는지 검증
6. 이전 대화 전체를 다시 재구성하려 하지 말고 이 문서를 handoff 기준으로 사용

이 문서는 중요한 제품 결정이나 운영 상태가 바뀔 때 갱신한다.

## 17. Municipal Zero-Human v2 결정 (2026-09-22)

### 목표

- 전국 지자체 행사 수집을 사람의 일상 검수 없이 운영한다.
- 특정 지자체 5곳만 관리하는 것이 목표가 아니라, 전국 coverage를 늘려도 사람이 매일 소스를 확인하지 않아도 되는 구조를 만든다.

### 문제 인식

- 지자체별로 홈페이지 구조가 다르고, 같은 지자체도 다음 공지에서 HTML / table / PDF / 이미지 포스터 등 형식을 바꿀 수 있다.
- 지자체별 고정 HTML parser를 계속 추가하는 방식은 전국 확장 시 유지보수 병목이 된다.
- parser 실패나 format 변경을 '행사 없음'으로 오판하면 기존 데이터를 잘못 지울 수 있다.

### v2 원칙

- 공식 Source Registry를 두고 source URL/정책/신뢰도/허용 host를 관리한다.
- 문서 형식 변화를 감지한다.
- HTML / table / structured data / PDF / image 등의 extractor를 공통 Event Candidate 형태로 수렴시킨다.
- 추출 실패는 source failure/AUTO_RETRY로 처리하고 기존 last-known-good를 유지한다.
- 확실한 candidate만 AUTO_PUBLISH한다.
- 애매한 후보를 사람 검수 큐로 보내지 않는다.
- source 하나의 장애가 다른 source, TourAPI, private source, push 흐름을 막지 않는다.
- 이미지/PDF 기반 정보도 core 날짜·장소를 불확실하게 추측해서 저장하지 않는다.

### 스케줄/오케스트레이션 결정

- 10:00 KST base sync가 시작점이다.
- source/candidate 처리 완료 시 상세보강 대상은 즉시 다음 단계로 handoff한다.
- base 전체 완료 시각이 10:05라면 detail 작업도 즉시 시작한다.
- 11:00 KST Cron은 pending/failed/retry 대상만 확인하는 watchdog/recovery로 남긴다.
- D1 상태를 기준으로 idempotent하게 동작해 동일 detail을 중복 처리하지 않는다.

### 다음 구현 순서

1. 현재 `worker/cron.ts`, `sync_runs`, detail state와 충돌 없이 즉시 handoff 가능한 구조 설계.
2. 11시 detail Cron을 recovery/watchdog 역할로 재정의.
3. municipal Source Registry와 format detection/extractor 인터페이스 설계.
4. bounded concurrency/queue가 필요한 규모와 Cloudflare 신규 resource 필요 여부 검증.
5. 신규 Queue 등 production resource가 필요하면 비용/설정/마이그레이션을 먼저 확인하고 사용자 승인 후 생성.
6. 부천을 첫 v2 검증 source로 사용하되 부천 전용 예외 코드를 계속 쌓지 않는다.
7. 테스트 → Actions → 기존 Worker 배포 → production smoke/detail 검증 순서로 완료한다.

## 18. Municipal Zero-Human v2 구현 상태 (2026-09-22 최신)

main 구현 완료:

- 10시 base 성공 직후 detail 즉시 handoff + 11시 watchdog/recovery.
- municipal Source Registry 단일화.
- parser contract / format-change 감지 / 공식 host allowlist.
- format 변경 시 공식 JSON-LD Event explicit-core fallback.
- 공식 PDF/image attachment fallback 기반.
  - source당 최대 3개 파일.
  - 파일당 최대 5 MiB.
  - 외부/HTTP attachment 거부.
  - PDF는 명시적 행사명/기간/장소만 사용.
  - 이미지 첫 판독은 AUTO_RETRY.
  - 다른 한국 날짜에 동일 core payload hash가 다시 관측될 때만 image confirmation 통과 가능.
  - same-day 반복이나 payload 변경은 confirmation으로 인정하지 않음.
- D1 migration 없음.
- 신규 Cloudflare resource 없음.

주요 merge 기준:

- immediate detail handoff 계열: 6f41ee49
- source registry: 13088dfb
- structured fallback: 8e4f0dbd
- PDF/poster fallback: bd16a75d
- PR #23 최종 Project checks / UI browser smoke success 후 merge.

Production 주의:

- 2026-09-22 `dd9b0f9` 기준 최신 main을 기존 Worker에 배포했다. Cloudflare version ID: `97a35df2-86d7-41b7-837d-7e522f7d0b1e`.
- 전체 check(단위 테스트 174개, 통합 검사, build), `https://galteum.com` production smoke, desktop/mobile production UI가 통과했다.
- 기존 D1 binding과 10시/11시 Cron은 유지됐다. 실제 다음 scheduled run의 운영 결과는 별도 관찰 대상이다.
- Workers AI binding의 현재 production 상태는 아래 §19를 따른다.

## 19. Workers AI 비용 가드 (2026-09-22)

- main commit: bbd6167c4aa58a7daf165c02e930d957251f6f28
- `MUNICIPAL_DOCUMENT_AI_ENABLED` 런타임 kill switch 추가.
- `wrangler.production.jsonc`의 production 값은 `true`.
- `worker/sources/municipal.ts`는 이 플래그가 정확히 `true`일 때만 AI binding을 문서 변환기로 전달한다.
- AI binding이 존재하더라도 flag=false면 PDF/image fallback은 AI 호출을 하지 않는다.
- 2026-09-22 사용자 요청으로 기존 `weekend-mwohae` Worker에 AI binding과 flag=true를 배포했다. 코드 commit `ef7f76c11c9657088c481627ea18f376d0fbfe5b`, Cloudflare Version ID `2df9c820-c6a8-492f-bb4f-401fe8960611`.
- 배포 로그에서 `env.AI`와 `MUNICIPAL_DOCUMENT_AI_ENABLED ("true")`를 확인했다. production smoke와 desktop/mobile UI 2/2가 통과했다. D1 데이터 삽입이나 Cron 강제 실행은 하지 않았다.

## 20. UI / 상세 v2 제품 결정 (2026-09-23)

> 세부 고정 설계 계약: `docs/UI_V2_DIRECTION.md` — UI 작업 전 반드시 읽고, 새 세션에서도 대화 기억보다 이 문서를 우선한다.

### 작업 순서

- 현재 usage limit으로 끊긴 municipal onboarding 작업을 먼저 마무리한다.
- 그 다음 데이터 coverage 확대를 잠시 멈추고 **홈 / 카드 / 상세 / 모바일 UI를 한 디자인 시스템으로 정리**한다.
- UI v2 첫 bounded task로 홈과 행사카드의 시각체계를 완료했다. `src/redesign.css`에서 웜 아이보리 canvas·차콜 본문·절제된 오렌지 CTA/선택 상태를 적용했으며, PC 4열·모바일 2열 및 검색/필터 동작은 유지했다.
- UI/상세 v2가 안정된 뒤 상세 enrichment 품질 확대와 전국 coverage 확장을 재개한다.

### 톤앤매너 / 컬러 시스템

갈틈의 목표 인상은 **따뜻한 여행 감성 + 선명한 결정감 + 공식정보 신뢰**다.

- background / canvas: 웜 아이보리 `#F7F4EE`
- primary ink / structure: 차콜 `#171A1D`
- secondary ink: `#343A40`
- brand accent / discovery / primary action: 따뜻한 오렌지 `#F26B38` 계열
- official / verified trust state: 절제된 딥그린
- card surface: 흰색 또는 사진 중심
- 회색 텍스트는 현재보다 명도를 낮춰 가독성을 높인다.
- 감각적 비율은 neutral 70 / photo+charcoal 20 / orange accent 10 정도를 기준으로 한다.
- 아이보리는 브랜드 포인트가 아니라 **배경 canvas** 역할이다.
- 초록은 브랜드 전반에 흩뿌리지 않고 **공식 확인·신뢰 상태에만 제한**한다.
- 현재처럼 초록/보라/베이지/검정이 혼재해 브랜드 색이 불명확한 상태를 정리한다.

UI benchmark:

- **Klook**: 탐색 효율 / 검색·필터 / 카드 밀도
- **Fever**: 이미지 존재감 / 감성적 비주얼 톤
- **GetYourGuide**: 상세 정보 위계 / 핵심 CTA 구조
- 갈틈 고유 강점: **공식정보 신뢰성과 변경 추적**

### UI 구조 원칙

- 홈은 검색과 행사 이미지가 주인공이다.
- 버튼·테두리·칩을 줄여 관리화면 같은 인상을 제거한다.
- 행사 카드 기본 위계는 **이미지 → 추천 이유 → 행사명 → 날짜 → 장소**다.
- 추천 영역은 일반 목록과 시각적으로 구분한다.
- 모바일은 PC 축소판이 아니라 별도 정보 밀도와 가독성으로 조정한다.
- 박스 수를 늘리는 대신 이미지, 타이포, 명도 대비, 여백으로 위계를 만든다.
- 현재의 “맹하고 평평한 느낌”을 없애는 것을 UI v2의 명시적 품질 목표로 둔다.

### 상세페이지 정보구조 v2

상세 기본 순서:
**대표사진 → 제목 → 언제/어디서 → 공식 안내 CTA → 볼거리 → 시간표 → 프로그램 → 소개 → 지도/주변행사 → 출처**

- 날짜·장소·문의 등을 동일한 회색 박스로 나열하지 않는다.
- 사용자가 가장 먼저 판단하는 **언제 / 어디서**를 더 강하게 노출한다.
- 주요 일정은 문장 나열 대신 **timeline**으로 표현한다.
- 프로그램은 개별 **card**로 구성해 실제 콘텐츠 양이 보이도록 한다.
- 공식 출처 / 마지막 확인 정보는 본문 하단으로 내린다.
- optional 정보가 없으면 `미확인` 박스를 만들지 않고 **섹션 자체를 숨긴다**.
- 정보량에 따라 상세 레이아웃이 자연스럽게 압축/확장되는 adaptive 구조로 만든다.

### 상세 데이터 3층 구조

상세 페이지를 풍성하게 만들되 사실을 창작하지 않는다.

1. **공식 사실**
   - 행사명, 날짜, 시간, 장소, 프로그램, 요금, 주차, 문의 등 공식 근거가 있는 정보.
2. **갈틈이 안전하게 계산·재구성한 정보**
   - 요일, 행사 기간, D-day, 진행중/예정, 오늘 볼 수 있는 프로그램, 날짜별 일정 재구성, 위치 기반 거리 등.
3. **갈틈이 연결한 탐색 정보**
   - 같은 날짜/지역 행사, 같은 장소의 다른 행사, 비슷한 테마 행사, 주변 행사 등.

주차 가능 여부, 반려동물 가능, 입장료, 프로그램 내용처럼 새로운 사실은 공식 근거가 없으면 생성하지 않는다.

### 상세 미디어 fallback 정책

갈틈은 갤러리 칸을 채우기 위해 **AI로 실제 행사 현장·장소·프로그램 모습을 상상 생성하지 않는다.**

미디어 우선순위:

1. 행사/주최기관의 공식 대표 이미지.
2. 사용 권한과 공식 출처를 확인할 수 있는 공식 추가 이미지.
3. 이미지가 적으면 갤러리 수를 줄이고 **레이아웃 자체를 이미지 수에 맞게 변경**한다.
4. 공식 이미지가 0장이면 갈틈의 타이포·도형·카테고리 아이콘으로 만든 **명백한 정보형 브랜드 그래픽**을 사용할 수 있다.
5. 실제 행사 사진으로 오인될 수 있는 AI 생성 현장 이미지, 임의 장소 이미지, 출처/권리 불명 이미지는 fallback으로 사용하지 않는다.

예:

- 4~5장: 풍성한 gallery
- 2장: main 1 + secondary 1
- 1장: 한 장을 크게 사용하는 완성형 layout
- 0장: 날짜/지역/카테고리/공식정보 중심의 갈틈 브랜드 graphic + 정보 중심 상세

이미지가 부족한 경우 빈 썸네일 슬롯을 만들지 않는다. 사진 대신 timeline, 지도, 공식 fact, 프로그램 카드, 주변행사 등 **검증된 정보의 시각화**로 밀도를 만든다.

### UI v2 production closure history (2026-09-23)

- 상세 UI v2(1장/0장 fallback, 주변·비슷한 행사, 공식 추가 이미지 API, 2장 adaptive media)를 production에 반영했다.
- production D1 migration `0021_event_additional_images.sql`을 additive로 적용하고, 기존 `sources.raw_payload.firstimage2`만으로 TourAPI secondary image 263건을 backfill했다. 기존 `event_images`는 263 rows / `ok` 263으로 전후 동일하다.
- Worker `weekend-mwohae` production version `b0cc4224-a334-466d-bf4f-4775ee41dc7f`에 main `096ea81`을 배포했고, `galteum.com` API 및 desktop/mobile 2장 상세를 검증했다. 이는 현재 production 이전의 역사적 intermediate release다.
- 최종 상세 media 수정은 `eaa56db` — `fix: preserve secondary detail poster` — 로 반영했고, production Worker version은 `b7ad1cae-cf68-4f3b-aac6-0ac8e4c2c13e`다.
- 최종 production smoke는 desktop/mobile 모두 통과했다. `c496d96` — `test: align production detail media smoke` — 는 adaptive layout 구조에 맞춘 test-only commit이며 production 재배포는 하지 않았다.
- 실제 production 검증은 서울 왕궁수문장 교대의식 rich detail + 2 images, 2026 화성행궁 야간개장 portrait secondary poster, 2026 수원화성 미디어아트 0-image fallback을 desktop/mobile에서 완료했다. 실제 1-image 행사는 현재 production 데이터에 없어 local/자동 테스트로만 검증했다.
- 다음 우선순위는 TourAPI detail backlog 소진/recovery 확인과 공식 상세 enrichment 품질이다. 4~5장 gallery는 공식 이미지 3장 이상이 실제로 확보될 때만 확장한다.


## 21. 2026-09-23 최신 현재 위치 — 홈 UI v2 / 상세 UI v2 production 완료

### 홈 UI v2 최종 상태

홈 UI는 production 실제 화면 확인까지 완료했다.

- `458824e` — 카드 image load 실패 시 broken image를 남기지 않고 fallback 전환.
- `e5bc9fd` — 이미지 0장/실패 fallback을 반복 산 일러스트에서 **행사별 날짜·기간·지역 기반 정보형 그래픽**으로 교체.
- `75802ac` — warm ivory canvas, filter hierarchy, section divider, card typography/metadata 대비를 최종 보정.
- 최신 main: `75802ac`
- production Worker: `0a813e04-8287-4d95-806f-8d9dc595dd1b`
- PC 4열 / mobile 2열 유지.
- production broken image 0.
- 공식 이미지가 없는 행사는 AI로 실제 행사 장면을 생성하지 않고, 확인된 행사 사실만 사용하는 deterministic 정보형 그래픽을 보여준다.

홈 UI는 회귀가 없는 한 완료로 간주하고 추가 미세조정 반복을 피한다.

### 상세 UI v2 최종 상태

- 상세 UI v2 production 마감을 완료했다.
- 최종 상세 media 수정은 `eaa56db`이며, Worker `b7ad1cae-cf68-4f3b-aac6-0ac8e4c2c13e`에 배포됐다.
- `c496d96`은 `.detail-media-pair` 전체 컨테이너를 desktop에서 측정하고 mobile stacked media를 구조에 맞게 검증하는 test-only 수정이다. 이 commit 때문에 Worker를 재배포하지 않았다.
- 서울 왕궁수문장 교대의식 rich detail + 2 images, 2026 화성행궁 야간개장 portrait secondary poster, 2026 수원화성 미디어아트 0-image fallback을 desktop/mobile에서 검증했다. overflow와 console/app error는 없었고 홈 핵심 shell/filter 회귀도 없었다.
- 실제 1-image 행사는 현재 production 데이터에 없어 production 실데이터 검증은 수행하지 않았다. 1-image layout은 local/자동 테스트 검증만 존재한다.

홈과 상세 UI는 새로운 회귀가 없는 한 다시 열지 않는다.

### TourAPI detail 운영 상태

- retry-due failed → never-processed → TTL refresh 우선순위 적용.
- 실패 state retry는 +30m → +2h → +4h → +8h → +16h → 최대 +24h.
- network/timeout만 500ms 후 endpoint당 1회 inline retry.
- inline retry production 실측 복구 0건이었으나 시간이 지난 state retry에서는 실패 행사가 다수 정상 success로 복구됐다.
- 마지막 측정 never_processed: **78**.
- `tourapi-1230074` 춘천막국수닭갈비축제는 마지막 측정 후보 순위 **18위**, 아직 never-processed.
- 외부 network 실패 자체를 0으로 만드는 것보다 자동 retry로 결국 상세가 채워지는 운영 안정성을 목표로 한다.

### 최신 로드맵

1. ✅ Cloudflare 운영 기반 / 기본 서비스
2. ✅ 홈 UI v2
3. ✅ 상세페이지 UI v2 production 마감
4. 🟡 TourAPI detail backlog 소진 / recovery 확인
5. ⏳ 공식 상세 enrichment 품질 강화
6. ⏳ 전국 municipal/source coverage 확대
7. ⏳ SEO / Search Console / 검색 유입 점검
8. ⏳ 모바일 최종 polish
9. ⏳ 수익화 준비
10. ⏳ Zero-Human 운영 자동화 최종 점검

다음 세션은 TourAPI detail backlog 소진 및 state retry/recovery 운영 확인부터 시작한다. production D1을 read-only로 다시 측정해 backlog가 실제로 감소했는지 확인한다. 홈 UI와 상세 UI는 새로운 회귀 또는 새로운 실패 유형이 있을 때만 다시 연다.


## 22. 2026-09-23 운영 전환 — TourAPI 관찰 대기 / municipal coverage 재개

- 상태 저장 직전 main: `fcc6e4a` — 상세 UI v2 release 문서 마감.
- TourAPI detail 최신 read-only snapshot: 대상 219 / success 123 / empty 0 / failed 18 / never_processed 78.
- failed 18건은 모두 retry-due, retry-waiting 0. failure_count는 1회 8건 / 2회 10건.
- 최근 manual detail run은 candidates 25 / enriched 16 / failed 9였고, retry_attempted 8 / retry_recovered 0 / retry_exhausted 8. 주요 실패는 network_or_timeout / unknown_network.
- `tourapi-1230074` 춘천막국수닭갈비축제는 never_processed, 당시 후보 우선순위 19위.
- 다음 scheduled watchdog은 **2026-09-24 11:00 KST (02:00 UTC)**. 이 실행 결과 전에는 recovery 판단을 확정하지 않는다.
- 그 전까지 TourAPI detail 코드는 변경하지 않고 manual detail run도 하지 않는다. 공식 상세 enrichment 품질 강화도 보류한다.
- 현재 개발 작업은 **전국 municipal/source coverage 확대**로 이동한다. TourAPI detail과 독립된 source onboarding만 진행한다.

## 23. 2026-09-24 — 전국 municipal/source survey 완료 상태

- 전국 research unit **245개 전부 source 조사/분류 완료**, `UNREVIEWED 0`.
- 최종 분포: **ACTIVE 9 / ONBOARDING_READY 29 / COLLECTOR_GAP 39 / WATCH 168 / EXCLUDE 0**.
- deterministic survey queue는 비었다. Phase 6의 “전국 source 발굴/분류” 부분은 완료로 간주한다.
- 이후 Phase 6은 **운영 검증 후 실제 onboarding 및 공통 collector gap 해소** 단계다.
- production은 survey 동안 변경하지 않았으며, 기존 10:00 KST base Cron / 11:00 KST TourAPI watchdog 일정은 그대로 유지한다.
- latest survey completion main: **`8914f9901dd4b2329985449c503b3ceb5e952915`**. 해당 commit Project checks success.
- 다음 우선순위는 **C 10:00 read-only 검증 → D 11:00 read-only 검증 → READY 3~5개 단위 Phase 6E onboarding → 공통 GAP 해소**다.
- 사용자 승인 정책: routine bounded municipal 조사/문서/검증/commit/push는 중간 승인 없이 진행. destructive D1, secret/resource/비용/장애 위험 작업만 별도 승인.

## 24. 2026-09-24 — municipal onboarding production 배포

- `c223028fde02ed6bbff2badf39e80b14c4c6100e`를 기존 Worker `weekend-mwohae`에 production 배포했다. Worker version: `d9118a65-9d67-490b-b51d-016c3bbbc437`.
- 과천·하남·상주 Registry 설정과 generic extractor 카드/목록형 보강, venue 오탐 방지가 배포 코드에 포함됐다. 10:00 / 11:00 및 11:45 / 13:50 / 17:55 KST Cron이 유지됐다.
- `/api/health` 및 `/api/events?limit=1&period=today` 모두 HTTP 200. 수동 수집 및 D1 write는 하지 않았다.
- 다음 검증: 2026-09-25 10:00 KST 자연 Cron 후 read-only로 과천·하남·상주 ingestion과 후보 품질 확인.


## 25. 2026-09-26 — 9/25 자연수집 checkpoint

- 2026-09-25 10:00 KST production base sync는 **success**, stale 0.
- TourAPI detail은 대상 213건 중 success 189 / never_processed 24 / failed 0 / retry due/waiting 0. 운영 recovery는 정상이고 남은 24건은 backlog 소진 대상이다.
- 과천·하남·상주 municipal 3 source는 이번 실행에서 candidate `observed=0`. 잘못된 publish는 없었고 base/TourAPI에는 영향이 없었다.
- 하남·상주는 공식 current page에 future 2026 항목이 존재하므로 observed 0을 '현재 행사 없음'으로 처리하지 않는다. municipal source fetch/health/parser 진단이 다음 우선순위다.
- Batch A 평택·여주·경산은 staging branch에만 보존하며 production 확대 전 위 3 source 원인을 먼저 분리한다.


## 26. 2026-09-26 — municipal expansion 최신 checkpoint

- 현재 개발 우선순위는 **전국 municipal/source coverage 확대 마감**이다.
- latest functional main checkpoint: `1b647f6cfd4e346fb0b6a7a1c9feadcb53651277` — 거제 monthly parser 포함.
- 이 checkpoint의 Project checks / UI browser smoke는 모두 success.
- Registry는 **35 source**, 이번 expansion 누적 신규 준비량은 **+23 source**.
- ONBOARDING_READY 중 아직 Registry 미등록은 **영등포 / 목포 / 산청 3 source**만 남아 있다.
- 이번 +23 source는 아직 production에 배포하지 않았다. 여러 source를 끝까지 모은 뒤 deploy를 1회로 묶는 운영 원칙을 유지한다.
- last-known production municipal hardening code는 `86163bcdfc2b67e52c3611f7676f946a632e23ed`, Worker version `5d02024b-3f76-4cdd-b751-c59d9e59e97d`. 실제 production이 이후 변경됐는지는 다음 세션 시작 시 재확인한다.
- TourAPI recovery는 안정화됐고 municipal expansion과 독립적으로 동결한다. UI v2도 완료/동결 상태를 유지한다.

## 27. 2026-09-26 — 전국 municipal READY queue 마감

- latest official-source 재검증으로 남아 있던 영등포·목포·산청 3건의 이전 READY 판정을 보수적으로 재분류했다.
  - 영등포: 기존 canonical endpoint 404 → WATCH.
  - 목포: current 공식 calendar는 유지되지만 generic candidate core extraction 계약 미검증 → COLLECTOR_GAP.
  - 산청: 공식 월별 table core는 충분하지만 `yyyymm` rolling-month collector 지원 필요 → COLLECTOR_GAP.
- 결과적으로 municipal inventory의 UNREVIEWED는 0을 유지하고, **ONBOARDING_READY 중 Registry 미등록도 0**이 됐다.
- Registry는 35 source. 이번 expansion 누적 신규 준비량은 +23 source이며 아직 production에 배포하지 않았다.
- 다음 운영 단계는 누적 source 변경을 기존 Worker에 1회 배포하고 production source_outcomes/smoke를 확인하는 것. 신규 리소스·D1 파괴 변경은 필요 없다.


## 28. 2026-09-26 — +23 municipal production deploy 안정화 완료

- Registry 35 source와 누적 신규 +23 source가 production Worker `weekend-mwohae`에 반영됐다.
- 배포 후 발견된 municipal event detail URL encoding 회귀는 PR #27로 수정·검증·main 병합 후 재배포했다.
- 최종 production Worker version: `b187830c-1bd8-440d-b50c-31ad6ac0402e`; deploy main: `b6788b0bb24abbac28c9f822815f079ede0562dd`.
- production smoke 최종 PASS. 기존 D1/Cron/Secrets/Bindings 유지, migration·수동 ingestion 없음.
- 현재 우선순위는 2026-09-27 10:00 KST 자연수집에서 35 Registry source의 source_outcomes/후보 수/decision 분포/오류를 read-only 검증하는 것.
- 그 검증이 안정적으로 닫히면 municipal 1차 전국 조사·즉시 onboarding Phase를 완료 처리하고 COLLECTOR_GAP 41 공통 collector capability Phase로 전환한다.


## 29. 2026-09-26 — SEO pilot landing 전략 확정

- 검색 유입 확대는 무한 faceted query URL 색인 방식으로 하지 않는다. 일반 필터 조합 URL은 홈 `/` canonical로 통합한다.
- 첫 indexable search landing은 `/weekend/seoul` 단일 pilot으로 제한한다.
- Pilot은 서울 + 이번 주말 실제 행사 결과를 바로 보여주고, 자체 title/description/canonical/OG metadata와 sitemap entry를 가진다.
- 홈에서 해당 landing으로 가는 crawlable footer anchor를 제공한다.
- Pilot 성능/색인 상태를 확인한 뒤에만 다른 지역·기간 landing 확장을 결정한다. 비슷한 얇은 페이지를 대량 생성하지 않는다.
- Municipal 35-source natural validation과는 독립적인 SEO lane으로 운영한다.


## 30. 2026-09-26 — promotion readiness gate

- 본격 홍보 전에는 production 실사용 QA를 통과해야 한다. 단순 smoke/CI 성공만으로 promotion-ready로 간주하지 않는다.
- 2026-09-26 첫 production QA: 30 events / 15 regions. Detail API와 목록↔상세 데이터 계약은 전반적으로 안정적이었고 source URL 30/30 reachable.
- Promotion blocker 두 개가 확인됐다: (1) URL 문자를 포함한 municipal event ID의 public detail page 404, (2) 390px mobile production event-grid의 약 42px horizontal overflow.
- 두 blocker 수정 및 production 재검증 전에는 대규모 홍보를 시작하지 않는다. SEO/indexing 작업은 별도 lane으로 유지 가능하다.


## 31. 2026-09-26 — promotion blockers closed in production

- The two concrete blockers found by the first 30-event / 15-region pre-promotion QA are now closed in production.
- Encoded municipal public detail route: verified HTTP 200 with correct canonical.
- 390px mobile event grid: verified no horizontal document overflow (`scrollWidth=390`) and all cards within viewport.
- Production smoke passed after both fixes.
- Broad promotion is no longer blocked by those defects, but the promotion-readiness gate should be closed with one final read-only QA rerun before traffic is actively pushed.


## 32. 2026-09-26 — promotion readiness gate passed

- Final production QA rerun after the two blocker fixes passed the launch gate: 30 events / 15 regions, `critical_events=0`, `mobile_failures=0`.
- Operational verdict: `PROMOTION_READY_WITH_REVIEW`.
- The 17 warnings are not launch blockers: 16 are external official-source fetch failures from the GitHub runner and 1 is an approximately 150h-old `checked_at` freshness warning for `2026 수원화성 미디어아트`.
- Broad promotion may start. Continue normal monitoring for freshness, source availability, indexing, and user-reported data issues.
- This does not replace the independent municipal 35-source natural-run verification planned after the 2026-09-27 10:00 KST base Cron.


## 33. 2026-09-26 — Google Search Console operational

- `galteum.com` is connected as a Google Search Console Domain property (`sc-domain:galteum.com`).
- Root URL is confirmed indexed by Google.
- Sitemap `https://galteum.com/sitemap.xml` is registered with 0 warnings / 0 errors and was re-submitted on 2026-09-26 after new SEO landing/detail URLs went live.
- New URLs such as `/weekend/seoul` and a representative municipal event detail were still unknown to Google at the time of inspection, which is consistent with the sitemap having last been downloaded before those URLs were deployed.
- Search Console monitoring is now an active SEO operations lane: track sitemap download/index coverage and inspect representative landing/detail URLs without excessive repeated polling.


## 34. 2026-09-26 — first promotion experiment

- First active promotion experiment is a 7-day organic Threads pilot.
- Initial landing target: `/weekend/seoul`.
- Do not start with paid acquisition; first establish which organic hook produces qualified link clicks and actual site sessions.
- Search Console pre-promotion baseline: 0 clicks / 2 impressions through 2026-09-23.
- If the pilot produces measurable qualified traffic, reuse the winning hook on Instagram and relevant community channels in later bounded experiments rather than launching all channels at once.


## 35. 2026-09-26 — promotion paused for UI polish

- Active promotion is temporarily paused by user decision.
- Current priority is production UI polish before resuming the 7-day Threads acquisition experiment.
- Promotion-readiness technical gate remains passed; this pause is a product/UI quality decision, not a reliability rollback.


## 36. 2026-09-26 — home hierarchy / shared rail production complete

- Production home now uses a single visible horizontal rail across hero, trust/principle surface, and footer on desktop; mobile content/footer rails also match.
- Desktop hero target is live at 220px with a larger primary search treatment; production smoke and overflow checks pass.
- This UI polish task is closed in production. Active promotion remains paused until the remaining home UI review is finished.


## 37. 2026-09-26 — home card / recommendation hierarchy production complete

- Home recommendation and full-list sections now have clearer editorial separation in production.
- Featured cards use stronger event-title/date hierarchy while desktop 4-column and mobile 2-column layouts remain intact.
- Production smoke and desktop/mobile overflow checks pass.
- This bounded UI task is closed. Promotion remains paused while the remaining home UI review continues.


## 38. 2026-09-26 — trust section / footer production complete

- Home trust area and footer polish are live in production.
- The trust surface now ends the content flow with a bright verified-information treatment and restrained deep-green accent; the footer uses a warm light brand finish instead of a detached dark slab.
- Obsolete `운영 준비 중` copy has been removed from production.
- Production smoke and desktop/mobile overflow checks pass.
- This bounded UI task is closed; promotion remains paused pending final visual review.


## 39. 2026-09-26 — home control cleanup checkpoint

- Production screenshot review reopened one final home-organization issue: theme controls were duplicated across quick categories, advanced filters and active-filter chips, making the interface look busier than benchmark discovery services.
- Main now contains the simplified single-theme-control implementation and lighter sparse-result/footer treatment; production deploy is pending.
- Data truth is unchanged: a filtered query showing 4 events reflects the current matched official results and is not a four-card UI cap.


## 40. 2026-09-26 — home control cleanup production complete

- Simplified home controls are live in production: quick categories are the single theme selector, advanced filters no longer duplicate theme controls or auto-open for a theme selection, and redundant active-filter theme chips are gone.
- Sparse-result exploration and footer finishing are also live; the production 공연 query currently returns 4 official matches and the UI renders all 4 without imposing an artificial four-card cap.
- Production smoke and desktop/mobile overflow checks pass.
- This bounded UI cleanup task is closed. Promotion remains paused pending the user's final visual review of the production home.


## 41. 2026-09-26 — benchmark-informed home visual production complete

- Klook/Fever/GetYourGuide benchmark-informed home cleanup is live and verified in production.
- Desktop and mobile direct checks pass with no horizontal overflow; mobile keeps 2-column cards and 14px featured-card titles.
- The home now uses a neutral-first warm canvas, one vivid discovery orange (#F45A2A), lighter control chrome, unboxed featured content, reduced repeated editorial labels, compact card location meta, and restrained fallback graphics.
- This bounded UI task is closed. Promotion remains paused until the user's next product/UI decision.


## 42. 2026-09-27 — home typography rhythm production complete

- PR #43 home typography/control-density cleanup is live in production.
- Deployed code baseline: `923472d65fa8a59acb1610f009b4cb9b48b60f15`; production Worker version: `77db54bf-267e-4eed-a4d5-a2f556ad1d86`.
- Production smoke PASS.
- Desktop 1365px direct verification: no horizontal overflow, quick category 44px, period control 40px, removed helper copy absent.
- Mobile 390px direct verification: no horizontal overflow, quick category 50px, period control 42px, removed helper copy absent, featured grid remains 2 columns (`169px 169px`).
- No data, API, ingestion, SEO or detail behavior changed.
- This bounded UI task is closed. Do not redeploy for documentation-only closure; further UI work should start only from a new production screenshot / concrete visible issue.


## 43. 2026-09-27 — detail action + mobile media production complete

- Production detail audit of five representative events found two actionable UI gaps: municipality primary official sources could miss the top official CTA, and two-image mobile detail media stacked to about 528px.
- PR #44 added deterministic detail actions:
  - organizer/municipality official source fallback for the top official CTA;
  - Kakao Maps action using verified coordinates when available, otherwise confirmed address/venue search;
  - TourAPI API URLs are not exposed as public official CTAs.
- PR #45 compacted two-image mobile media to a side-by-side 2-column layout capped at 220–250px while preserving desktop behavior.
- Production code baseline: `7cc160dfcb3321c587d3a7baa5021b91f5ce9e8e`.
- Production Worker version: `15322094-8285-4cfc-97f6-7e08be201119`.
- Production smoke PASS.
- Direct production verification:
  - Suwon municipal detail: official CTA + Kakao Maps action present on desktop/mobile, no overflow.
  - TourAPI detail: official CTA + coordinate-based Kakao Maps directions present on desktop/mobile, no overflow.
  - Two-image detail examples (`페인터즈`, `광안리 M 드론 라이트쇼`): desktop media height 341px, mobile media height 250px, 2 columns, 2 image buttons, no overflow.
- Sparse-detail content remains a data/enrichment concern, not a reason to add invented UI content.
- Detail UI audit bounded tasks are closed in production.


## 44. 2026-09-27 — municipal 35-source cron sharding production complete

- Sep 27 natural-run audit found a deterministic failure boundary: first 9 Registry sources succeeded while the following 26 failed inside one scheduled Worker invocation.
- Immediate read-only source diagnosis reached 22 of those 26 with HTTP 200 and valid parsing on many sources, supporting an invocation-level external-fetch exhaustion/starvation cause rather than a broad source outage.
- PR #46 `fix: shard municipal ingestion across cron runs` merged as `9cabd7ec1f7327dc7d72c010c68942ead003e514`.
- Final CI PASS:
  - UI browser smoke #130.
  - Project checks #729.
- Production deployment baseline: main `2b4be74ccf2132fa305775a4c392f0be80912abf`.
- Production Worker version: `7303f5d9-fce0-4b4f-83b4-187d23517626`.
- Production smoke PASS.
- Existing cron trigger set is unchanged.
- Municipal 35-source daily orchestration is now deterministic across existing runs:
  - 10:00 KST: shard 0;
  - 11:00 KST: shard 1 alongside the detail watchdog;
  - 11:45 KST: shard 2 alongside first detail retry recovery;
  - assignment is 12 / 12 / 11 and each Registry source appears exactly once.
- Each municipal shard has a bounded external-fetch budget. Daily publication mutation capacity remains globally equivalent to the previous cap as 4 + 3 + 3 = 10.
- No new Cloudflare resource, D1 migration, UI change, or event-truth relaxation was introduced.
- Because this deployment happened after the Sep 27 10:00 and 11:00 KST shard windows, the first complete natural 35-source production verification is the Sep 28 cycle after the 11:45 KST shard completes.
- Do not manually rerun municipal ingestion solely to fill the partial Sep 27 cycle; use the next full natural run unless new production evidence requires recovery.


## 45. 2026-09-27 — municipal rich-detail gap confirmed / foundation ready

- A 35-source read-only audit confirmed that municipal detail sparsity is structural, not isolated:
  - 13 sources had sampled first-party detail pages with rich fields that Galtteum currently does not persist;
  - 18 sources exposed rich list-page signals but no representative detail target through the current parser;
  - 4 source list fetches failed during the audit.
- The Seoul Hangang example proves the `LIST_RICHNESS_ONLY` bucket can still have a rich per-event detail page that the current generic parser fails to discover, so the true detail opportunity is larger than the 13 directly confirmed sources.
- PR #48 merged a reusable municipal rich-detail extractor and priority-safe persistence foundation without wiring it into Cron.
- Existing detail tables are reused; no schema migration is needed.
- Source precedence stays organizer priority 1 > municipality priority 2 > TourAPI priority 3.
- Production ingestion remains frozen until the first complete Sep 28 post-sharding natural verification after 11:45 KST. The rich-detail foundation requires no Worker deploy until it is actually wired.


## 46. 2026-09-27 — municipal rich-detail autonomous wiring complete in main

- Municipal rich-detail extraction/persistence is now wired into the autonomous ingestion code on main.
- It covers both newly published events and safe backfill of already-existing sparse municipal events.
- Core publication safety remains unchanged: date/venue mutations still use the 4/3/3 shard caps and two-observation conflict rules.
- Rich-detail backfill is supplemental only and may not bypass a pending core mutation.
- Detail fetch budgets are unchanged because rich extraction reuses the already-fetched official detail HTML.
- Morning production verification now aggregates rich-detail attempt/persist/error/by-source metrics across shard runs.
- Production Worker deployment is intentionally deferred until the remaining 35-source audit/fetch gaps are fixed so the final pre-Sep-28 deployment can be done once.


## 47. 2026-09-27 — municipal detail-link identity safety tightened

- Live read-only validation confirmed generic outer-anchor card discovery can recover first-party event detail URLs; Pyeongtaek moved from 0 to 2 sampled detail targets.
- A critical migration hazard was fixed before production deployment: improving `official_url` must not change an already-published municipal event into a new logical event.
- Generic municipal detail-URL upgrades now reuse a legacy identity only for one unique exact same-source title/date/venue match; ambiguous cases remain fail-closed.
- Rich-detail production deployment is still intentionally deferred until remaining candidate-positive/detail-link gaps, zero-candidate parser gaps, and source fetch failures are addressed.


## 48. 2026-09-27 — manual municipal rehearsal safety hardened

- The first shard-safe manual municipal rehearsal hit a client-side Node/Undici response-header timeout after production deploy/smoke succeeded; the exception does not prove the server-side shard succeeded or failed.
- Manual one-shot transport now uses curl to tolerate long-running shard responses.
- More importantly, existing municipal date/venue changes now require identical confirmation on a later Asia/Seoul calendar day. Re-running the same shard on the same day cannot count as the second core confirmation.
- This closes the main safety risk of repeating a shard after an indeterminate manual transport failure while preserving idempotent rich-detail backfill for unchanged existing events.
- Latest Worker code therefore requires one additional verified deploy before the next manual municipal rehearsal.


## 49. 2026-09-27 — municipal shard fetch fairness added

- Manual production rehearsal proved the rich-detail path can persist official data, but only 11/35 sources recorded a fresh observation in the verification window and Seoul Hangang remained sparse.
- The 35-fetch shard budget is now allocated fairly across sources instead of being first-come-first-served:
  - rolling per-source window 3;
  - reserve 2 attempts for each later source;
  - hard cap unchanged at 35.
- Detail caps increased to 24/24/22, but total external requests remain bounded by the same hard 35 cap.
- This change targets fetch-budget starvation only. Genuine source-parser and network failures remain visible and must be triaged from the next full rehearsal output.


## 50. 2026-09-27 — Seoul Hangang rich-detail production backfill confirmed

- Fetch-fairness production behavior is now validated on shard 0: 11/12 sources observed with one residual source failure (`gyeonggi-과천`) under 26/35 external fetch attempts.
- Seoul Hangang rich-detail backfill is confirmed in production D1 for `달빛 한가위 마당`: official detail URL, summary, image, two time rows, three programs, free price status and contact `120` are present while the legacy event identity is preserved.
- The municipal rich-detail extraction/persistence pipeline is therefore proven end-to-end in production for at least Suwon, Goyang and Seoul Hangang on shard 0.
- Remaining validation work is shard 1 + shard 2 targeted reruns, then residual source/parser triage.

## 51. 2026-09-27 — municipal rich detail now reaches the visible detail UI in main

- Production D1 rich-detail persistence was previously proven, but the visible detail UI still showed generic content because the detail API mixed decoded and encoded event IDs.
- PR #58 fixes the public detail path end-to-end:
  - decoded event ID for all detail tables;
  - municipal contact support including 120;
  - same-day multi-session operating hours;
  - bounded municipality image proxy to avoid broken browser hotlinks.
- Integration and Playwright browser regressions cover the Hangang-style legacy event ID and visible summary/programs/hours/contact/images.
- Deployment is still required; no further municipal ingestion is required for the already-backfilled Hangang event.


---

## 2026-09-27 — 제품 방향 재정의: 전국 행사 발견 서비스

### 핵심 제품 목적

갈틈의 핵심 목적을 다음으로 재정의한다.

> **전국에서 지금 갈 만한 행사를 가장 빨리 찾는 서비스**

갈틈은 공식 행사 홈페이지의 모든 상세정보를 내부에 완벽히 복제하는 서비스가 아니다.
전국 행사 coverage는 유지하되, 사용자가 오늘/이번 주말에 갈 만한 행사를 빠르게 발견하고
정확한 기본정보와 공식 안내 링크를 통해 방문 여부를 판단하도록 돕는 데 집중한다.

### 상세페이지 책임 범위

갈틈이 우선적으로 정확히 책임질 정보:

- 행사명
- 대표 이미지
- 일정
- 장소/지역
- 확인된 가격
- 확인된 운영시간
- 짧고 유용한 행사 소개
- 문의
- 정확한 공식 안내 링크
- 마지막 확인일

공식 홈페이지의 모든 프로그램, 긴 본문, 주차/교통 세부표, 여러 페이지의 전체 콘텐츠를
갈틈 내부에 재현하는 것은 필수 목표에서 제외한다. 깊은 정보는 정확한 공식 페이지로 연결한다.

### Publish Quality Gate

수집 성공과 사용자 공개를 분리한다. 모든 수집 행사는 다음 중 하나로 자동 분류한다.

- **PUBLIC**: 사용자에게 보여줄 가치와 공식 근거가 충분한 행사
- **HOLD**: 행사성은 있으나 공식 근거/핵심정보/공식 링크가 부족하여 추가 확인이 필요한 행사
- **EXCLUDE**: 갈틈의 행사 기준에 맞지 않는 항목

판정 기준:

- 특정 기간/회차/시즌 등 행사성이 있는가
- 일반인이 실제 방문·관람·참여할 수 있는가
- 공식 근거가 있는가
- 날짜와 장소 등 최소 core가 확인되는가
- 단순 모집공고, 내부행사, 일반 공지, 상설시설 자체, 종료 개념 없는 일상 운영 프로그램은 제외
- 실제 행사지만 공식 정보가 너무 빈약하면 삭제하지 말고 HOLD

### 새 로드맵

1. **Phase 0 — 방향 전환 문서화**
   - 상세정보 복제 중심에서 행사 발견 중심으로 제품 기준 확정
2. **Phase 1 — Publish Quality Gate**
   - PUBLIC / HOLD / EXCLUDE 자동 분류
3. **Phase 2 — 기존 데이터 품질 정리**
   - 상설시설, 단순공지, 모집글, 내부행사, 지나치게 빈약한 항목 정리
4. **Phase 3 — 공식 링크 품질**
   - 공개 행사에 가능한 한 정확한 공식 행사 페이지 연결
   - `공식 안내 확인` 누락을 품질 실패로 탐지
5. **Phase 4 — 상세페이지 단순화**
   - 갈틈이 책임질 핵심정보만 명확히 노출하고 깊은 정보는 공식 페이지로 연결
6. **Phase 5 — 탐색 UX**
   - 오늘 / 이번 주말 / 내 주변 / 무료 / 아이와 / 데이트 / 야간 / 실내 / 축제 / 공연 / 체험
7. **Phase 6 — 추천 품질**
   - 단순 나열이 아니라 실제 갈 만한 행사 우선 노출
8. **Phase 7 — SEO/트래픽**
   - 지역+기간+상황형 랜딩 강화
9. **Phase 8 — 재방문 기능**
   - 저장, 공유, 시작 알림, 관심 지역/카테고리
10. **Phase 9 — 1차 수익화**
    - 광고
11. **Phase 10 — 2차 수익화**
    - 티켓/체험 제휴 및 affiliate
12. **Phase 11 — B2B**
    - 유료 노출, 행사 등록, 유입 통계 등 주최자 상품
13. **Phase 12 — 장기 확장**
    - 충분한 트래픽이 생긴 뒤에만 자체 티켓/예약/거래 플랫폼 검토

### Zero-Human 목표

최종 운영 목표는 100% 무오류 완전자동이 아니라 **실질적 노휴먼(near-zero-human)** 이다.

정상 루프:

- 자동 수집
- 자동 행사성 판정
- 자동 품질 게이트
- 자동 공식 링크 검증
- 자동 PUBLIC/HOLD/EXCLUDE
- 자동 만료/재확인
- 자동 이상징후 탐지

사람은 일상 검수자가 아니라 예외 큐만 본다.
공식 링크 404, 날짜 충돌, source format change, 행사성 판정 불명확 등만 예외로 축적한다.

### rich-detail 우선순위 변경

기존 municipal rich-detail 기반과 이미 구현된 데이터는 삭제하지 않는다.
다만 한강 한 건의 공식페이지 parity를 계속 확장하는 작업은 **현재 최우선 과제에서 내린다**.
새 로드맵에서는 먼저 Publish Quality Gate와 공식 링크 품질을 완성하고,
향후 필요성이 검증된 범위에서만 rich-detail을 선택적으로 사용한다.


## 2026-09-27 — discovery-first Phase 1 complete: Publish Quality Gate v1

- PR #59 merged as `365eebfc4bee85324125d1dd878b94369f1991d0`.
- Added provider-neutral deterministic classifier `shared/publish-quality.ts`.
- Output states: `PUBLIC / HOLD / EXCLUDE`.
- Current v1 behavior:
  - HOLD missing core or missing/untrusted official source;
  - EXCLUDE explicit non-events such as recruitment, regular classes, seminars, internal/admin events;
  - EXCLUDE ordinary perpetual facility/program operation only when explicit perpetual + facility signals are both present and there is no special-event signal;
  - PUBLIC explicit festival/performance/exhibition/experience/special-event signals;
  - PUBLIC bounded official records with meaningful description;
  - HOLD sparse/ambiguous records instead of guessing.
- Bounded daily operation inside a finite special event remains PUBLIC; “매일 열린다” alone is not an exclusion rule.
- This PR does not change D1 schema or production visibility yet. It establishes the common decision contract only.
- CI: Project checks PASS; UI browser smoke PASS.
- Next bounded task: integrate the quality state safely into storage/read paths with a backwards-compatible default, then audit existing production data before any mass reclassification.


## 2026-09-27 — discovery-first Phase 2 complete: persistent publish quality state

- PR #60 merged as `9998869fc23002327672c2adb712bf7606c219b6`.
- Added migration `0022_publish_quality.sql`:
  - `publish_quality_state`: `PUBLIC | HOLD | EXCLUDE`;
  - reason / rule version / checked-at fields;
  - existing rows default to `PUBLIC` and keep a null rule version, so they are grandfathered until a separate audit/apply task.
- New/updated classifier-owned events now persist publish-quality decisions in:
  - TourAPI base ingestion;
  - TourAPI detail enrichment;
  - municipal official ingestion;
  - private official ingestion.
- TourAPI HOLD rows can be promoted later when detail enrichment supplies enough official detail.
- Production public read paths now require `publish_quality_state='PUBLIC'`; sample mode is unchanged.
- Push delivery suppresses alerts for HOLD/EXCLUDE events so hidden events cannot trigger user notifications.
- Integration coverage proves HOLD rows are hidden from list/detail reads and sparse TourAPI records persist as HOLD.
- CI Project checks PASS.
- Production has NOT been migrated/deployed yet. Migration must be applied before deploying this Worker code.
- Next bounded task: build a read-only quality audit that classifies the current production dataset without writing or changing visibility, then use that report to tune rules before any legacy mass reclassification.


## 2026-09-27 — discovery-first Phase 3 tooling complete: read-only quality audit

- PR #61 merged as `aef8b8baa3bb68813fd27e4fcfbd2784a0a10168`.
- Added `npm run audit:publish-quality`.
- Audit is bounded and zero-write:
  - scans current/future verified non-sample events only;
  - proposes PUBLIC/HOLD/EXCLUDE using the shared classifier;
  - groups by state, reason, and source kind;
  - reports representative HOLD/EXCLUDE rows;
  - reports official-link coverage as first-party direct / discovered official / TourAPI-only / missing.
- Production mode requires the existing explicit remote-read approval flag:
  `npm run audit:publish-quality -- --remote --allow-expensive-remote-read`.
- CI Project checks and UI browser smoke PASS.
- Actual production audit has not been executed from this chat because Cloudflare D1 credentials/runtime are not available here.
- This does not block independent official-link acquisition work; legacy mass reclassification remains blocked until the production audit is run and reviewed.


---

## 2026-09-27 — Publish Quality Gate v2: sparse TourAPI hardening

- Publish quality rule version advances to `publish_quality_v2`.
- Sparse TourAPI list rows no longer become PUBLIC solely because their title contains words such as 축제/전시/회원전/체험.
- A TourAPI row with only the generic provider sentence stays HOLD until detail enrichment supplies either:
  - meaningful event-specific description; or
  - a safe event-specific official homepage.
- Long-running permanent facility entries such as year-round permanent exhibitions are EXCLUDE when they carry facility/perpetual signals and no strong bounded special-event signal.
- Bounded special events (festival, special exhibition, performance, night opening, etc.) remain eligible even when they operate daily during the event period.
- The read-only production audit now feeds discovered event-specific official links into the same classifier, so audit and ingestion decisions use the same evidence.
- This change is intended to remove the exact class the user flagged: records that technically look event-like by title but are too thin to deserve public listing.
- Legacy production rows are still not mass-reclassified until the read-only production audit is reviewed.


## 2026-09-27 — discovery v1 guarded production rollout helper ready

- PR #71 merged as `c7da50d515e26a9f39755b4c11b7fe52cc3040f3`.
  - Read-only publish-quality audit now reports current persisted quality state, legacy unversioned counts, exact current→proposed transitions, and proposed visibility-change count.
  - Project checks and UI browser smoke passed before merge.
- PR #72 merged as `74e3504386c54fca25ac59c78575b04783ba1d80`.
  - Added `npm run rollout:discovery:v1`, rebuilt on latest main.
  - The command fails closed unless local main is clean and exactly matches origin/main.
  - It runs the zero-write remote production quality audit first, blocks structurally invalid/catastrophic state or visibility deltas, applies pending D1 migrations, performs verified deploy, runs production smoke/browser checks, then re-runs the audit.
  - It does **not** mass-reclassify legacy rows.
  - Project checks and UI browser smoke passed before merge.
- Stale/conflicted PR #66 was closed as superseded by #72.
- Production rollout itself is still pending because the current chat runtime does not have the authenticated Cloudflare/Codespaces execution environment. Do not claim migration/deploy/audit completion until `npm run rollout:discovery:v1` actually finishes in that environment.


## 2026-09-27 — nationwide weekend SEO discovery landings merged

- PR #73 merged as `1476844767dc6406d92901c54242d4c75afd86cf`.
- The existing `/weekend/seoul` discovery landing pattern now covers the 17 public Korean regions.
- Public SEO routes deliberately exclude the internal transitional `전남광주` value.
- Landing metadata continues to drive canonical/OG/sitemap output and initializes the same weekend + region discovery state in the React app.
- No ingestion, D1, recommendation ranking, or production visibility rule changed.
- Project checks and UI browser smoke passed before merge.


## 2026-09-27 — discovery rollout preflight audit legacy-schema bug fixed

- First production rollout attempt stopped safely before any migration or deploy.
- Root cause: `rollout:discovery:v1` intentionally audits production before migrations, but `audit-publish-quality.ts` unconditionally selected the new `events.publish_quality_*` columns from migration 0022. On the still-unmigrated production D1, the read-only preflight therefore failed.
- PR #74 merged as `c642303a4fb05221e6c757043895d323d28f8972`.
- The quality audit is now schema-aware:
  - before migration 0022, existing rows are modeled as their already-effective grandfathered `PUBLIC` state without referencing missing columns;
  - after migration, the real persisted quality fields are used;
  - missing `event_official_links` remains safely supported;
  - D1 failure diagnostics now preserve stderr/stdout detail.
- Focused regression coverage added.
- Project checks and UI browser smoke both passed before merge.
- No production write occurred in the failed attempt. The next production step is to pull latest main and rerun the same single `npm run rollout:discovery:v1` command.


## 2026-09-27 — discovery v1 deployed; mobile production smoke contract corrected

- The guarded rollout reached production migration + deploy successfully.
  - migration 0022 publish quality: applied
  - migration 0023 event official links: applied
  - Worker/assets deployed; version reported by Wrangler: `9149e746-9bb8-44ca-aff8-0439fb3cc5fa`
  - generic production smoke passed
  - desktop production browser smoke passed
- Preflight production audit before the migration scanned 258 current/future verified events:
  - proposed PUBLIC 241
  - proposed HOLD 17
  - proposed EXCLUDE 0
  - exact event official link 66
  - first-party source only 44
  - TourAPI-only official-link gap 148
  - proposed visibility changes 17
- The rollout then stopped in the mobile browser check. This was not an app rendering regression: the test incorrectly required each child of the intentional mobile two-image 1.55fr/0.85fr row to be landscape. The UI contract is on the combined 220–250px media row, not each child.
- PR #75 fixed the production-smoke assertion to validate the combined mobile two-image row while preserving single-media landscape checks. It merged green as `99c67801e8339cdde2d70aade9b7cb7edaeee17d`.
- Because the browser check stopped the command, the final post-deploy audit did not run. Existing legacy rows also remain grandfathered until an explicit safe reclassification step; migration defaults alone do not apply the 17 proposed HOLD changes.


## 2026-09-27 — guarded legacy Publish Quality reclassification merged

- PR #77 merged green as `54ed53657b30a8bc3299f0f47b152c43b2e06452`.
- The guarded discovery rollout now completes the legacy quality transition after production verification.
- It re-audits production, then only allows the first legacy rollout when:
  - publish-quality schema is present,
  - the audited row set is complete,
  - grandfathered rows are still PUBLIC/unversioned,
  - no legacy row is proposed EXCLUDE,
  - visibility changes are <= 50 and <= 10% of legacy rows.
- The current measured rollout (258 rows, 17 proposed HOLD, 0 EXCLUDE) is within those limits.
- The apply step writes all audited legacy rows with `publish_quality_v2` in one atomic UPDATE, so unchanged PUBLIC rows are versioned too and future source refreshes can reclassify normally.
- Post-write verification requires `legacy_unversioned=0` and `proposed_visibility_changes=0`, otherwise the rollout fails.
- Project checks and UI browser smoke passed before merge.
- Production write has not yet occurred for PR #77; authenticated Codespaces must pull latest main and rerun `npm run rollout:discovery:v1`.


## 2026-09-27 — discovery-first Phase 1/2 production rollout complete

- Production verification completed successfully on desktop and mobile.
- Current/future verified production set: 258 events.
- Persisted publish quality state:
  - PUBLIC 241
  - HOLD 17
  - EXCLUDE 0
- Legacy transition is fully closed:
  - `legacy_unversioned=0`
  - `proposed_visibility_changes=0`
  - current transitions are only `HOLD->HOLD 17` and `PUBLIC->PUBLIC 241`.
- A follow-up `apply:publish-quality:v1` correctly performed zero writes because the legacy conversion had already been applied.
- Phase 1 Publish Quality Gate and Phase 2 existing-data cleanup are therefore complete in production.
- Remaining quality problem is Phase 3 official-link coverage:
  - exact event official link 66
  - first-party source only 44
  - TourAPI-only 148
  - missing 0
- Next priority is to reduce TourAPI-only gaps without guessing URLs or returning to broad rich-detail replication.


## 2026-09-27 — Phase 3 starts: cached TourAPI official-link backfill merged

- PR #79 merged green as `201f1df8a7cf8daa3638b288da1b1ed78125754a`.
- This begins Phase 3 without broad web crawling.
- New guarded command: `npm run official-links:backfill:tourapi -- --remote --apply`.
- It only inspects already-persisted TourAPI detail payloads and accepts explicit provider homepage fields:
  - `intro.eventhomepage` first;
  - then `common.homepage`.
- It does not guess URLs, rejects data.go/API-documentation hosts, and only stores HTTPS links.
- Safety gates block any candidate that would:
  - turn a current PUBLIC event into HOLD/EXCLUDE;
  - create EXCLUDE;
  - exceed bounded candidate volume.
- Sparse HOLD rows may be promoted to PUBLIC when the cached detail payload contains an explicit event homepage.
- Writes are batched and followed by verification that applied events no longer remain in the cached-detail link-gap set.
- Project checks and UI browser smoke passed before merge.
- Production backfill has not been run yet; its result will determine how much of the 148 TourAPI-only gap can be closed from already-cached official data before any broader discovery work.


## 2026-09-27 — Phase 3 progress: 149 cached TourAPI official links recovered

- Production command `official-links:backfill:tourapi -- --remote --apply` completed successfully.
- It scanned 214 current/future TourAPI events with cached detail and no stored official link.
- Explicit official homepage fields recovered:
  - candidates 149
  - inserted/refreshed links 149
  - HOLD→PUBLIC promotions 0
- 65 TourAPI events with cached detail still have no stored official link.
- This backfill stayed inside the Phase 3 safety contract: no guessed URLs, no broad crawl, no visibility reduction.
- PR #80 merged green as `4a2168515dbe6cc29604aed21e77833ce016e600`.
- New zero-write command `npm run official-links:audit:tourapi -- --remote` classifies the remaining TourAPI gap population into:
  - explicit HTTP homepage;
  - explicit bare-host homepage;
  - other HTTPS URL signal;
  - other HTTP URL signal;
  - no URL signal;
  - invalid cached detail payload.
- This audit does not promote arbitrary URLs to official; it only identifies the next safe acquisition path.


## 2026-09-27 — Phase 3 remaining TourAPI gap classified; explicit legacy homepage resolver merged

- Read-only production audit after the 149-link cached-detail backfill found 65 TourAPI events still without a stored official link:
  - PUBLIC 63
  - HOLD 2
- Remaining signal classes:
  - EXPLICIT_HTTP_HOMEPAGE 31
  - EXPLICIT_BARE_HOST 7
  - OTHER_HTTPS_URL 27
  - no NO_URL_SIGNAL / INVALID_DETAIL_PAYLOAD cases in this population
- Interpretation:
  - 38/65 have an explicit TourAPI homepage field that is legacy HTTP or bare-host and can be safely resolved/verified without guessing.
  - 27/65 contain other HTTPS URL signals but must not be promoted to official automatically; they require a separate evidence/classification step.
- PR #81 merged green as `2deefb9c098d1f34fc70090a2cc2bbc847e98c40`.
- New guarded command: `npm run official-links:resolve:tourapi-explicit -- --remote --apply`.
- Resolver behavior:
  - HTTP homepage: try HTTPS upgrade first; if that fails, accept only an HTTP request that redirects to a healthy HTTPS final URL.
  - bare-host homepage: try HTTPS only.
  - reuse SSRF-safe page fetching; reject provider/API-documentation hosts.
  - ignore unrelated cached URLs.
  - block any PUBLIC visibility reduction or EXCLUDE transition.
  - batch writes and report remaining TourAPI official-link gaps.
- Project checks and UI browser smoke passed before merge.
- Production resolver execution is still pending.


## 2026-09-27 — Phase 3 explicit legacy homepage resolver production result

- Production resolver `official-links:resolve:tourapi-explicit -- --remote --apply` completed.
- Remaining TourAPI no-link rows scanned: 65.
- Explicit legacy homepage candidates: 38.
- Verified HTTPS links recovered: 20.
  - HTTPS upgrade: 14
  - bare-host HTTPS: 6
- HOLD→PUBLIC promotions: 0.
- Explicit candidates still unresolved: 18.
- TourAPI rows still without a stored official link: 45.
- Some unresolved HTTP candidates reported `access_status=ok` but were intentionally not accepted because the final URL stayed HTTP rather than becoming HTTPS; this is expected safe behavior.
- The 45 remaining rows consist of the unresolved explicit-homepage cases plus the previously separated OTHER_HTTPS_URL evidence cases. Do not treat arbitrary cached HTTPS URLs as official without a separate evidence-classification step.


## 2026-09-27 — 상세 UI v3 top-media density 구현 완료

- PR #82 merged green as `5227acf5996e58a6335618ee484ff63d3be2273b`.
- 상세 데스크톱 기본 구조를 기존 `이미지 | 정보` 2열에서 **얕은 full-width 상단 미디어 + 고밀도 정보판**으로 변경했다.
- 변경 범위는 UI/CSS와 회귀테스트뿐이며 ingestion/D1/publish-quality 로직은 건드리지 않았다.
- 핵심 변화:
  - 대표/추가 이미지를 상세 최상단 190~230px bounded media strip으로 이동;
  - 행사명/상태/일정/장소/공식 CTA/운영시간·비용·문의를 미디어 바로 아래에 밀도 있게 배치;
  - 데스크톱 일정·장소 2열;
  - 프로그램 카드는 가용 폭에서 auto-fit으로 더 많이 한 행에 노출;
  - 모바일은 top-media + 1열 core flow를 유지하되 supporting facts는 3열 compact layout;
  - blur backdrop 강도를 낮춰 portrait 포스터의 흐릿한 면적을 줄임.
- Hangang rich-detail fixture로 media가 summary 위에 있고, media height가 bounded하며, 일정/장소가 같은 행, 프로그램 3열이 유지되는 browser geometry test를 추가했다.
- UI browser smoke와 Project checks 모두 PASS.
- GitHub main 반영 완료. **production Worker deploy는 아직 하지 않았으므로 galteum.com에는 아직 이전 상세 UI가 보인다.**


## 2026-09-27 — 상세 UI v3 production 배포 완료, production smoke 계약 수정

- 상세 UI v3는 production Worker version `33ecf8cd-a06d-469f-b958-7b5f14fe4892`로 배포 완료됐다.
- 배포 자체와 production build는 성공했다.
- 최초 `test:ui:prod` 실패는 실제 UI 회귀가 아니라, `production-smoke.spec.ts`가 이전 4:3-ish 상세 미디어 계약을 계속 검사한 stale assertion 때문이었다.
  - desktop actual ratio 약 4.52는 새 full-width shallow media strip 설계와 일치한다.
  - mobile pair height 약 210.6px는 새 `54vw`, max 220px 계약과 일치한다.
- PR #83 merged green as `ab87de582e86033953514434ea22000046a083f4`.
- production smoke assertions를 상세 v3 계약(PC 190~230px shallow banner, mobile 180~220px bounded banner)에 맞춰 수정했다.
- UI browser smoke와 Project checks 모두 PASS.
- PR #83은 test-only 변경이므로 추가 Worker 재배포는 필요 없다. production 재검증만 한 번 더 실행하면 상세 v3 작업을 닫을 수 있다.


## 2026-09-27 — 상세 UI v3 production verification complete

- Production browser verification after the stale-contract fix passed on both desktop and mobile.
- Command: `TEST_BASE_URL=https://galteum.com TEST_OUTPUT_DIR=test-results/detail-v3-production npm run test:ui:prod`.
- Result: desktop PASS / mobile PASS (2/2).
- Detail UI v3 is now considered production-complete: shallow full-width top media + dense decision facts is live and verified.
- Resume Phase 3 official-link quality work from the remaining 45 TourAPI events without stored official links.


## 2026-09-27 — Phase 3 OTHER_HTTPS evidence audit merged

- PR #84 merged green as `9cbb37ecc1f12acd16cd3a361d06151bfa112b8d`.
- New read-only command: `npm run official-links:audit:tourapi-other-https -- --remote`.
- Scope is only remaining TourAPI rows currently classified as `OTHER_HTTPS_URL`.
- The audit extracts non-asset HTTPS URLs outside explicit homepage/provider fields, classifies social/ticket/map/general-web candidates, fetches them with the existing SSRF-safe loader, and reports reachability plus a conservative event-title signal.
- It never writes D1 and never promotes an arbitrary HTTPS URL to official. The result is evidence for the next bounded resolver.
- UI browser smoke and Project checks passed before merge.


## 2026-09-27 — 홈 UI 벤치마크를 대한민국 구석구석 방향으로 전환

- 사용자 시각 검토 결과 Fever식 상업/티켓 UI는 갈틈의 국내 공공행사 탐색 감성과 맞지 않는 것으로 결정했다.
- PR #85 merged green as `3e1f656dda9a8f5b19bf3076574564fd5bc48b8d`.
- 홈 카드 visual을 대한민국 구석구석 축제/행사 카드 흐름에 가깝게 조정했다.
  - 4열 유지, 카드 media를 3:4 세로 편집형 프레임으로 변경.
  - 세로/정방형 공식 포스터는 contain으로 원본 전체를 보여주고, blur backdrop을 제거.
  - 일반 가로 사진은 동일한 세로 카드 리듬 안에서 cover 허용.
  - 추천 카드의 과한 metadata/fallback 장식을 줄이고 이미지 → 행사명 → 날짜 중심으로 단순화.
  - 추천 섹션 문구도 `전국의 축제 · 공연 · 행사` 중심으로 정리.
- 이미지 없는 카드의 장식 fallback은 임시 안전장치일 뿐이며, 공식 상세/출처에 실제 포스터가 존재하는데 수집되지 않는 경우는 UI가 아니라 ingestion 품질 문제로 본다.
- 다음 별도 bounded task는 **공식 페이지에는 포스터가 있는데 `event.image_url`이 비어 있는 행사들의 이미지 수집 누락 원인/보강**이다.
- UI browser smoke와 Project checks 모두 PASS.
- production deploy는 아직 하지 않았다.


## 2026-09-27 — Korea Tourism-style home production verified; missing-poster audit ready

- Home poster-first UI deployed to production as Worker version `48eed064-5c7b-4345-8f58-735e4215b381`.
- Final production smoke passed desktop and mobile (2/2).
- Home UI benchmark switch is therefore production-complete.
- PR #86 merged green as `a854191150258d974bba09242971cbd2b555ed3c`.
- New read-only command: `npm run images:audit:missing-posters -- --remote`.
- The audit targets PUBLIC current/future events whose primary image row is missing/non-ok and classifies whether an image can be recovered from:
  - existing raw source payload image fields;
  - stored exact official event page metadata/JSON-LD/HTML images;
  - first-party municipality/organizer page when no event-specific official link exists.
- It never writes D1. The next bounded task should use the production audit result to fix the relevant ingestion/extractor path, not improve the no-image decoration.


## 2026-09-27 — TourAPI 대표이미지 누락 원인 확정 및 코드 수정

- missing-poster audit 결과, 다수 TourAPI PUBLIC 행사에서 `event_images` primary row는 없지만 `sources.raw_payload.firstimage` / `firstimage2`에는 실제 이미지 URL이 존재했다.
- 근본 원인: 현재 `worker/sources/tourapi.ts`는 TourAPI secondary image를 `event_additional_images`에 저장했지만 primary `event_images`를 쓰는 경로가 없었다.
- PR #87 merged green as `679236342cd18ed8d0e449942fe2114482725f77`.
- 수정 내용:
  - shared TourAPI image selector 추가;
  - sync 시 `firstimage` 우선, 없으면 `firstimage2`를 primary `event_images`에 저장;
  - 건강한 municipality/organizer primary image는 TourAPI가 덮어쓰지 않음;
  - 기존 PUBLIC current/future TourAPI 누락분을 raw payload에서 복구하는 bounded backfill command 추가: `npm run images:backfill:tourapi-primary -- --remote --apply`.
- UI browser smoke + Project checks PASS.
- 다음 단계는 production backfill 실행 후 홈에서 실제 no-image TourAPI 카드 감소를 검증하는 것. 지자체 이미지 누락은 별도 문제로 남는다.


## 2026-09-27 — TourAPI primary-image backfill production result

- Production backfill `images:backfill:tourapi-primary -- --remote --apply` completed successfully.
- Missing TourAPI primary-image rows scanned: 46.
- Recoverable directly from already-stored raw payload: 45.
- Inserted/refreshed primary images: 45.
- Remaining missing TourAPI primary image: 1.
- This confirms the dominant no-image problem was our persistence bug, not source scarcity: 45/46 missing TourAPI cards already had usable image URLs in raw source data.
- Worker with the persistence fix deployed successfully as version `fa102aad-b04e-4975-9fdf-85031fb907cf`.
- Future TourAPI syncs now persist `firstimage` (fallback `firstimage2`) into `event_images` while preserving healthier non-TourAPI imagery.
- Next image-quality work should focus on the single remaining TourAPI case plus municipality/organizer events whose official pages contain posters that are not yet captured.


## 2026-09-27 — municipal detail source assumption corrected

- Manual user inspection plus current official-page verification changed the default assumption: for the municipality sources checked, the needed visit-decision fields and poster generally exist on the official event detail page. Missing Galteum fields should therefore be treated first as **detail resolution/extraction failure**, not source scarcity.
- Verified current examples:
  - Seoul Hangang exact event detail exposes period, place, price, participation, official homepage and detailed schedules/program content.
  - Suwon Culture Foundation exact event detail exposes event image, period, time, place, fee, organizer/contact and full event description.
- The pipeline must keep the distinction `list page = discovery` / `exact event detail page = authoritative rich-detail source`.
- PR #89 merged green as `25b3d3494071e83f404417acf27197a4e85ee091`.
- Generic exact-detail extraction was broadened for current Korean municipal page shapes:
  - summary headings now include event overview/major-content variants;
  - Korean `14시~22시`-style hours are parsed;
  - price/contact fall back to labeled text when table/dl pairs are absent;
  - time-bearing program lines can become programs;
  - generic site chrome/default/no-image/common-menu assets are excluded from event imagery.
- Regression coverage modeled on current Suwon and Hangang detail shapes; UI browser smoke + Project checks PASS.
- Next production step: deploy this extractor and run a bounded municipal one-shot to backfill existing current events from their exact official detail pages. Then re-audit detail completeness rather than assuming the source lacks data.


## 2026-09-28 — municipal rich-detail v2 production backfill 완료

- Exact official event detail 기반 rich-detail v2를 production에 반영했고, 최초 full manual backfill 중 shard 1에서 발생한 Cloudflare 1102는 repeated whole-page parsing을 page당 1회 context로 재사용하도록 줄여 해결했다.
- 최적화 commit: `89c6faa8027efa36ce868e7c094dd2106bf0a6bb`; GitHub Project checks / UI browser smoke PASS.
- shard 0은 기존 성공 결과를 보존했고, 최적화 배포 후 shard 1 → shard 2 → read-only verify 체인이 끝까지 완료되어 1102는 재발하지 않았다.
- shard 2에서 rich detail 4건이 추가 저장됐고(`busan-동` 2, `gyeongbuk-경주` 2), rich-detail extraction error는 0이었다.
- production 검증에서 실제 exact detail 기반 poster/summary/time/program/contact가 Hangang, Busan Dong-gu, Gyeongju, Pyeongtaek, Goyang 등에 저장된 것을 확인했다.
- 남은 문제는 rich-detail parser 자체가 아니라 source별 관측 실패다. 최근 60분 기준 35 source 중 24 source가 관측됐고 11 source가 미관측이다. 성공한 전체 shard를 다시 돌리지 말고 실패 source만 별도 bounded diagnosis 대상으로 다룬다.

## 2026-09-28 — exact official detail self-healing layer implemented

- A systemic image/detail gap was confirmed from the Uijeongbu `2026 동오마을 푸드페스타` case: Galteum could already open the exact official event page through `event_official_links`, while municipal rich-detail ingestion did not generically reuse that known exact URL. This allowed the UI to know the authoritative page while poster/summary/time/contact/program data remained sparse.
- The fix is source-agnostic rather than city-specific. New `official-detail-recovery` selects current/future PUBLIC events with an already verified exact official URL from `event_official_links`, falling back to successful official-source audit links, then performs bounded safe fetch → event identity/core validation → shared rich-detail/image extraction → priority-aware persistence.
- The recovery layer originally ran in the 10:00 KST base ingestion; since 2026-10-07 it runs only in the 11:00 watchdog and later retry/recovery windows, isolated from base finalization.
- Safety contract:
  - HTTPS only, bounded same-family redirects/body size/time;
  - one bounded retry for network/timeout/429/5xx;
  - page title must match the event and the page must also contain a positive date or venue signal;
  - core conflicts are quarantined;
  - no guessed facts or images;
  - existing higher-priority official data is preserved.
- Image extraction now also consumes OG/Twitter/JSON-LD image candidates and lazy image attributes in addition to ordinary `img src`.
- Organizer exact-detail evidence can persist at priority 1; municipality at priority 2. Lower-priority TourAPI media/detail may be replaced, while stronger official evidence is not downgraded.
- A bounded authenticated backfill command is available: `npm run official-detail:once -- --passes=<1..10> --limit=<1..20>`.
- Code through `8ccb66c44c9ac1f024129c03bf4647c3293a7690` has Project checks PASS. Exact-page poster attachments (`*.jpg/png/webp/...` links with event/poster semantics) are also recovered, covering official pages that expose posters as attachments rather than ordinary inline images. Production deploy/backfill and the post-backfill missing-poster audit are still pending.
- Active priority remains image/detail completeness. The unrelated Yeongju/Geoje/Haeundae source-observation failures are deferred until this bounded task is closed.

## 2026-09-28 — first production official-detail rollout exposed missing provenance bridge

- Production deployed `c5de25b` as Worker version `fade4ab4-6ff7-425b-8ed2-c850144bb81c`.
- The first bounded `official-detail:once -- --passes=8 --limit=12` found 0 candidates. The post-run missing-poster audit still found 23 PUBLIC current/future municipality events with no healthy primary image.
- The audit originally labeled 15 rows `FIRST_PARTY_SOURCE_PAGE_IMAGE`, but examples proved those were not event-scoped evidence: Suwon returned shared `/inc/img/common/swcf_img.jpg`, while Hangang returned `default_img.jpg` plus an unrelated event image from a list page. Those 15 must not be counted as recoverable event posters.
- Root cause: municipal ingestion already stored exact event-detail URLs in the event's primary `sources.url` for registered/detail-followup paths, but it did not persist them into `event_official_links`. The new recovery job only looked at `event_official_links` and official-source audits, so it could not see these existing exact municipal URLs.
- Commit `d1507b2ff0f3b2535cc7882be860d1beb55b04a6` fixes the provenance bridge:
  - recovery may use an existing municipal primary source URL only when it is demonstrably different from that source's canonical registry list URL and still passes the source allowlist;
  - canonical list pages are never treated as exact recovery pages;
  - future successful municipal detail ingestion persists `event_official_links`, including safe existing-event rich backfills;
  - shared image extraction now rejects known common/default/menu assets consistently;
  - missing-poster audit marks list/source-page images as unscoped and excludes them from `recoverable_from_existing_evidence`.
- Project checks PASS for `d1507b2`. Production deploy + rerun of exact-detail recovery/audit is the next boundary.

## 2026-09-28 — production recovery pass #2 and same-day self-healing correction

- Production Worker `ee576db3-f431-4a77-856b-52191a194015` ran the extended exact-detail recovery. It processed 2 candidates, fetched 2/2, recovered rich detail for 2/2, but recovered 0 images. Missing PUBLIC current/future primary images remained 20 municipality events.
- Post-run audit distribution: 7 unscoped first-party list/source-page image sets, 8 exact/first-party pages with no image candidate, 3 page-unavailable, 2 exact official pages with image candidates. The two exact recoverable examples are Incheon official detail pages; Uijeongbu two events and Bucheon one event remained page-unavailable from the audit environment.
- A second architecture gap was found: official-detail recovery was only invoked in the 10:00 base pass. Therefore a transient fetch failure could be marked and then never receive the intended short retry on the same day.
- `bc7c1cc278bbc99defadf254c91759db3a599af0` standardizes transient failures and makes network/timeout/429/5xx failures eligible again after 30 minutes while keeping hard failures on the long cooldown.
- `6a4b0c6e79f8d4b3fa8ae112f53559204b537eb1` aligns the missing-poster audit with the same exact URL evidence used by recovery, including `municipal_candidate_state.official_url_snapshot`, so canonical list pages are not confused with exact event pages.
- `010a04550b46374c29bd77f7fe2858e9396c5467` runs bounded official-detail recovery again during the 11:00 watchdog and later retry windows. Recovery stays isolated from TourAPI detail success and still runs when the same-day TourAPI base is unavailable. Windows with a municipal shard use limit 4; later recovery-only windows use limit 8.
- Project checks PASS through `010a0455`. Production deployment of these three commits is pending.

## 2026-09-28 — official detail fetch now mirrors normal browser navigation

- Uijeongbu proved the remaining failure was still collector-side: the exact official detail page is human-accessible and contains a poster/detail content, while Galteum classified it as page unavailable/network error.
- Commit `1b43bbbf9eb91cc00f841f0ff23f8d56a3c20467` changes exact-detail HTTP fetches from the old custom bot-style request to a browser-compatible request profile (Chrome-like User-Agent, Accept/Accept-Language, no-cache headers) and sends the same-site municipal canonical list page as Referer when available.
- Existing safety remains: HTTPS-only, bounded body/time/redirects, allowed-host/sibling-host rules, event title + date/venue validation, no guessed facts/images.
- Project checks PASS for `1b43bbbf`.
- Production deployment is still required before claiming the Uijeongbu poster is recovered.

## 2026-09-28 — Uijeongbu exact-link discovery repaired

- Latest production evidence still showed the Uijeongbu food-festa event with no image, enrichment, hours, or programs, while the official detail page visibly contains the poster and detail content. This confirms a collector/provenance failure, not missing source material.
- The Uijeongbu generic source had no `detailLinkTemplate`, so list rows using JavaScript view handlers could collapse to the canonical list URL instead of the exact `/portal/eventNoti/view.do?...&idx=...` page. That left recovery with an unscoped source page.
- `cfe45251ee10c4ae70e4b71bd1d5e65b3b85a86c` adds the Uijeongbu detail-link template (`idx` + fixed `mId=0301170300`) and regression coverage using the user-verified food-festa exact detail id `2016`. Existing generic identity bridging preserves the published event id when the exact URL improves.
- `0e380ffe7059caae0610b1a5ce7799cddc305bdb` also changes municipal list/detail HTTP requests to a normal Chrome-like browser request profile instead of the custom bot-style User-Agent. This allows the source refresh itself to reach sites that are browser-accessible but reject/flake on bot-looking requests.
- Project checks PASS through `0e380ffe`.
- Production proof still requires authenticated deploy + a source-specific Uijeongbu refresh followed by official-detail recovery and a direct D1 verification of the food-festa row.

## 2026-09-28 — Uijeongbu production proved host-route failure; sibling-host fallback implemented

- Production Worker `2807724f-45dc-4ef9-ab80-f5c4e0c8a8eb` deployed the exact-link/browser-header fixes, but source-specific `gyeonggi-의정부` still failed before parsing with `official_http_522` after 2 fetch attempts. No candidates were discovered, so the stored event remained pinned to the canonical list URL and the official-detail recovery still had 0 candidates.
- This proves the remaining blocker is not HTML parsing or missing poster data: the Cloudflare Worker route to `ui4u.go.kr` is failing at HTTP 522 before the collector can read the list/detail page.
- `6133970b8c` makes municipal fetch treat 429/5xx as transient and retry an allowed same-family sibling host (for example `ui4u.go.kr` -> `www.ui4u.go.kr`) instead of retrying the same failing host.
- `7cc1923bea` remembers the working sibling host for the rest of the same municipal run, so once `www` succeeds the subsequent exact-detail fetch uses that host first instead of spending budget on the known failing route.
- `a7967e4557` aligns the read-only missing-poster audit with the same sibling-host/browser fetch behavior, avoiding false PAGE_UNAVAILABLE classifications caused only by the first host route.
- Project checks PASS for `a7967e4557`. Production redeploy + Uijeongbu source rerun is pending.

## 2026-09-28 — out-of-band official page transport fallback

- Repeated production proof showed `ui4u.go.kr` and its `www` sibling both fail from the Cloudflare Worker route before HTML parsing, while the same official pages are available in a normal browser. Continuing to add parser rules cannot solve this transport failure.
- A bounded transport fallback now uses Jina Reader only after all direct allowed official-host attempts fail with a transient network/timeout/429/5xx error. Jina remains transport only: the target must already be an allowlisted public HTTPS official URL, the original official URL remains provenance, cookies/secrets are never sent, and existing event title/date/venue validation still gates persistence.
- The fallback is capped at 4 Reader calls per municipal run and 4 per official-detail recovery run. No API key or new Cloudflare resource is required; direct official fetch remains primary.
- For generic municipal lists with a registered detailLinkTemplate, Reader receives deterministic DOM preprocessing that turns numeric JS view handlers into ordinary exact-detail links before extraction. Reader output is normalized into parseable HTML so the existing parsers and validation remain the single truth pipeline.

## 2026-09-28 — Reader fallback contract corrected and instrumented

- Production on `f2bd3fab` still failed Uijeongbu before parsing (`network_or_timeout`, discovered=0) and exact-detail recovery still had candidates=0; D1 remained list-URL-only with no image/detail. The initial Reader fallback therefore did not actually rescue the source.
- The fallback itself was corrected instead of adding another city parser:
  - `3f914d9f`: anonymous Reader transport now uses the documented GET form `https://r.jina.ai/<official-url>` and requests rendered HTML, removing the unsupported/fragile POST + injected-script dependency.
  - `2f958ed8`: rendered-HTML JSON payloads are read from `data.html`/`html` before content/text fallbacks.
  - `af49a02a`: fallback may use a recent (<=24h) cached official snapshot after direct egress fails; all writes remain gated by exact title plus date/venue/core validation.
  - `9608a100`: Reader retries the same allowlisted bare/www sibling hosts as direct municipal fetches and exposes Reader attempt/success/failure reasons.
  - `88ebc86d`: one-shot output aggregates Reader telemetry so production failures are no longer hidden behind generic `network_or_timeout`.
  - `01485f64`: exact official links without `municipal_candidate_state` can still infer safe sibling hosts from the registry allowlist; no arbitrary hostname guessing.
- Project checks PASS for `01485f6421ea3dff4dd162da4b39ceaee849e5ce`.
- Production redeploy/proof is pending. The next proof should be Uijeongbu only and must inspect `reader_attempts`, `reader_successes`, `reader_failures`, and `reader_failure_reasons` before any broader audit.

## 2026-09-28 — Reader fallback production proof still failed before discovery

- Production deployed latest Reader-fallback code (`f2bd3fabd2e47cbfb9e1c8faaccf615bb4e29e32`) as Worker version `cb7ec0b2-7a41-4e7c-a0c2-e9127b04c82f`.
- Source-specific `municipal:once -- --source=gyeonggi-의정부` still returned `network_or_timeout`, `discovered=0`, `detail_fetches=0`, `rich_detail=0` after 2 direct fetch attempts. `official-detail:once` again had candidates=0.
- Direct D1 verification still showed the `동오마을 푸드페스타` event pinned to the canonical list URL, with no stored official link, no image, no enrichment, hours=0, programs=0.
- Therefore the newly added Reader fallback did not produce usable source HTML in production. Do not assume Reader transport works merely because unit tests pass.
- Next bounded task is diagnostic, not another blind parser/fetch rewrite: add explicit Reader-attempt outcome telemetry (attempted / success / HTTP/error reason / target URL class) to municipal source results, then rerun only Uijeongbu. Based on that evidence, fix the exact transport invocation or replace the fallback if the Reader endpoint is unusable from the Worker.
- Image/detail completeness remains the active priority. Do not resume unrelated Yeongju/Geoje/Haeundae work.

## 2026-09-28 — municipal official poster display hardening deployed

- Municipal primary images in list and detail APIs now use the existing same-origin image proxy. The proxy sends the official-page referer/browser profile and safely recognizes `imgViewer.jsp?ext=...` binary responses as their declared image type.
- Exact Uijeongbu food-festa proof: the proxy returned `200 image/jpeg`; stale municipal portal boilerplate and an event-wide time line were removed from the public detail response. This preserves the official image and avoids inventing summary/program data.

## 2026-09-28 — Uijeongbu production OCR reuse proof still incomplete

- Latest production Worker version: `8e0c403c-6270-4477-9075-ac8d2e947239` (deployed from `b132a541d805db222207dc2dfbebfc8dff2b9d03`).
- One explicitly bounded target recovery for the Uijeongbu food-festa event timed out: candidates=1, fetched=0, recovered=0; Reader returned HTTP 429 and 422. Do not repeat recovery until a new bounded production instruction.
- Existing production D1 still has three program rows only (`떡볶이한판`, `무대공연`, `체험`); required `지역화폐 소비혜택` and `랜덤 경품 이벤트` are missing. Poster proxy is healthy (`200 image/jpeg`), hours are 12:00–19:00, but API contact is null and summary is blank.
- Same-hash OCR cache reuse was not proven in production: current poster state has no `last_success`, hash, or transcription. AI inference start is not exposed by one-shot telemetry. Do not claim Uijeongbu detail resolution.
- Next step is to diagnose the production timeout/transport boundary, then get explicit authorization for any further production recovery attempt.

## 2026-09-28 — Uijeongbu OCR now succeeds but detail remains blocked by parser output

- Worker version `f6349fb9-aca0-4d72-af42-546c84891776` ran one explicit target recovery successfully through poster OCR and persisted a new hashed `last_success`.
- Production parser output contains the five intended program concepts but also persists QR instruction and organizer boilerplate as programs; `떡볶이한판` also differs from requested label `떡볶이 한판`. Public API exposes these rows, so the event does not meet the detail quality criteria.
- Poster proxy returns `200 image/jpeg`, hours remain 12:00–19:00, summary is blank, and public `contact_phone` remains null. Desktop and mobile both show the QR/organizer false program rows.
- Do not rerun production recovery for parser cleanup. The next work should be a bounded parser correction, followed by a separately authorized single target production validation.

## 2026-09-28 — Uijeongbu parser cache reuse verified in production

- Parser commit `2e5ab500782721eb49cfde823d5ea5758003a77f` deployed as Worker version `5927b1df-5ccc-4b3d-ac02-fa837b3bcbcc`; one target recovery reparsed the existing hash-matched transcription without AI and persisted exactly five valid programs.
- QR instructions, organizer footer rows, and time-only program rows are absent. Operating hours remain 12:00–19:00, summary is blank, and API contact displays `031-928-4964`.
- API image status is `ok` and mobile shows the poster. Desktop detail hero was blank in visual QA and one direct proxy request returned 404; verify desktop image delivery before treating presentation QA as fully complete.

## 2026-09-28 — Uijeongbu representative case complete; portfolio audit priority

- Superseding the earlier visual-QA note: the latest production audit confirmed the Dong-o representative event end-to-end, including stable desktop/mobile poster display, 5/5 proxy responses, five clean programs, 12:00–19:00 hours, and contact `031-928-4964`.
- Across 35 current/future public verified events, 17 have healthy municipal primary images and 18 have no primary image row. Rich-detail coverage is summary 13, hours 8, programs 16, normalized contact 15; one event has successful poster OCR state (Dong-o), and zero current OCR failed/timeout states.
- The largest measured residual cohort is 13 events with a healthy municipal poster, incomplete HTML detail, and no successful poster OCR. This is the next bounded portfolio priority; do not process it as a batch without a new scoped task.
