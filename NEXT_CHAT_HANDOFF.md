# 갈틈 새 채팅 인수인계

> 2026-09-23 기준. 새 ChatGPT 세션에서 이 파일과 `PROJECT_CONTEXT.md`를 먼저 읽고 바로 이어서 작업한다.

## 사용자와 작업 방식

- 한국어로 짧고 정확하게 답한다.
- 사용자는 "진행해봐"라고 하면 설명만 하지 말고 실제 작업 진행을 기대한다.
- UI 작업은 사용자가 계속 QA하게 만들지 않는다.
  - 현재 main 확인
  - 수정
  - 충돌/중복/CSS specificity 확인
  - viewport 회귀테스트
  - GitHub Actions success 확인
  - 그 뒤에만 배포/확인 요청
- 화면 문제는 "대충 줄여봤으니 봐달라" 방식 금지. 목표 viewport와 통과 조건을 먼저 정한다.
- 기존 코드/수집/D1/Cron에 영향 없는지 먼저 검증한다.
- destructive D1 변경, secret 노출, resource recreate 금지.
- 큰 작업은 작은 단위로 나누되 진행 흐름을 끊지 않는다.
- 사용자는 비용과 시간을 아끼는 방향을 선호한다.
- 확실하지 않은 production 상태를 완료라고 말하지 않는다.
- **큰 파트 하나가 끝날 때마다 현재 로드맵을 사용자에게 보여준다.** 작은 bounded task마다 반복하지 않고, 큰 단계가 닫힐 때 완료/현재/다음을 짧게 정리한다.

## 프로젝트

- 공개 브랜드: **갈틈**
- GitHub: `framefutures-wq/project-WTW`
- branch: `main`
- production: `https://galteum.com`
- Worker: `weekend-mwohae`
- D1: `weekend-mwohae-production`
- 현재 Production Cron:
  - 10:00 KST base sync
  - 11:00 KST TourAPI detail enrichment
- Zero-Human v2 결정(코드 구현 완료·production 배포 대기):
  - 10:00 base가 끝날 때까지 11시를 기다리지 않는다.
  - base 수집에서 새 행사/변경 행사가 확인되는 즉시 상세보강 단계로 자동 handoff한다.
  - 11:00 Cron은 주 작업이 아니라 watchdog/recovery 역할로 남겨 미완료·실패·재시도 대상만 처리한다.
  - TourAPI detail 후보는 retry-due failed → never-processed → 7일 TTL refresh 순이며, 첫 실패는 30분 뒤 watchdog 재시도가 가능하다. 이후 retry는 2/4/8/16시간, 최대 24시간이다.
  - detail run message의 `failure_reasons`는 원문 오류·URL·key 없이 category 집계만 남긴다.
- 공식 사실 우선순위:
  organizer official → municipality → TourAPI → public data → other official
- optional 정보가 없으면 추측하지 말고 UI에서 숨긴다.

## 완료된 큰 축

- Cloudflare Workers + Static Assets + D1 + Cron + Secrets
- TourAPI 자동수집
- Municipal Zero-Human ingestion
- 한국민속촌 private official source
- 추천순 / 변경알림 / Web Push
- GA4 + Cloudflare Analytics
- galteum.com
- Google/Naver 검색 기반
- sitemap / robots / canonical / Event JSON-LD
- TourAPI 11시 상세보강
- 홈 UI:
  - 낮은 검색 배너
  - 빠른 카테고리
  - 날짜/지역/필터
  - 4열 desktop / 2열 mobile
  - scroll 후 compact sticky search
- 상세 UI:
  - 일정/운영시간/장소/비용/문의 우선
  - 소개/볼거리/프로그램 후순위
  - 모바일 단일 컬럼

## 최근 UI 흐름

홈 첫 화면은 여러 차례 조정 후 해결된 상태다.
사용자가 "좋아~ 해결잘됐다"라고 확인했다.

그 다음 상세 UI에서 문제 발생:

