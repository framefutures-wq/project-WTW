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
9. 태백시 / 서울 한강 municipal onboarding과 홈/상세 UI v2는 완료됐다. **현재는 전국 municipal/source coverage 확대를 이어간다.** TourAPI detail backlog/recovery는 2026-09-24 11:00 KST scheduled watchdog 관찰 대기이며 그 전까지 해당 계통은 동결한다.

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

## 2026-09-23 Phase 6A — municipal production one-shot 검증

- reusable runner `npm run municipal:once`를 추가했다. preview alias/version만 upload하고 live Worker route/Cron은 바꾸지 않으며 nonce POST는 `runMunicipalAutonomous(env)`만 호출한다. production D1과 기존 AI binding/vars를 임시 config에 전달하고 TourAPI는 명시적으로 false로 둔다.
- production D1 one-shot은 **정확히 1회** 실행됐다(2026-09-23T11:26:07.554Z 관측). 9개 registry 중 7개가 관측됐고, 71 candidates: AUTO_PUBLISH 20 / AUTO_RETRY 26 / AUTO_EXCLUDE 11 / POLICY_SKIP 5 / EXPIRED 9였다. source_errors는 2건이다.
- 수원은 공식 목록 31건으로 source당 25건 circuit breaker에 걸렸고, 태백은 공식 endpoint fetch timeout으로 누락됐다. 재실행하지 않았다. 인천 포함 나머지 7개 source는 event 20건을 publish/revalidate했다.
- 다음 순서는 **B → E → 내일 C → D**. A의 수원 pagination/circuit-breaker 및 태백 timeout 원인만 해당 bounded task에서 처리하고, A one-shot을 반복하지 않는다.

### Phase 6A follow-up — 수원 25건 bounded selection

- 수원처럼 정상적인 non-pagination canonical list가 25건을 넘으면 source 전체를 실패시키지 않는다. identity dedupe 후 진행중 → 가까운 미래 → 이후 미래 → 종료 순으로 deterministic 정렬하고 최대 25건만 downstream 처리한다. 같은 날짜는 stable candidate identity로 tie-break한다.
- `MAX_PER_SOURCE=25`은 유지한다. single-list input은 100건 hard cap을 넘어가면 기존 circuit breaker로 fail-closed하며, pagination source의 기존 merge/selection은 바꾸지 않는다.
- 수원 31-row fixture는 source breaker 없이 25건을 선택하는 targeted test로 고정했다. live 공식 URL 재확인은 2026-09-23 연결 timeout으로 완료하지 못했으며, production municipal one-shot/수동 Cron은 재실행하지 않는다.
- 다음 순서는 **B 전국 inventory → E ACTIVE-ready batch → 내일 C 10시 → D 11시**. source self-healing(공식 source URL/platform 변경 감지 후 대체 공식 source를 안전하게 재탐색·검증·전환하는 No-Human 복구 계층)은 Phase 6 후반 과제로만 기록하며 이번에는 구현하지 않는다.

## 2026-09-23 TourAPI detail orchestration 보완

- candidate priority, retry schedule, failure reason observability를 보완했다. parser/enrichment 규칙, 처리량(25 events / 75 requests), endpoint 수는 변경하지 않았다.
- transient network/timeout detail endpoint만 500ms 후 1회 재시도하며, run 전체 retry budget은 25회로 제한한다. logical requested(최대 75)는 유지하고 실제 호출량은 `attempts`로 별도 관측한다.
- detail run message에 `retry_attempted`, `retry_recovered`, `retry_exhausted`, `failure_endpoints`, `network_failure_subtypes`, `failure_latency` sanitized 집계를 남긴다.
- 2026-09-23 production 관측에서 network 최종 실패 8건은 `unknown_network`·`under_1s`였고 inline retry 복구는 0건이었다. 다음 작업은 이 runtime subtype이 왜 원문 없이 unknown으로 분류되는지 안전하게 진단하는 bounded audit이다.

## 2026-09-23 최신 인수인계 — TourAPI 관찰 대기 / municipal coverage 재개

### 실제 최신 기준

- municipal onboarding implementation main: `b8ea6f0` — `feat: support split-date municipal tables`
- 상세 UI production 기준 main: `eaa56db` — `fix: preserve secondary detail poster`
- 현재 production Worker version: `ec68fe6b-62bc-40da-b4af-aa92c1137ba5`
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

### Municipal/source coverage — 대전 onboarding 완료

- `daejeon-fvu`를 `generic_fallback`으로 등록했다.
- `https://daejeon.go.kr/fvu/FvuEventList.do?menuSeq=504` 공식 source를 사용하며 전용 parser는 없다.
- generic table extractor가 명시적 시작일/종료일 분리 컬럼과 행별 테마 allowlist를 지원한다. `공연`, `전시`, `축제/이벤트/행사`, `체육`만 허용하고 `기타`는 제외한다.
- live read-only dry-run은 `generic_html`, 10 candidates, 10 complete, parse error 0으로 통과했다. 기존 Worker에 배포했고 production 기본 smoke는 desktop/mobile 모두 통과했다.
- municipal cron 수동 실행과 D1 write는 하지 않았다. 다음 위치는 다른 공식 municipal 행사 목록 source 1개를 같은 read-only survey로 조사하는 것이다.

### 인천 source onboarding — ACTIVE / production deployed

- 공식 canonical: `https://www.incheon.go.kr/res/RE050101/`.
- 12페이지 × 페이지당 10건이며 시작일 내림차순이다. page 1은 가장 먼 미래 행사라 현재 worker의 단일-page fetch와 맞지 않는다.
- page 1~3의 문화행사 gate 보강 후 30건 분포는 MAIN 21 / NEARBY_ONLY 2 / REVIEW 7 / EXCLUDE 0이다. 뮤지컬·콘서트·연주회·독창회·개인전·회원(작품)전·작가(회)전 등 명시적 장르만 MAIN으로 올렸고, 단순 공연/음악회는 NEARBY_ONLY에 남겼다.
- 기념식·성과공유회·교육·세미나·기관 업무 등 행정/교육 신호는 문화 키워드보다 먼저 EXCLUDE한다. `성과공유회 기념 콘서트` 회귀도 EXCLUDE다.
- raw HTML의 literal `<광화문연가>` 같은 제목 손실은 공통 cleaner 보강으로 해결했다.
- registry-level bounded pagination 공통 기능도 완료했다. `curPage` 1~3 live dry-run은 각 10건, `generic_html` healthy, 총 30 unique/core-complete, parse error 0이었다. page 순서 대신 가까운 미래 시작일 우선으로 병합했으며, 중복 identity는 없었다.
- municipal daily publish cap starvation도 해결했다. `MAX_PUBLISH=10`은 유지하되 신규·payload 변경·state 없는 기존 candidate만 mutation slot을 소비한다. 동일 payload의 verified revalidation은 slot을 소비하지 않아 뒤쪽 신규 candidate를 막지 않으며, retry canonical refresh도 같은 기준을 사용한다.
- `incheon-res`를 `generic_fallback` ACTIVE source로 등록했고, 전용 parser나 category allowlist는 없다. `curPage` 1~3 bounded pagination을 사용한다.
- production Worker Version: `a9714493-3e39-4fa6-8621-96265d5cc355`. galteum.com basic smoke 및 desktop/mobile production browser smoke가 통과했다.
- municipal cron은 수동 실행하지 않았다. 첫 실제 ingestion은 **2026-09-24 10:00 KST base cron 이후** read-only D1/sync_runs로 확인한다.

