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
- 현재 11시 detail run은 같은 KST 운영일의 10시 base run이 `success`로 끝난 것을 D1 `sync_runs`에서 확인한 뒤 실행한다.

Zero-Human v2 결정(코드 구현 완료·production 배포 대기):

- 10시 base 완료 후 11시까지 기다리지 않는다.
- base에서 새 행사/변경 행사가 확인되는 즉시 detail 단계로 자동 handoff한다.
- 전체 base가 10:05에 끝났다면 detail도 10:05부터 진행한다.
- 11:00 Cron은 주 작업이 아니라 미완료·실패·재시도 대상을 보충하는 watchdog/recovery 역할로 유지한다.
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