- 좁은 화면에서 이미지가 지나치게 세로로 길고 좁게 보임
- 출처 영역이 버튼에 눌림
- responsive 상세 수정 후에도 대표 이미지 프레임이 부자연스러움

최신 코드 수정:

- commit `367dedd6`
- 제목: `UI: stabilize detail image frame`
- Actions run `35704201196` success
- 내용:
  - legacy 600px detail dialog max-width override
  - bounded 4:3 detail media frame
  - portrait poster blur 완화
  - 이미지 프레임 회귀테스트 추가

**production 반영 완료:** 2026-09-22에 상세 이미지 수정이 실제 `galteum.com`에 배포됐다.

- 배포 기준 HEAD: `4b8bc6631ff99243407ef67eed6632567b80303d`
- Cloudflare Version ID: `5e2d5068-a88d-49f0-b059-3a89ef3f880c`
- production smoke 통과
- production UI desktop/mobile 2/2 통과
- 실제 도메인 상세 대표이미지 조건 desktop 높이 ≤360px·비율 1.15~1.5, mobile 높이 ≤300px·비율 >1.15 통과
- 배포 후 working tree clean

## 데이터 coverage

기존 municipal:

- 파주
- 수원
- 고양
- 화성

추가:

- 부천 `bucheon`
- 공식 목록:
  `https://www.bucheon.go.kr/site/homepage/menu/viewMenu?menuid=145007003`
- 행사명 / 날짜 / 장소 / 주요내용을 보수적으로 파싱
- 기존 Zero-Human gate / duplicate / retry / last-known-good 유지

부천 상세보강 사전조사를 시작했다.

- 부천 관광의 시민어울림한마당 전용 페이지는 2026-10-09, 문의 032-625-3113 등 기본현황을 제공하며 canonical list와 일정이 일치한다.
- 복사골청소년예술제는 canonical 가을 목록/최근 안전관리 보도자료가 2026-10-10을 가리키지만 별도 관광 페이지는 2026-10-11로 표기되어 공식 소스 간 충돌이 있다. 날짜를 임의 덮어쓰지 않는다.
- 생생부천의 2026 부천페스타 가을 안내에는 제13회 부천시민 자전거대축제 2026-10-24 13:00~16:00이 명시되어 있다.
- dev dry-run `scripts/municipal-discover.mjs`에도 Bucheon source를 포함하도록 보완했다. commit `e740bf0f`, Project checks success.

다음 데이터 작업 방향:
**부천 core canonical 유지 → 충돌 없는 공식 상세자료만 non-core enrichment에 연결 → 운영시간/상세소개/문의/이미지 후보를 보강 → 충돌 이벤트는 last-known-good/재시도 유지**
그 다음 공식 지역 source 1개씩 확대.

## 새 채팅 첫 순서

1. `AGENTS.md` 읽기
2. `PROJECT_CONTEXT.md` 읽기
3. 이 파일 읽기
4. **`docs/WORKING_RULES.md` 읽기 — 모델 선택, 프롬프트 길이, bounded task, 검증·배포 규칙을 고정 운영 계약으로 사용**
5. **`docs/UI_V2_DIRECTION.md` 읽기 — UI/상세 작업에서는 이 문서를 고정 설계 계약으로 사용**
6. 최신 `origin/main` 확인
7. GitHub Actions 확인
8. 현재 working tree와 중단 지점 확인
9. 태백시 / 서울 한강 municipal onboarding은 완료됐다. **현재는 UI / 브랜드 시스템 v2부터 이어간다.** 전국 coverage 확대는 UI/상세 v2가 안정될 때까지 잠시 멈춘다.

## 대화 톤

사용자에게 길게 사전설명하기보다:

- "확인했다"
- "원인은 이것"
- "이렇게 수정했다"
- "검증 결과"
- "다음 작업"
  순서로 짧게 보고한다.

사용자가 이미 지적한 문제를 다시 사용자에게 확인시키지 않는다.

## 2026-09-22 새 운영 결정: Municipal Zero-Human v2