### 울산 source 조사 — 보류

- 조사 source: `https://ulsan.go.kr/y/yes/main.do`.
- session 없는 main URL은 HTTP 200이지만 내부 링크 다수가 `;jsessionid=...`로 재작성되고, 축제 detail은 `ulsanculture.kr` 외부 host를 사용한다.
- featured 영역은 `div.swiper-slide[role=listitem]` 기반이며 raw 날짜도 `26.10.15` 같은 2자리 연도뿐이라 현재 full-year fail-closed 정책으로 candidate를 만들 수 없다.
- 고정 featured 8건 수준이며 구·군 탭 중복도 있어 durable canonical 전체 목록으로 보기 어렵다.
- 현재 source는 **보류**. 울산 안에서 full-year 날짜 + session 없는 공식 detail URL을 제공하는 별도 canonical 목록을 read-only로 1개만 추가 조사한다.
- 그런 source가 없으면 울산모아는 onboarding 대상에서 제외하고 다음 지역으로 이동한다.

### TourAPI detail 안정화 상태 — 관찰 대기

- candidate priority: retry-due failed → never-processed → 7-day TTL.
- state retry: 첫 실패 +30m, 이후 +2h/+4h/+8h/+16h, max +24h.
- 최신 production D1 read-only snapshot: 대상 219 / success 123 / empty 0 / failed 18 / never_processed 78.
- failed 18건은 모두 retry-due, retry-waiting 0. failure_count는 1회 8건 / 2회 10건.
- 최근 manual detail run은 candidates 25 / enriched 16 / failed 9였고, retry_attempted 8 / retry_recovered 0 / retry_exhausted 8이었다.
- 주요 실패는 network_or_timeout / unknown_network이며, 최신 측정까지 inline retry recovery는 0이다.
- 춘천막국수닭갈비축제 `tourapi-1230074`는 never_processed, 당시 후보 우선순위 19위.
- 가장 최근 run은 manual이었고, 다음 scheduled watchdog은 **2026-09-24 11:00 KST (02:00 UTC)**다.
- scheduled 결과가 나오기 전에는 recovery 여부를 확정하지 않는다.
- 그 전까지 TourAPI detail 코드 변경 / manual detail run / 공식 상세 enrichment 품질 강화는 보류한다.
- 이 항목은 삭제하거나 완료 처리하지 않고 **관찰 대기**로 유지한다.

### 현재 로드맵

1. ✅ Cloudflare 운영 기반 / 기본 서비스
2. ✅ 홈 UI v2
3. ✅ **상세페이지 UI v2 production 마감**
4. ⏸️ **TourAPI detail backlog 소진 / recovery 확인 — 2026-09-24 11:00 KST scheduled watchdog 관찰 대기**
5. ⏳ **공식 상세 enrichment 품질 강화 — 4번 확인 전 보류**
6. 🟡 **전국 municipal/source coverage 확대 — 인천 첫 scheduled ingestion 확인 후 다음 공식 municipal source 조사, 울산모아는 WATCH**
7. ⏳ SEO / Search Console / 검색 유입 점검
8. ⏳ 모바일 최종 polish
9. ⏳ 수익화 준비
10. ⏳ Zero-Human 운영 자동화 최종 점검

현재는 6번의 다음 공식 source 조사를 진행한다. 4번은 다음 scheduled watchdog 완료 후 동일한 read-only D1 측정으로만 재개하며, 그 전에는 TourAPI detail 계통을 건드리지 않는다.

### 새 채팅 시작 시 고정 순서

사용자가 `갈틈작업이어하자`라고 하면 답변/작업 전에 반드시:

1. `AGENTS.md`
2. `PROJECT_CONTEXT.md`
3. `NEXT_CHAT_HANDOFF.md`
4. `docs/WORKING_RULES.md`
5. UI/상세 작업이면 `docs/UI_V2_DIRECTION.md`
6. 최신 `origin/main`, 최근 commit, working tree, 미커밋 변경 확인

실제 code/production > PROJECT_CONTEXT > NEXT_CHAT_HANDOFF > 세부 규칙 문서 순으로 우선한다.

## 2026-09-23 작업순서 보정 — 인천 collector gap 해결 후 복귀 지점

현재 큰 로드맵은 변경하지 않는다. 현재 작업은 여전히 **6. 전국 municipal/source coverage 확대**다.

다만 source 실패 원인을 앞으로 다음처럼 구분한다.

- ACTIVE: 현재 공통 파이프라인으로 안전하게 읽고 실제 행사 등록/갱신까지 가능한 공식 source.
- WATCH: 공식 source이지만 source 자체의 현재 구조/정보가 자동 등록 조건을 만족하지 못함. 매일 재검증 대상으로 설계한다.
- COLLECTOR GAP: source 데이터는 충분히 좋은데 현재 갈틈 공통 extractor/pagination/selection이 못 읽는 경우. 기다리지 않고 공통 수집기 개선 대상으로 처리한다.
- EXCLUDE: 비공식, 정책상 부적합, 또는 반복 관찰 가치가 없는 source.

### 현재 분류

- 인천 온라인통합예약: **ACTIVE**
  - 공식 데이터 자체는 행사명/장소/full-year 기간/운영기관/문의/포스터 등 품질이 충분하다.
  - generic list extractor의 `<dt>일자</dt>` full-year 기간 파싱과 literal `<...>` title preservation 1단계를 완료했다.
  - live dry-run은 `generic_html`, 10 candidates, 10 core-complete, parse error 0이며 `뮤지컬 <광화문연가>`도 보존됐다.
  - bounded pagination은 완료했다. `curPage` 1~3을 bounded fetch해 각 10건, 총 30 unique/core-complete를 `generic_html`로 추출했고 parse error는 없었다. candidate는 현재/가까운 미래 우선으로 deterministic merge된다.
  - 문화행사 selection도 완료했다. 명시적 일반 대중 문화행사는 MAIN, 단순 공연/음악회/합창은 NEARBY_ONLY, 행정·교육 신호는 EXCLUDE로 우선 처리한다. 직전 30건 live snapshot의 최종 deterministic 분포는 MAIN 21 / NEARBY_ONLY 2 / REVIEW 7 / EXCLUDE 0이다. 남은 REVIEW는 장르 신호가 없는 서정적 제목, 동문전·기념전 등으로 보수적으로 유지했다. 최종 키워드 추가 뒤 공식 host fetch가 연결 단계에서 실패했으나, 해당 `회원작품전` 한 건의 REVIEW→MAIN 전환은 targeted regression으로 고정했다.
  - daily publish cap은 신규/변경 mutation만 세므로 앞쪽 동일 payload 재검증이 인천 신규 MAIN 후보를 starvation시키지 않는다.
  - `incheon-res` registry onboarding과 Worker production deploy를 완료했다. Worker Version은 `a9714493-3e39-4fa6-8621-96265d5cc355`이며, 첫 실제 scheduled ingestion은 2026-09-24 10:00 KST base cron 이후에만 read-only로 확인한다.
- 울산: **WATCH 확정**
  - 기존 울산모아는 raw 날짜가 2자리 연도, 외부 detail host, sessionized link, featured-only 구조라 source-side 제약이 크다.
  - alternate official canonical인 `https://tour.ulsan.go.kr/tour/korean/unit/fstvl/list.ulsan?mId=001003001000000000&searchDvsn1=1`도 최종 조사했다. 공식 울산관광 월별축제 15건 목록이지만 list core는 월/제목/주소 중심이고 full-year 행사기간이 없다.
  - 일부 detail은 2026 full-year 기간을 제공하지만, 울산고래축제처럼 2026 행사 설명은 있어도 행사기간 필드가 `~`로 비어 있는 항목이 공존한다. source 자체가 전체 항목에 exact core를 일관되게 제공하지 않으므로 현재 Zero-Human ACTIVE source로 등록하지 않는다.
  - 따라서 울산은 COLLECTOR GAP으로 공통 수집기를 더 복잡하게 만들기보다 WATCH로 유지하고 다음 지역 조사로 이동한다.

### 현재 문제 해결 순서

한 프롬프트에 몰아넣지 않고 bounded task로 나눈다.

1. ✅ 인천 generic extractor의 self-contained `<dt>일자</dt>` full-year 기간 파싱 + literal angle-bracket title 보존을 공통 방식으로 해결하고 targeted regression 검증.
2. ✅ registry-level bounded pagination을 공통으로 구현. source당 1~3 page hard cap, candidate identity dedupe, 현재/가까운 미래 우선, pagination source의 retry canonical refresh 재발견을 검증했다. non-pagination source의 기존 MAX_PER_SOURCE=25 circuit breaker 의미는 유지된다.
3. ✅ 일반 대중 대상 뮤지컬/콘서트/연주회/전시류의 명시적 signal을 MAIN으로 보강하고, 기념식/성과공유회/교육/포럼/행정성 신호는 우선 EXCLUDE하도록 문화행사 selection gate를 검증했다.
4. ✅ daily publish cap은 신규/변경 mutation만 소비하도록 보강해 앞쪽 동일 payload revalidation의 starvation을 막았다.
5. ✅ 인천 source를 ACTIVE onboarding하고 live read-only dry-run → targeted tests/typecheck → 기존 Worker deploy → production smoke로 닫았다. municipal cron은 수동 실행하지 않는다.
6. **다음: 2026-09-24 10:00 KST scheduled base cron 이후 인천 첫 ingestion을 read-only로 확인한 뒤, Phase 6 전국 municipal/source coverage의 다음 공식 source 조사로 복귀한다.** 인천 때문에 UI/SEO/수익화로 이동하지 않는다.

### 고정 시간 작업

- TourAPI detail Phase 4는 **2026-09-24 11:00 KST scheduled watchdog 결과가 나온 직후 read-only D1 snapshot으로 한 번 확인**한다.
- 이 체크는 현재 Phase 6 개발을 폐기하는 전환이 아니라 운영 checkpoint다.
- watchdog 전에는 TourAPI detail 코드 수정/manual run 금지.
- checkpoint 후 Phase 4 상태만 갱신하고, 별도 장애/고위험 문제가 없으면 현재 진행 중인 municipal coverage 작업으로 복귀한다.
- Phase 5 공식 상세 enrichment는 Phase 4 결과가 확인된 뒤 별도 우선순위로 다시 결정한다.

## 2026-09-23 10시 전 작업 운영

- 인천은 ACTIVE/production 배포 완료이며 첫 실제 scheduled ingestion은 2026-09-24 10:00 KST 이후 read-only로 확인한다.
- 10시까지 개발을 멈추지 않는다. 그 전에는 production/D1을 건드리지 않는 **municipal source 조사·분류·read-only dry-run**을 진행한다.
- 우선순위는 **울산 alternate canonical 최종 조사 → 부산/대구/광주/세종 등 다음 광역지역 공식 source 조사 → ACTIVE-ready / WATCH / COLLECTOR GAP / EXCLUDE 분류 → 바로 온보딩 가능한 후보 3~5개 대기열 확보**다.
- 10시 인천 scheduled ingestion과 11시 TourAPI watchdog이 정상임을 확인하면, ACTIVE-ready 후보를 지역마다 하루씩 기다리지 않고 bounded task로 등록하고 **3~5개 단위 batch deploy/다음 정규 Cron 검증**을 기본 운영 방식으로 삼는다.
- 공통 collector 자체를 크게 수정하는 새 유형이 발견된 경우에만 별도 운영 검증을 둔다. 단순 Registry onboarding마다 24시간 대기하지 않는다.

### 부산 source 조사 — COLLECTOR GAP