- 목표는 특정 5개 지자체를 손으로 관리하는 것이 아니라 전국 지자체를 사람이 매일 보지 않아도 자동 수집·검증·보강·재시도하는 구조다.
- 현재처럼 지자체마다 HTML 한 종류에만 맞춘 parser를 계속 늘리는 방식은 전국 확장에 부적합하다. 동일 지자체도 HTML → table → PDF → 이미지 포스터처럼 공지 형식이 바뀔 수 있기 때문이다.
- source별 공식 URL/정책은 Registry로 관리한다.
- 문서 형식 변화를 감지하고 HTML / table / 구조화 데이터 / PDF / image 등 여러 extractor를 공통 Event Candidate 형태로 수렴시킨다.
- extractor 실패나 형식 변경을 '행사 없음'으로 해석하지 않는다.
- 확실한 candidate만 AUTO_PUBLISH, 애매하면 사람 검수로 보내지 않고 AUTO_RETRY한다.
- 기존 게시 데이터는 last-known-good를 유지하고 source 하나가 깨져도 다른 지역/수집/알림을 막지 않는다.
- 이미지/PDF fallback에서도 core 일정·장소를 불확실하게 추측해 저장하지 않는다.

### 스케줄 운영 결정

- 10:00 base 시작.
- source/candidate 단위 처리가 끝나고 상세보강 대상이 생기면 즉시 detail 작업으로 handoff한다.
- 전체 base가 10:05에 끝났다면 detail도 10:05부터 진행한다.
- 11:00 Cron은 미완료/실패/재시도 대상만 보충하는 watchdog/recovery 역할로 남긴다.
- 이미 완료한 detail을 11시에 중복 처리하지 않도록 상태 기반 idempotency를 유지한다.

### 다음 실무 작업

1. Municipal Zero-Human v2 설계 및 안전검증.
2. base 완료 즉시 detail handoff + 11시 watchdog/recovery 구조 구현.
3. source registry + multi-format extractor + format-change 감지 구조 설계.
4. 전국 확장을 위한 bounded queue/worker 방식 검토.
5. 새 Cloudflare Queue 등 신규 production resource가 필요하면 현재 설정·비용·마이그레이션 영향을 먼저 검증하고 사용자 승인 후 생성한다.
6. 부천은 이 공통 구조의 첫 검증 source로 사용하고, 개별 맞춤 코드를 무한히 늘리지 않는다.

## 2026-09-22 최신 구현 상태 — Zero-Human v2

- main 코드에서 10시 base 성공 직후 bounded detail을 즉시 handoff한다.
- 11시 Cron은 watchdog/recovery로 남기고, detail 실패는 성공한 base run을 실패로 되돌리지 않는다.
- municipal Source Registry를 단일화했고 parser contract / format-change 감지 / 공식 host allowlist를 적용했다.
- 기존 HTML 구조가 바뀌어도 공식 JSON-LD Event가 있으면 명시된 title/date/location/url만 structured fallback으로 사용한다.
- 공식 PDF/이미지 첨부 fallback 기반을 구현했다.
  - source당 최대 3개 첨부, 파일당 최대 5 MiB.
  - PDF는 명시적 행사명/기간/장소가 모두 있을 때만 publish 후보가 될 수 있다.
  - 이미지 포스터는 첫 판독으로 publish하지 않는다.
  - 한국 날짜 기준 다른 날에 동일 core payload hash가 다시 관측될 때만 image confirmation을 통과할 수 있다.
  - 같은 날 반복 실행이나 내용 변경은 confirmation으로 인정하지 않고 AUTO_RETRY 유지.
  - AI binding이 없으면 PDF/image fallback은 fail-closed하며 last-known-good를 유지한다.
- PR #23은 Project checks와 UI browser smoke가 모두 success인 상태에서 main에 merge됐다.
- 최신 기능 merge commit: bd16a75d76a64f6e39af817e98ada228d6c024fa
- 아직 production Worker에는 이 최신 main을 재배포하지 않았다.
- env.AI binding은 optional 코드만 있고 production에는 아직 추가하지 않았다. 사용자 승인 전 활성화 금지.