- 공식 canonical 후보: `https://www.visitbusan.net/schedule/list.do?boardId=BBS_0000009&menuCd=DOM_000000204012000000&month=0` (Visit Busan 축제·행사).
- Visit Busan은 페이지 하단에 `Copyright Busan Metropolitan City`를 명시하고 부산광역시 개인정보/저작권 정책으로 연결되는 공식 관광 채널이다.
- 2026 행사·축제 목록은 제목 + full-year 기간을 안정적으로 제공하고, 월/페이지 단위 목록도 존재한다.
- 대표 detail URL은 `/schedule/view.do?boardId=BBS_0000009&dataSid=...` 형태의 durable first-party URL이다.
- detail 표본에서는 광안리 M 드론×레이저쇼, 별바다부산 나이트마켓, 복천박물관 기획전, 달맞이 문화페스타, 광복로 발코니 뮤직쇼 등이 full-year 기간 + 장소 + 주소를 명시했다.
- 다만 list card 자체에는 venue가 없고 현재 generic collector는 title/date/venue가 같은 self-contained block에 있어야 candidate를 만든다. 따라서 현 구조로는 list만으로 ACTIVE onboarding할 수 없다.
- 일부 광역/분산형 행사(예: 부산돼지국밥대전)는 detail에도 단일 venue가 없으므로, 향후 list→detail core follow-up을 구현하더라도 candidate 단위 fail-closed가 필요하다.
- 분류: **COLLECTOR GAP**. source 품질은 좋지만 현재 공통 collector에 bounded list→detail core fan-out 능력이 없다.
- 10시 전에는 부산 때문에 새 collector 기능을 즉시 구현하지 않고, 대구/광주/세종 등 더 단순한 ACTIVE-ready source 조사를 계속해 3~5개 대기열을 먼저 확보한다.

### 대구 / 광주 / 세종 source 조사 — 10시 전 후보 큐 완료

- **대구: WATCH**
  - 공식 source: `https://tour.daegu.go.kr/index.do?menu_id=00002932&servletPath=%2Findex.do` (대구관광 연간축제일정).
  - 대구광역시 공식 관광 채널이지만 list/detail의 기간이 `01월중`, `매년 10월말, 11월초경`, 연도 없는 월·일 형태 등 recurring/stale 표현이 섞여 있어 2026 exact full-year core를 source-wide로 신뢰할 수 없다.
  - 대구시 본청의 2026 판타지아대구페스타 공지는 6개 봄축제의 exact 날짜·장소를 제공하지만 단발성 공지라 daily Zero-Human canonical source로 쓰지 않는다.
  - source-side exact-date 일관성이 생기기 전까지 WATCH.

- **광주: ONBOARDING-READY 후보 (아직 ACTIVE 아님)**
  - 공식 source: `https://tour.gwangju.go.kr/home/tour/culture/festival.cs?m=315` (광주관광 축제/행사).
  - list card 한 블록에 제목 + `2026.MM.DD ~ 2026.MM.DD` full-year 기간 + 장소 + 연락처/주최/주관/요금이 함께 있어 현재 generic self-contained candidate 요건과 잘 맞는다.
  - 공식 페이지에는 진행중/진행예정 상태와 pagination이 존재하며, pageIndex 기반 다중 페이지가 확인된다.
  - 단, 현재 public fetch로는 `진행 예정`의 실제 query value를 확정하지 못했으므로 Registry 등록 전 bounded live probe에서 상태 query와 page 1~N을 정확히 확인해야 한다.
  - 이 probe가 통과하면 전용 parser 없이 generic_fallback + bounded pagination으로 우선 onboarding 후보.

- **세종: COLLECTOR GAP**
  - 공식 public-source 후보: `https://www.sjcf.or.kr/hangeul/www/prfr/list.do?key=2504150023` (세종시문화관광재단 한글문화도시 공연/전시/교육).
  - list는 유형/진행상태/제목/full-year 기간을 안정적으로 제공하고 first-party detail은 기간 + 장소 + 주최/주관 + 시간/가격을 명시한다.
  - 하지만 list block 자체에는 venue가 없어서 현재 generic collector의 self-contained title/date/venue 요건을 만족하지 못한다.
  - 부산과 같은 bounded list→detail core follow-up 계열의 공통 collector gap으로 분류한다. 단일 축제 사이트 `sjfestival.kr`는 세종 전체 coverage canonical로 사용하지 않는다.

- **10시 전 source 조사 큐는 여기서 닫는다.**
  - 울산 WATCH / 부산 COLLECTOR GAP / 대구 WATCH / 광주 ONBOARDING-READY / 세종 COLLECTOR GAP.
  - 더 많은 지역을 무작정 늘리지 않고, 2026-09-24 10:00 KST 인천 scheduled ingestion과 11:00 TourAPI watchdog을 먼저 확인한다.
  - 두 checkpoint가 정상이고 광주 bounded live probe까지 통과하면 광주를 다음 실제 Registry onboarding 1순위로 진행한다.

## 2026-09-23 확정 — Municipal Source Self-Healing (Phase 6 후반 필수 과제)

- 갈틈의 Zero-Human 목표에는 **source self-healing**을 포함한다.
- 기존 municipal 공식 source의 URL/도메인/플랫폼/페이지 구조가 바뀌면, 현재처럼 단순히 실패를 감지하는 데서 끝내지 않고 장기적으로 다음 자동 복구 계층을 구현한다:
  1. 기존 source 이상/format change 감지
  2. 해당 지자체의 공식 도메인·공식 채널에서 대체 행사 source 자동 탐색
  3. official host/ownership, title/date/venue core, canonical URL, parser/extractor 적합성 검증
  4. 일정 기간 반복 관측으로 안정성 확인
  5. 검증이 충분한 경우에만 Registry source 자동 전환
  6. 기존 source는 안전하게 폐기/비활성화
- 잘못된 페이지를 자동승격하지 않도록 **fail-closed**가 원칙이다. 새 source 검증 실패 시 기존 last-known-good를 유지하고 AUTO_RETRY/관찰 상태를 유지한다.
- 현재 단계에서는 전국 municipal coverage를 먼저 넓혀 실제 source 변경/플랫폼 패턴을 축적하고, 반복되는 유형을 근거로 Phase 6 후반에 공통 self-healing 기능을 구현한다.
- 이 항목은 선택 아이디어가 아니라 **갈틈 No-Human 운영의 필수 후반 과제**로 취급한다.

## 2026-09-23 Phase 6B — 전국 municipal inventory baseline

- `docs/municipal-source-inventory.json`에 17개 광역단체와 228개 하위 시·군·구/제주 행정시, 총 245개 조사 단위를 기록했다. 행정안전부 지방자치단체 행정구역 현황과 행안부 시군구 데이터 스키마를 authority로 남겼다.
- 현재 baseline: ACTIVE 9 / ONBOARDING_READY 1 / COLLECTOR_GAP 2 / WATCH 2 / EXCLUDE 0 / UNREVIEWED 231. 기존 Registry 9개와 울산·부산·대구·광주·세종 상태가 모두 반영됐다.
- `npm run municipal:inventory:check`은 unique key, parent ordering, status enum, summary/queue 일치와 generated JSON/Markdown freshness를 검증한다. 다음 위치는 **전국 inventory baseline 완료 → 다음 B 조사 batch → E onboarding**이다. Registry, D1, Cron, production은 이 작업에서 변경하지 않는다.

## 2026-09-23 Phase 6B — 첫 광역단체 조사 batch

- 첫 deterministic queue 9개 광역단체를 공식 HTTPS source read-only 조사로 확정했다: 강원·충남·제주는 `ONBOARDING_READY`, 충북·전북은 `COLLECTOR_GAP`, 경기·전남·경북·경남은 `WATCH`.
- inventory는 다음 queue 위치(수도권 하위단체부터)로 진행하며, 이번 batch에서는 Registry·collector·D1·production·Cron을 변경하지 않았다. 다음 bounded task는 이 결과를 기준으로 E onboarding을 별도 수행한다.

## 2026-09-23 Phase 6E — ONBOARDING_READY batch probe

- 4개 후보를 current generic collector와 공식 HTTP live probe로 다시 검증했으나 이번 batch의 ACTIVE 승격은 **0개**다. 광주는 legacy page의 `dmgj.kr` detail cross-host/ownership migration을 fail-closed로 `WATCH` 처리했고, 강원은 repeated HTTP timeout으로 `WATCH` 처리했다.
- 충남(`pageIndex=1..3`)과 제주(canonical festival/list)는 official list·full-year core를 제공하지만 current generic extractor가 각각 0 candidates로 fail-closed되어 `COLLECTOR_GAP`으로 되돌렸다. dedicated parser나 list→detail 기능은 추가하지 않았다.
- Registry는 기존 ACTIVE 9개를 유지했다. D1 write, municipal one-shot, Cron manual run, production deploy는 하지 않았다. 다음 운영 순서는 **내일 C 10:00 자동 Cron 검증 → D 11:00 TourAPI watchdog → B deterministic survey queue 재개**다.

## 2026-09-23 Phase 6B — 서울 하위 지자체 첫 조사 batch

- 조사 범위: `seoul-gangnam` → `seoul-dobong` 10개. 모두 HTTPS first-party 공식 구청/산하 문화·관광 source를 live read-only 확인했다. Registry·collector·D1·deploy·Cron/manual ingestion은 변경하지 않았다.
- `seoul-gangnam`: **ONBOARDING_READY** — 강남문화재단 축제 목록. title·2026 full-year date·venue·first-party detail이 같은 목록 블록에 있고 pagination이 확인됨. `https://www.gangnam.go.kr/office/gfac/board/gfac_lifeculture/list.do?mid=gfac_festival06`
- `seoul-gangdong`: **WATCH** — 강동 선사문화축제 일정표는 공식·venue는 확인되나 2025 정적 일정 중심이고 source-wide 2026 full-year canonical listing이 아님.
- `seoul-gangbuk`: **WATCH** — 공식 포털의 개별 축제/문화행사·예약은 확인되나 혼합 feed와 개별 detail 중심으로 durable full-year listing을 확정하지 못함.
- `seoul-gangseo`: **WATCH** — 겸재문화예술제 detail은 2026-05-09와 venue를 명시하지만 source-wide listing/pagination이 확인되지 않음.
- `seoul-gwanak`: **WATCH** — 문화관광소식·예약 detail은 있으나 행사·축제 canonical full-year listing을 확인하지 못함.
- `seoul-gwangjin`: **WATCH** — 주간행사/개별 공지·보도자료는 있으나 source-wide durable 행사 listing을 확인하지 못함.
- `seoul-guro`: **WATCH** — 홈페이지·월간 소식/예약에 개별 core는 있으나 행사·축제 canonical listing이 아닌 혼합 feed 구조임.
- `seoul-geumcheon`: **WATCH** — 소셜허브·미디어홍보에서 행사 게시물은 확인되나 full-year date·venue·durable detail이 함께 유지되는 일정 listing이 아님.
- `seoul-nowon`: **WATCH** — 축제행사/문화공연 메뉴와 개별 안내는 있으나 source-wide durable listing·pagination을 확정하지 못함.
- `seoul-dobong`: **WATCH** — 공식 문화관광 페이지가 장소와 반복 시기를 제공하지만 음력·기념일·월중 표현이 섞여 exact full-year extraction이 불가함.
- 이번 batch의 신규 변화: `ONBOARDING_READY +1`, `COLLECTOR_GAP +0`, `WATCH +9`, `EXCLUDE +0`. 새 collector gap 반복 패턴은 확인하지 않았고, 기존 list→detail/HTML 구조 gap 계열은 구현하지 않았다.
- 조사 후 inventory: ACTIVE 9 / ONBOARDING_READY 1 / COLLECTOR_GAP 6 / WATCH 17 / EXCLUDE 0 / UNREVIEWED 212, 총 245. 다음 queue는 **`seoul-dongdaemun`부터** 시작한다.

## 2026-09-23 Phase 6B — 서울 하위 지자체 두 번째 조사 batch