### 다음 작업

1. 최신 main을 기존 Worker에 배포하고 production smoke + cron/orchestration 회귀검증.
2. Workers AI AI binding 활성화 여부를 사용자에게 비용/무료한도와 함께 승인받는다.
3. 승인 시 공식 PDF 1건 + 포스터 1건으로 production bounded 검증.
4. 그 뒤 Registry 기반 전국 지자체 coverage 확대.
5. Queue는 실제 실행시간/규모 한계 근거가 생길 때만 검토하고 생성 전 사용자 승인.

## 2026-09-22 Workers AI 비용 가드

- PR #24 merge: bbd6167c4aa58a7daf165c02e930d957251f6f28
- production config에 `MUNICIPAL_DOCUMENT_AI_ENABLED=false`를 추가했다.
- AI binding이 나중에 존재하더라도 이 값이 정확히 `true`가 아니면 municipal PDF/포스터 파이프라인은 env.AI를 전달받지 못한다.
- 따라서 binding 생성/배포와 실제 AI 사용 활성화를 분리했다.
- 현재 production에는 AI binding을 추가하지 않았고 AI 사용도 활성화하지 않았다.
- 다음 production AI 단계는 사용자 승인 후 `ai.binding=AI` 추가 + flag true 전환 + bounded 실검증이다.

## 2026-09-23 확정: 다음 작업 순서와 UI/상세 v2

작업 순서:

1. ✅ 태백시 / 서울 한강 municipal generic onboarding 완료 — commit `8af623e`, Registry 7개 source, 관련 테스트/typecheck/build 통과, production deploy는 하지 않음.
2. **현재: 전국 coverage 확대를 잠시 멈추고 UI / 브랜드 시스템 v2를 먼저 완성한다.**
3. UI 작업에는 **상세 정보구조 v2 + 갈틈 파생정보 레이어 + adaptive media fallback**을 포함한다.
4. UI/상세 v2가 안정되면 공식 상세 enrichment 품질을 확대하고, 이후 전국 municipal coverage를 재개한다.

UI 기준:

- Klook 탐색 효율 + Fever 비주얼 감성 + GetYourGuide 상세 정보 위계 + 갈틈 공식정보 신뢰성.
- 웜 아이보리 `#F7F4EE` = canvas.
- 차콜 `#171A1D`, 서브 `#343A40` = 구조/타이포.
- 오렌지 `#F26B38` 계열 = 갈틈 브랜드 포인트 / 행동 / 발견.
- 딥그린 = 공식 확인/신뢰에만 제한.
- 홈/카드/상세/모바일을 한 디자인 시스템으로 정리하고 “맹하고 평평한 느낌” 제거가 목표다.

상세 기준 샘플:

- `서울 왕궁수문장 교대의식`
- 상세 순서: 대표사진 → 제목 → 언제/어디서 → 공식 CTA → 볼거리 → 시간표 → 프로그램 → 소개 → 지도/주변행사 → 출처.
- 일정은 timeline, 프로그램은 card.
- optional 정보가 없으면 빈/미확인 박스를 만들지 않고 섹션을 숨긴다.
- 공식 사실 / 갈틈 계산·재구성 정보 / 갈틈 탐색 연결 정보의 3층 구조로 상세 밀도를 만든다.
- D-day, 기간, 요일, 진행 상태, 오늘 프로그램, 주변/유사 행사 등은 안전하게 계산/연결할 수 있다.
- 주차/요금/프로그램 내용 등 새로운 사실은 공식 근거가 없으면 생성 금지.

미디어 fallback:

- 공식 대표 이미지 → 권리/출처 확인 가능한 공식 추가 이미지 → 이미지 수에 맞춘 adaptive gallery.
- 1장이면 한 장을 크게 쓰고 빈 썸네일을 만들지 않는다.
- 0장이면 실제 행사처럼 보이는 AI 이미지를 만들지 않고, 갈틈 컬러/타이포/도형/카테고리 아이콘 기반의 **명백한 정보형 브랜드 그래픽**을 사용할 수 있다.
- 실제 행사 현장·장소·프로그램을 상상한 AI 이미지, 출처/권리 불명 이미지는 사용하지 않는다.
- 이미지가 적은 상세는 timeline/지도/공식 fact/프로그램/주변행사 등 검증 정보의 시각화로 밀도를 만든다.

현재 UI v2 진행 상태:

- ✅ 홈/행사카드 브랜드 시각체계 v2 — `b5d4f13`
- ✅ 상세 정보 위계 v2 — `95ed3ab`
- ✅ 상세 파생정보 1차(D-day/기간/요일/진행중/오늘 프로그램) — `6de3bbd`
- ✅ 상세 1장/0장 media fallback — `f5dd796`
- ✅ 주변 행사 / 비슷한 행사, 공식 추가 이미지 API, 2장 adaptive media까지 완료.
- ✅ UI v2 큰 파트 production release 완료: D1 `0021` additive migration, TourAPI `firstimage2` secondary 263건 backfill, Worker version `b0cc4224-a334-466d-bf4f-4775ee41dc7f`.
- 다음 작업 위치: 공식 상세 enrichment 품질 확대 후 municipal/source coverage를 재개한다. 4~5장 gallery는 공식 이미지 3장 이상 실데이터 근거가 생길 때만 별도 bounded task로 진행한다.

## 2026-09-23 TourAPI detail orchestration 보완

- candidate priority, retry schedule, failure reason observability를 보완했다. parser/enrichment 규칙, 처리량(25 events / 75 requests), endpoint 수는 변경하지 않았다.
- transient network/timeout detail endpoint만 500ms 후 1회 재시도하며, run 전체 retry budget은 25회로 제한한다. logical requested(최대 75)는 유지하고 실제 호출량은 `attempts`로 별도 관측한다.
- detail run message에 `retry_attempted`, `retry_recovered`, `retry_exhausted`, `failure_endpoints`, `network_failure_subtypes`, `failure_latency` sanitized 집계를 남긴다.
- 2026-09-23 production 관측에서 network 최종 실패 8건은 `unknown_network`·`under_1s`였고 inline retry 복구는 0건이었다. 다음 작업은 이 runtime subtype이 왜 원문 없이 unknown으로 분류되는지 안전하게 진단하는 bounded audit이다.


## 2026-09-23 최신 인수인계 — 홈 UI / 상세 UI v2 종료, TourAPI detail 운영 확인으로 이동

### 실제 최신 기준

- 최신 main: `c496d96` — `test: align production detail media smoke`
- 상세 UI production 기준 main: `eaa56db` — `fix: preserve secondary detail poster`
- 현재 production Worker version: `b7ad1cae-cf68-4f3b-aac6-0ac8e4c2c13e`
- `c496d96`은 adaptive layout에 맞춘 production smoke test-only commit이며 Worker 재배포는 하지 않았다.
- public: `https://galteum.com`
- production health 정상.
- Cron unchanged:
  - 10:00 KST base sync: `0 1 * * *`
  - 11:00 KST TourAPI detail watchdog/recovery: `0 2 * * *`

### 홈 UI v2 — 완료

홈은 production 실제 화면까지 확인했고 이 상태를 완료로 본다. 회귀가 없는 한 다시 미세 CSS 조정을 반복하지 않는다.

최근 핵심 commit:

- `458824e` — broken card image가 남지 않고 기존 fallback으로 전환되도록 보강.
- `e5bc9fd` — 이미지 0장/로드 실패 홈 카드를 동일 산 일러스트가 아니라 **행사별 날짜·기간·지역 기반 정보형 그래픽**으로 교체.
- `75802ac` — warm ivory canvas, filter hierarchy, section divider, card metadata 대비 등 홈 visual hierarchy 최종 마감.