- 조사 범위: `seoul-dongdaemun` → `seoul-yeongdeungpo` 10개. 모두 HTTPS first-party 공식 구청 또는 산하 문화·관광기관 source를 live read-only 확인했다. Registry·collector·D1·deploy·Cron/manual ingestion은 변경하지 않았다.
- `seoul-dongdaemun`: **WATCH** — 공식 문화행사 feed에 2026 행사와 detail은 있으나 구정소식·교육·문화가 혼합된 homepage feed이며 source-wide venue/full-year durable listing을 확정하지 못함.
- `seoul-dongjak`: **COLLECTOR_GAP** — 공식 통합예약 문화/행사 source는 있으나 JS/API·필터 렌더링과 detail follow-up이 필요해 current generic HTML collector가 self-contained candidate를 안정적으로 읽지 못함.
- `seoul-mapo`: **COLLECTOR_GAP** — 마포문화재단 목록에 title·2026 full-year date·detail은 있으나 venue가 목록에 없어 detail follow-up이 필요함.
- `seoul-seodaemun`: **WATCH** — 공식 문화관광 포털의 축제 index와 공지는 확인되나 source-wide exact full-year date·venue·durable listing을 확인하지 못함.
- `seoul-seocho`: **COLLECTOR_GAP** — 공식 2026 문화·행사달력에 title/date/detail은 있으나 venue와 full-year core가 list에 self-contained로 없음.
- `seoul-seongdong`: **WATCH** — 공식 두모포 페스티벌 detail은 venue와 ‘매년 6월 말~7월 초’를 제공하지만 exact full-year canonical listing을 확인하지 못함.
- `seoul-seongbuk`: **WATCH** — 공식 Festival & Event 영역과 detail은 있으나 static landing 중심으로 exact full-year listing/pagination이 없음.
- `seoul-songpa`: **COLLECTOR_GAP** — 공식 문화관광 calendar에 title/date/detail은 있으나 venue가 목록에 없어 detail follow-up이 필요함.
- `seoul-yangcheon`: **WATCH** — 공식 홈페이지·평생학습 포털의 개별 프로그램은 확인되나 행사·축제의 지속 canonical full-year listing을 확인하지 못함.
- `seoul-yeongdeungpo`: **ONBOARDING_READY** — 공식 문화관광 문화행사 일정 목록에 title·full-year date·venue·first-party detail이 같은 목록 블록으로 확인되고 기간/구분 검색 구조가 있음.
- 반복 collector gap: **4개** — `seoul-dongjak`, `seoul-mapo`, `seoul-seocho`, `seoul-songpa`. 공통 패턴은 **list에 title/date는 있으나 venue가 없거나 JS/API 렌더링으로 현재 generic collector가 self-contained core를 읽지 못하고 detail follow-up이 필요한 유형**이다. 이번 task에서는 구현하지 않았다.
- 이번 batch 변화: `ONBOARDING_READY +1`, `COLLECTOR_GAP +4`, `WATCH +5`, `EXCLUDE +0`. 누적 `ONBOARDING_READY`는 **2개**(`seoul-gangnam`, `seoul-yeongdeungpo`)다.
- 조사 후 inventory: ACTIVE 9 / ONBOARDING_READY 2 / COLLECTOR_GAP 10 / WATCH 22 / EXCLUDE 0 / UNREVIEWED 202, 총 245. 다음 deterministic queue는 **`seoul-yongsan`부터** 시작한다.

## 2026-09-23 Phase 6 — 공통 municipal list→detail core follow-up 구현

- `MunicipalSourceDefinition.listDetailFollowup` opt-in capability를 추가했다. 선언이 없는 기존 ACTIVE 9 source는 기존 list-only extraction 경로를 그대로 유지하며, 현재 Registry에는 이 capability를 켠 source가 없다.
- opt-in source만 반복 list/card block에서 **title + allowlisted first-party durable detail URL**과 event/date/category signal을 가진 partial을 제한적으로 만들고, source/run당 detail fetch를 **최대 10건**으로 제한한다. active → 가까운 미래 → 이후 미래 → 종료 → date-less stable identity 순으로 deterministic 선택한다.
- detail final redirect host도 allowlist를 다시 검증한다. detail에서 title identity, explicit full-year start/end, venue가 모두 확인될 때만 complete candidate가 되고, list/date/venue conflict·cross-host·missing core·title mismatch는 candidate 단위로 fail-closed한다. 한 detail failure가 다른 candidate를 막지 않는다.
- follow-up으로 이미 읽은 detail HTML은 worker `SourceCandidate`에 보존해 MAIN/NEW enrichment가 같은 URL을 다시 fetch하지 않는다.
- read-only live probe (2026-09-23 KST):
  - `busan`: list partial 6, attempted 6, complete 6, rejected 0. final gate는 MAIN 4 / NEARBY_ONLY 2로 **실제 unlock 가능**을 확인했다.
  - `seoul-mapo`: partial 0, attempted 0. 현재 live list의 detail action은 JavaScript `seq` 형태라 generic HTTPS detail URL 최소 요건을 충족하지 않아 별도 JS/action URL gap으로 유지한다.
  - `seoul-songpa`: partial 4, attempted 4, complete 0; `detail_missing_core`/`detail_title_mismatch`로 fail-closed했다. canonical event-card recognition은 후속 onboarding 검증이 필요하다.
  - `sejong`: partial 3, attempted 3, complete 0; navigation-like links의 `detail_missing_core`로 fail-closed했다. actual event-list block recognition은 후속 onboarding 검증이 필요하다.
- 여전히 별도 범위: `seoul-dongjak` JS/API rendered, `chungnam`·`jeju` generic HTML card structure. dedicated parser, Registry onboarding, D1 write, Cron/manual ingestion, production deploy는 하지 않았다.
- 다음 순서: **C 2026-09-24 10:00 KST 기존 ACTIVE 9 read-only Cron 검증 → D 2026-09-24 11:00 KST TourAPI watchdog read-only 검증 → 검증된 list→detail source (우선 부산) batch onboarding**. 이후 조사 queue는 `seoul-yongsan`부터 재개한다.

## 2026-09-23 Phase 6B — 서울 하위 지자체 마지막 5개 조사 완료