홈 미디어 원칙:

- 공식 이미지가 있으면 공식 이미지를 사용한다.
- 공식 이미지가 0장이거나 load 실패면 실제 행사 장면을 AI로 상상 생성하지 않는다.
- 대신 DB에 확인된 날짜/기간/지역 등 사실만 사용한 deterministic 갈틈 정보형 그래픽을 사용한다.
- 현재 PC 4열 / mobile 2열 유지, broken image 0.

### 상세 UI v2 production release — 완료

- 상세 UI v2 production 마감을 완료했다.
- production smoke는 desktop/mobile 모두 통과했다.
- 서울 왕궁수문장 교대의식의 rich detail + 2 images, 2026 화성행궁 야간개장의 세로형 secondary poster `contain + backdrop`, 2026 수원화성 미디어아트의 0-image 정보형 fallback을 desktop/mobile에서 검증했다.
- overflow와 console/app error는 없었고 홈 핵심 shell/filter 회귀도 없었다.
- 실제 1-image 행사는 현재 production 데이터에 없어 production 실데이터 검증은 하지 않았다. 1-image layout은 local/자동 테스트 검증만 존재한다.
- secondary portrait crop known issue는 해결 완료했다.

홈 UI와 상세 UI는 새로운 회귀가 없는 한 다시 열지 않는다.

### TourAPI detail 안정화 상태

- candidate priority: retry-due failed → never-processed → 7-day TTL.
- state retry: 첫 실패 +30m, 이후 +2h/+4h/+8h/+16h, max +24h.
- detail endpoint의 network/timeout만 500ms 후 1회 inline retry, run 전체 retry budget 25.
- 관측 필드: attempts, retry_attempted/recovered/exhausted, failure_endpoints, network_failure_subtypes, failure_latency.
- production 관측상 inline 500ms retry는 복구 효과가 없었지만, 시간이 지난 state retry에서는 다수 정상 복구됐다.
- 마지막 측정 never_processed: **78**.
- 춘천막국수닭갈비축제 `tourapi-1230074`: 마지막 측정 기준 never-processed, 후보 순위 **18위**.
- 이 상태에서는 network 오류 0%를 만들려고 계속 파지 않는다. 정상 state retry로 결국 success가 되는지 보며 backlog를 소진한다.
- UI 상세 마감 후 backlog 소진/상세 품질 점검으로 돌아간다.

### 현재 로드맵

1. ✅ Cloudflare 운영 기반 / 기본 서비스
2. ✅ 홈 UI v2
3. ✅ **상세페이지 UI v2 production 마감**
4. 🟡 **TourAPI detail backlog 소진 / recovery 확인 — 현재 위치**
5. ⏳ 공식 상세 enrichment 품질 강화
6. ⏳ 전국 municipal/source coverage 확대
7. ⏳ SEO / Search Console / 검색 유입 점검
8. ⏳ 모바일 최종 polish
9. ⏳ 수익화 준비
10. ⏳ Zero-Human 운영 자동화 최종 점검

다음 세션은 production D1을 read-only로 다시 측정해 backlog가 실제로 감소했는지 확인한다. 마지막 측정값 never_processed `78`과 `tourapi-1230074` 후보 순위 `18`은 과거 마지막 관측값일 뿐 최신값으로 단정하지 않는다.

### 새 채팅 시작 시 고정 순서

사용자가 `갈틈작업이어하자`라고 하면 답변/작업 전에 반드시:

1. `AGENTS.md`
2. `PROJECT_CONTEXT.md`
3. `NEXT_CHAT_HANDOFF.md`
4. `docs/WORKING_RULES.md`
5. UI/상세 작업이면 `docs/UI_V2_DIRECTION.md`
6. 최신 `origin/main`, 최근 commit, working tree, 미커밋 변경 확인

실제 code/production > PROJECT_CONTEXT > NEXT_CHAT_HANDOFF > 세부 규칙 문서 순으로 우선한다.