- 서울 25개 자치구의 deterministic 조사 batch를 모두 완료했다. 마지막 범위 `seoul-yongsan`, `seoul-eunpyeong`, `seoul-jongno`, `seoul-jung`, `seoul-jungnang`은 모두 공식 HTTPS source를 live read-only 확인했다.
- `seoul-yongsan`: **COLLECTOR_GAP** — 용산문화재단 listing은 title·2026 full-year 기간·venue·static detail을 한 항목에 제공하나 `slide` card HTML로 generic extractor 0건.
- `seoul-eunpyeong`: **COLLECTOR_GAP** — 은평문화재단 문화사업 일정은 title·full-year date·venue·detail이 있으나 current generic extractor 0건.
- `seoul-jongno`: **COLLECTOR_GAP** — 종로문화플랫폼 행사/축제 listing은 self-contained core와 same-host detail/pagination이 있으나 current generic extractor 0건.
- `seoul-jung`: **COLLECTOR_GAP** — 중구문화재단/충무아트센터 문화 listing은 current title·full-year 기간·venue·detail을 제공하나 main card 구조에서 generic extractor 0건.
- 위 4개는 새 list→detail follow-up으로 unlock되는 유형이 아니라 **기존 충남·제주와 같은 generic HTML card structure gap**이다.
- `seoul-jungnang`: **COLLECTOR_GAP** — 중랑문화재단 canonical list는 Svelte/JS rendering shell이어서 static HTML generic collector 및 list→detail follow-up 대상이 아니다. `seoul-dongjak`과 같은 JS/API rendering gap이다.
- 이번 batch 변화: `ONBOARDING_READY +0`, `COLLECTOR_GAP +5`, `WATCH +0`, `EXCLUDE +0`. 누적 READY는 2개다. inventory는 ACTIVE 9 / READY 2 / GAP 15 / WATCH 22 / EXCLUDE 0 / UNREVIEWED 197 (총 245).
- Registry·collector·D1·production·Cron/manual ingestion은 변경하지 않았다. C **2026-09-24 10:00 KST** read-only Cron 검증과 D **2026-09-24 11:00 KST** TourAPI watchdog 순서는 유지한다.
- 다음 deterministic survey queue는 **`incheon-강화`부터**다. C/D checkpoint 뒤 검증된 부산 list→detail source onboarding batch를 별도 bounded task로 수행한다.

## 2026-09-23 Phase 6B — 인천 행정구역 master inventory 기준 정정

- 공식 현행 기준(2026-07-01 이후)으로 인천 하위 행정구역을 옛 2군 8구에서 **2군 9구** 11개로 바로잡았다. 광역 인천 ACTIVE source 및 Registry `incheon-res`는 유지했다.
- 다음 deterministic queue는 새 행정구역 기준 **`incheon-강화`부터** 시작한다. 다음 task는 현행 인천 11개 하위단체 source 조사다.
- inventory validation 후 집계: 총 246; ACTIVE 9 / READY 2 / GAP 15 / WATCH 22 / EXCLUDE 0 / UNREVIEWED 198. production/D1/Cron은 변경하지 않았다.

## 2026-09-23 Phase 6B — 전국 행정구역 baseline 현행화

- 2026-09-23 기준 전국 광역단체와 하위 행정단위 baseline을 행정안전부 최신 월간 행정기관 자료 및 현행 법령/지자체 자료와 대조했다. 인천은 현행 2군 9구, 11개 하위단체가 이미 맞아 재수정하지 않았다.
- 2026-07-01 시행 전남광주통합특별시 설치 특별법에 따라 구 광주광역시·전라남도 root 두 개를 제거하고 `jeonnam-gwangju` UNREVIEWED root 하나로 통합했다. 기존 5개 자치구와 22개 시·군의 UNREVIEWED 상태를 유지하고 새 root에 WATCH를 상속하지 않았다. 종전 Gwangju/Jeonnam root의 WATCH 판단은 당시 조사 기록으로만 보존한다.
- 광역 root 16개, 연구 단위 총 245개. ACTIVE 9 / READY 2 / GAP 15 / WATCH 20 / EXCLUDE 0 / UNREVIEWED 199. 인천 child 11개, 통합특별시 child 27개. 제주 행정시 2개는 기존 research-unit 정책대로 포함한다.
- 갱신된 전체 deterministic queue는 **`jeonnam-gwangju` root부터**이며, 그 다음 하위 조사 대상은 **`incheon-강화`**다. 이번 작업은 baseline/data/docs만 변경했으며 Registry, collector, production, D1, Cron/manual ingestion에는 영향이 없다.

## 2026-09-23 Phase 6B — 전남광주통합특별시 광역 root source 조사

- 통합특별시 공식 누리집(`https://www.jeonnam.go.kr/`)은 현재 통합특별시 명칭·주소를 표시하고 관광객 메뉴에 `시군축제 일정`을 노출한다. 다만 실제 listing target과 지속성, 행사별 full-year date·venue·durable detail·pagination은 확인하지 못했다. 구 전남 legacy domain의 HTTP probe가 timeout/DNS 오류였으므로 구 광주 source와 결합하거나 이전 root 판정을 상속하지 않았다.
- 따라서 `jeonnam-gwangju`는 **WATCH** (`official_tourism_listing_unverified`, `source_core_unverified`)로 분류한다. live listing이 열리지 않아 current collector extraction 적합성도 판정 불가다.
- inventory summary는 ACTIVE 9 / READY 2 / GAP 15 / WATCH 21 / EXCLUDE 0 / UNREVIEWED 198, 총 245다. root가 queue에서 빠져 다음 deterministic 조사 대상은 **`incheon-강화`**다. validation 후 commit/push 예정이며 production·D1·Cron/manual ingestion·Registry·collector는 변경하지 않는다.

## 2026-09-23 Phase 6B — 현행 인천 하위 11개 공식 행사 source 조사

- 현행 2군 9구의 하위 11개를 모두 조사 완료했다. 신설 4개(검단·서해·영종·제물포)는 현재 각 구청 도메인과 현행 구 명칭/운영 주체를 확인했으며, 옛 서구·중구·동구 source를 자동 승계하지 않았다.
- `incheon-강화`: **WATCH** — 구청 문화관광의 행사/전시 일정과 문화행사 영역이 모두 현재 게시물 없음. 개별 2026 축제 공지는 단발성이므로 지속 source로 승격하지 않았다.
- `incheon-검단`: **WATCH** — 신설 검단구의 현재 문화행사 페이지에서 2026 가을 공연·전시는 확인했으나 계절별 편집 안내이고 행사별 장소·durable detail 및 listing/pagination이 불충분하다. 옛 서구 source는 사용하지 않았다.
- `incheon-계양`: **WATCH** — 계양시설관리공단 문화회관 공연일정은 title·연도 있는 일시·장소·detail·3페이지가 있으나 live 본문/검색 캐시의 갱신 시점이 서로 달라 2026-09 현재 지속 갱신을 검증하지 못했고, 한 공연장 편성은 구 전체 행사 source를 대변하지 않는다.
- `incheon-남동`: **WATCH** — 남동문화재단 목록은 title·날짜·venue·detail 및 bounded pagination 형태지만 live 요청 502, 검색 인덱스는 2026-05 항목으로 현재 freshness를 확정하지 못했다.
- `incheon-미추홀`: **WATCH** — 구청의 현재 행사 공지는 개별 2026 title/date/venue를 제공하나 durable source-wide listing이 확인되지 않아 단발 공지를 승격하지 않았다.
- `incheon-부평`: **WATCH** — 공식 부평풍물대축제 소개/detail은 확인했지만 연례축제 한 건 외에 full-year 행사 listing과 pagination을 확보하지 못했다.
- `incheon-서해`: **ONBOARDING_READY** — 신설 서해구의 공식 전체행사 목록에서 현 구 주관 2026 항목의 title·explicit full-year start/end·venue·same-host durable detail과 34페이지 bounded listing을 확인했다. 옛 서구 이름의 항목은 자동 승계하지 않고 현재 서해구로 확인되는 항목만 대상. 광역 인천 ACTIVE와 중복 가능성은 있으나 지역-specific source라는 점을 기록했다.
- `incheon-연수`: **WATCH** — 공식 기타축제정보 목록은 live 게시글 없음(1/0). 개별 축제 소개는 있지만 source-wide exact full-year date·venue·detail이 충족되지 않는다.
- `incheon-영종`: **WATCH** — 신설 영종구의 현재 공식 축제·공연 목록은 2026-08-15 무의도 춤축제 한 건과 장소/detail을 제공하나 마감된 단일 항목뿐이라 지속적 future listing을 확정하지 못했다. 옛 중구 source는 계승하지 않았다.
- `incheon-옹진`: **WATCH** — 공식 HTTPS 홈페이지 요청이 400으로 실패해 구청의 현재 행사 source와 core를 확인하지 못했다. 비공식/의회 페이지는 canonical로 쓰지 않았다.
- `incheon-제물포`: **COLLECTOR_GAP** — 신설 제물포구가 연결하는 문화체육센터 listing은 91건·5페이지이나 목록은 title/등록일 위주다. 현재 구 주최 2026 전시 detail에는 full-year 기간·venue·주최가 명시되어 구현된 bounded list→detail follow-up이 해결할 수 있는 기존 공통 gap 유형이다. 옛 동구 source는 자동 승계하지 않았다.
- 이번 batch 변화: `ONBOARDING_READY +1`, `COLLECTOR_GAP +1`, `WATCH +9`, `EXCLUDE +0`. 누적 READY는 **3개**(`seoul-gangnam`, `seoul-yeongdeungpo`, `incheon-서해`)이며, 별도 Phase 6E 후보로만 보존하고 이번에는 onboarding하지 않았다. 신규 반복 GAP 패턴(동일 인천 batch 2개 이상)은 없고, 제물포 1건은 기존 `list_detail_core_followup_needed` 계열이다.
- inventory: 총 245; ACTIVE 9 / READY 3 / GAP 16 / WATCH 30 / EXCLUDE 0 / UNREVIEWED 187. 인천 하위 11개는 모두 survey queue에서 제거됐고 옛 중구·동구·서구 key는 생성되지 않았다. 다음 deterministic queue는 **`gyeonggi-가평`**부터다.
- Registry·collector·production·D1·Cron/manual ingestion은 변경하지 않았다. C **2026-09-24 10:00 KST** 기존 ACTIVE 9 read-only Cron 검증 → D **2026-09-24 11:00 KST** TourAPI watchdog read-only 검증 순서를 유지한다.

## 2026-09-23 Phase 6B — 경기도 하위 첫 10개 source 조사

- `gyeonggi-가평`: **COLLECTOR_GAP** — 공식 문화축제교육행사 게시판은 8페이지로 갱신되지만 목록은 제목/작성일 중심이며 행사 core는 first-party detail follow-up이 필요하다.
- `gyeonggi-과천`: **ONBOARDING_READY** — 과천문화재단 공연·전시 일정에서 title·명시 2026 날짜/기간·venue·detail이 동일 항목에 있고 필터/bounded listing을 확인했다.
- `gyeonggi-광명`: **WATCH** — 공식 문화행사 달력의 2026-09 목록은 비어 있고 별도 행사 feed는 행정·모집 콘텐츠가 혼합되어 지속 source core를 확정하지 못했다.
- `gyeonggi-광주`: **ONBOARDING_READY** — 경기도 광주시 공식 문화·행사 목록은 30페이지로 갱신되며 항목에서 title·명시 2026 일자/기간·venue·상세 정보를 확인했다.
- `gyeonggi-구리`: **WATCH** — 월간 시청 일정은 행정/교육/모집 일정과 혼합되고 source-wide event core가 일관되지 않다.
- `gyeonggi-군포`: **WATCH** — 공식 문화예술행사 영역은 live지만 최근 목록이 모집/공고 중심이며 지속적인 관람 행사 core listing을 확인하지 못했다.
- `gyeonggi-김포`: **WATCH** — 공식 문화관광 월간 일정은 현재 조회 월에 결과가 없고, 별도 축제 페이지는 소개형 항목이라 지속 full-year listing을 확정하지 못했다.
- `gyeonggi-남양주`: **COLLECTOR_GAP** — 공식 남양주문화재단 일정은 title/date/list를 제공하지만 venue와 full-year 기간은 durable detail에서 보완해야 해 기존 bounded list→detail follow-up gap이다.
- `gyeonggi-동두천`: **WATCH** — 시청/산하 문화시설의 현재 지속 행사 listing에서 필수 core와 pagination을 확인하지 못했다.
- `gyeonggi-성남`: **WATCH** — 공식 월간 행사/강좌/공모 및 관광 콘텐츠에 교육·모집·행정 일정이 혼합되어 source-wide core가 일관되지 않다.
- 이번 변화: `ONBOARDING_READY +2`, `COLLECTOR_GAP +2`, `WATCH +6`, `EXCLUDE +0`. 누적 READY **5개**: `seoul-gangnam`, `seoul-yeongdeungpo`, `incheon-서해`, `gyeonggi-과천`, `gyeonggi-광주`. Phase 6E 후보 충족; 이 batch에서는 onboarding하지 않는다.
- 반복 GAP: **list_detail_core_followup_needed 2개** — `gyeonggi-가평`, `gyeonggi-남양주`. 구현된 공통 bounded follow-up 적용 후보로 기록했으며 이번에는 Registry/collector를 변경하지 않았다.
- inventory 총 245: ACTIVE 9 / READY 5 / GAP 18 / WATCH 36 / EXCLUDE 0 / UNREVIEWED 177. 다음 deterministic queue는 **`gyeonggi-시흥`부터**다. C **2026-09-24 10:00 KST** → D **2026-09-24 11:00 KST** checkpoint 순서는 유지한다.
