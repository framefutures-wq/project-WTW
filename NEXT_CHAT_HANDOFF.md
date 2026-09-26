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

## 2026-09-23 Phase 6B — 경기도 하위 지자체 조사 완료

- 경기도 하위 31개 시·군의 source survey를 완료했다. 기존 ACTIVE 5개(수원·고양·화성·부천·파주), 앞선 조사 10개에 이어 마지막 UNREVIEWED 16개를 live read-only 확인해 경기 하위 queue를 닫았다.
- 마지막 16개 분류: **ONBOARDING_READY 7**(`gyeonggi-의정부`, `gyeonggi-평택`, `gyeonggi-하남`, `gyeonggi-용인`, `gyeonggi-이천`, `gyeonggi-포천`, `gyeonggi-여주`), **COLLECTOR_GAP 2**(`gyeonggi-안양` access-protection, `gyeonggi-안성` generic HTML static multi-event structure), **WATCH 7**(`gyeonggi-안산`, `gyeonggi-오산`, `gyeonggi-시흥`, `gyeonggi-의왕`, `gyeonggi-양주`, `gyeonggi-연천`, `gyeonggi-양평`). EXCLUDE는 없다.
- READY 누계는 **12개**다: 기존 `seoul-gangnam`, `seoul-yeongdeungpo`, `incheon-서해`, `gyeonggi-과천`, `gyeonggi-광주` + 이번 7개. C/D checkpoint 전에는 Registry onboarding을 하지 않으며, 이후 Phase 6E에서 3~5개 단위 bounded onboarding batch로 처리한다.
- inventory: 총 245; ACTIVE 9 / READY 12 / GAP 20 / WATCH 43 / EXCLUDE 0 / UNREVIEWED 161. 경기도 하위 UNREVIEWED는 0이며 다음 deterministic survey queue는 **`busan-gangseo`**부터다.
- 이번 작업은 source research + inventory/docs만 변경했다. Registry·collector·production·D1·Cron/manual ingestion은 변경하지 않았다. C **2026-09-24 10:00 KST** 기존 ACTIVE 9 read-only Cron 검증 → D **2026-09-24 11:00 KST** TourAPI watchdog read-only 검증 순서를 유지한다.
## 2026-09-23 운영 위임 — 전국 municipal survey 무중단 진행

- 사용자가 전국 municipal/source coverage 조사에 대해 **지자체별·batch별 확인을 받지 말고 deterministic queue 순서대로 끝까지 진행**하도록 위임했다.
- routine 조사 → inventory/docs 갱신 → validation → commit/push는 각 bounded task 안에서 자동 진행하고, 다음 batch 승인 요청은 하지 않는다.
- 현재 queue는 부산 하위 16개부터 시작하며 이후 대구 → 전남광주통합특별시 하위 → 대전 → 울산 → 강원 → 충북 → 충남 → 전북 → 경북 → 경남 → 제주 순으로 계속한다.
- C 2026-09-24 10:00 KST / D 11:00 KST 운영 checkpoint는 우선순위를 유지하며, 그 전 production/Registry onboarding은 하지 않는다.
- destructive D1, secret/resource/비용/아웃리지 위험 작업만 사용자 확인 대상으로 남긴다.

## 2026-09-23 Phase 6B — 부산 하위 16개 source 조사 완료

- 부산 하위 16개 구·군을 current official municipality/official affiliated culture·tourism source 기준으로 live read-only 조사해 모두 UNREVIEWED에서 제거했다.
- **ONBOARDING_READY 2**: `busan-동`(동구 문화관광 공연·전시 목록: 기간·장소 self-contained, bounded list), `busan-해운대`(해운대문화회관 공연 프로그램: 50건·5페이지, date+venue self-contained).
- **COLLECTOR_GAP 3**: `busan-부산진`, `busan-동래`, `busan-남`. 모두 source는 current/durable하지만 목록에서 venue가 완전하지 않아 기존 `list_detail_core_followup_needed` 공통 GAP으로 분류했다.
- **WATCH 11**: `busan-jung`, `busan-서`, `busan-영도`, `busan-북`, `busan-사하`, `busan-금정`, `busan-gangseo`, `busan-연제`, `busan-수영`, `busan-사상`, `busan-기장`. 이유는 month-only/recurring date 혼재, source-wide canonical listing 미확인, current candidate payload/freshness 미검증, 개별 festival/detail만 존재하는 경우 등이며 불명확한 사실을 결합하지 않고 fail-closed했다.
- 부산 광역 root의 기존 `COLLECTOR_GAP(list_detail_core_followup_needed)` 판정은 변경하지 않았다. 하위 source와 광역 source overlap은 이후 onboarding duplicate gate에서 다룬다.
- 이번 batch 변화: READY +2 / GAP +3 / WATCH +11 / EXCLUDE +0. inventory는 총 245; **ACTIVE 9 / READY 14 / GAP 23 / WATCH 54 / EXCLUDE 0 / UNREVIEWED 145**.
- 부산 하위 UNREVIEWED는 0. 다음 deterministic survey queue는 **`daegu-군위`**부터다.
- Registry·collector·production·D1·Cron/manual ingestion은 변경하지 않았다. C 2026-09-24 10:00 KST → D 11:00 KST checkpoint 전 production onboarding 금지 원칙을 유지한다.

## 2026-09-23 Phase 6B — 대구 하위 9개 source 조사 완료

- 대구 하위 9개 구·군을 current official source 기준으로 조사해 모두 UNREVIEWED에서 제거했다.
- **ONBOARDING_READY 1**: `daegu-서` — 서구청 비원뮤직홀 2026 월별 공연일정에서 title·full-year date·place·time이 self-contained로 제공된다.
- **WATCH 8**: `daegu-jung`, `daegu-동`, `daegu-남`, `daegu-북`, `daegu-수성`, `daegu-달서`, `daegu-달성`, `daegu-군위`. 개별 축제/공연·월별 공지는 확인되지만 source-wide canonical bounded listing 또는 일관된 event core를 확정하지 못해 fail-closed했다.
- 이번 변화: READY +1 / GAP +0 / WATCH +8 / EXCLUDE +0. inventory 총 245: **ACTIVE 9 / READY 15 / GAP 23 / WATCH 62 / EXCLUDE 0 / UNREVIEWED 136**.
- 다음 deterministic queue는 **`jeonnam-gwangju-강진`**부터다. Registry·collector·production·D1·Cron/manual ingestion은 변경하지 않았다.

## 2026-09-23 Phase 6B — 전남광주통합특별시 하위 batch 1/3

- deterministic queue의 첫 10개(`강진`, `고흥`, `곡성`, `광산`, `광양`, `구례`, `나주`, `남구`, `담양`, `동구`)를 current official source 기준으로 live read-only 조사했다.
- **ONBOARDING_READY 1**: `jeonnam-gwangju-곡성` — 공식 공연/체험행사 목록에 title·explicit full-year 기간·venue와 6페이지 pagination이 self-contained.
- **COLLECTOR_GAP 1**: `jeonnam-gwangju-광양` — 공식 관광 공지 목록은 title/게시일 중심이고 detail에 full-year 기간·venue가 있어 기존 `list_detail_core_followup_needed`로 해결 가능.
- **WATCH 8**: `강진`, `고흥`, `광산`, `구례`, `나주`, `남구`, `담양`, `동구`. 대표 사유는 canonical source-wide listing 미확인, current freshness 미검증, month-only 반복시기, 행정/시설 일정 혼합, 단일 venue scope 등이다.
- 이번 batch 변화: READY +1 / GAP +1 / WATCH +8 / EXCLUDE +0. inventory 총 245: **ACTIVE 9 / READY 16 / GAP 24 / WATCH 70 / EXCLUDE 0 / UNREVIEWED 126**.
- 다음 queue는 **`jeonnam-gwangju-목포`**부터다. Registry·collector·production·D1·Cron/manual ingestion은 변경하지 않았다. C 2026-09-24 10:00 KST → D 11:00 KST checkpoint 전 production onboarding 금지 원칙 유지.

## 2026-09-23 Phase 6B — 전남광주통합특별시 하위 batch 2/3

- 다음 10개(`목포`, `무안`, `보성`, `북구`, `서구`, `순천`, `신안`, `여수`, `영광`, `영암`)를 current official source 기준으로 live read-only 조사했다.
- **ONBOARDING_READY 1**: `jeonnam-gwangju-목포` — 목포시 문예시설 공연·행사일정에서 title·explicit full-year 기간·venue·detail이 self-contained.
- **COLLECTOR_GAP 1**: `jeonnam-gwangju-여수` — 월별 문화행사 calendar는 current/durable하지만 multi-day full-year 기간은 detail 보완이 필요해 기존 `list_detail_core_followup_needed`.
- **WATCH 8**: `무안`, `보성`, `북구`, `서구`, `순천`, `신안`, `영광`, `영암`. source-wide canonical listing 미확인, 행정/문화 혼합 일정, static/PDF 안내, 대표축제 단일 detail 등의 사유로 fail-closed했다.
- 이번 변화: READY +1 / GAP +1 / WATCH +8 / EXCLUDE +0. inventory 총 245: **ACTIVE 9 / READY 17 / GAP 25 / WATCH 78 / EXCLUDE 0 / UNREVIEWED 116**.
- 다음 queue는 **`jeonnam-gwangju-완도`**부터다. Registry·collector·production·D1·Cron/manual ingestion은 변경하지 않았다.

## 2026-09-23 Phase 6B — 전남광주통합특별시 하위 batch 3/3 완료

- 마지막 7개(`완도`, `장성`, `장흥`, `진도`, `함평`, `해남`, `화순`)를 current official source 기준으로 live read-only 조사해 통합특별시 하위 27개 survey를 모두 완료했다.
- **COLLECTOR_GAP 3**: `jeonnam-gwangju-장성`, `jeonnam-gwangju-진도`, `jeonnam-gwangju-함평`. current/durable official listing은 있으나 venue/core가 list에 일관되게 self-contained하지 않아 기존 `list_detail_core_followup_needed`로 묶었다.
- **WATCH 4**: `완도`, `장흥`, `해남`, `화순`. calendar payload 미검증, source-wide canonical listing 미확인, 또는 특정 음악분수 공지처럼 scope가 좁아 fail-closed했다.
- 이번 변화: READY +0 / GAP +3 / WATCH +4 / EXCLUDE +0. inventory 총 245: **ACTIVE 9 / READY 17 / GAP 28 / WATCH 82 / EXCLUDE 0 / UNREVIEWED 109**.
- 전남광주통합특별시 하위 UNREVIEWED는 0. 다음 deterministic survey queue는 **`daejeon-대덕`**부터다.
- Registry·collector·production·D1·Cron/manual ingestion은 변경하지 않았다. C 2026-09-24 10:00 KST → D 11:00 KST checkpoint 전 production onboarding 금지 원칙을 유지한다.

## 2026-09-23 Phase 6B — 대전 하위 5개 source 조사 완료

- 대전 하위 5개 구를 current official source 기준으로 live read-only 조사해 모두 UNREVIEWED에서 제거했다.
- **COLLECTOR_GAP 1**: `daejeon-동` — 공식 통합예약 ‘축제/행사’는 title·explicit 기간·durable detail을 제공하고 detail에서 venue가 확인되므로 기존 `list_detail_core_followup_needed` + event signal 적용 후보.
- **WATCH 4**: `daejeon-대덕`, `daejeon-서`, `daejeon-유성`, `daejeon-jung`. 대덕/서는 canonical event-only listing 미확인, 유성은 self-contained 문화공연 목록이 현재 종료된 1건뿐이라 freshness 미확정, 중구는 대표축제 detail과 일부 불완전 마을축제 표 중심이라 source-wide exact listing이 부족하다.
- 이번 변화: READY +0 / GAP +1 / WATCH +4 / EXCLUDE +0. inventory 총 245: **ACTIVE 9 / READY 17 / GAP 29 / WATCH 86 / EXCLUDE 0 / UNREVIEWED 104**.
- 다음 deterministic queue는 **`ulsan-남`**부터다. Registry·collector·production·D1·Cron/manual ingestion은 변경하지 않았다.

## 2026-09-23 Phase 6B — 울산 하위 5개 source 조사 완료

- 울산 하위 5개 구·군을 current official source 기준으로 live read-only 조사해 모두 UNREVIEWED에서 제거했다.
- **ONBOARDING_READY 2**: `ulsan-북` — 북구문화예술회관 공연 목록이 current/future title·full-year 기간·venue·detail을 self-contained로 제공. `ulsan-jung` — 중구 문화관광 월별 문화예술 행사일정이 행사명·일시·venue·주최를 표 단위로 제공.
- **WATCH 3**: `ulsan-남`은 calendar shell은 current지만 candidate payload 미검증, `ulsan-동`은 공식 축제 list 최신 항목이 2025라 2026 freshness 미확정, `ulsan-울주`는 source-wide canonical 행사 listing을 확인하지 못했다.
- 이번 변화: READY +2 / GAP +0 / WATCH +3 / EXCLUDE +0. inventory 총 245: **ACTIVE 9 / READY 19 / GAP 29 / WATCH 89 / EXCLUDE 0 / UNREVIEWED 99**.
- 다음 deterministic queue는 **`gangwon-강릉`**부터다. Registry·collector·production·D1·Cron/manual ingestion은 변경하지 않았다.

## 2026-09-23 Phase 6B — 강원 하위 source 조사 완료

- 태백은 기존 ACTIVE이므로 제외하고 나머지 강원 17개 시·군을 current official source 기준으로 조사해 하위 UNREVIEWED를 0으로 만들었다.
- **ONBOARDING_READY 1**: `gangwon-원주` — 원주시 ‘주요 문화행사’ 2026-09 current calendar가 행사명·explicit 기간·시간·venue·주최/주관을 self-contained로 제공.
- **WATCH 16**: 강릉·고성·동해·삼척·속초·양구·양양·영월·인제·정선·철원·춘천·평창·홍천·화천·횡성. 주요 이유는 source-wide canonical listing 미확인, 행정/문화 혼합 주간일정, 개별 대표축제 detail, 연간 편집형 공지, 또는 개최 후 photo archive 등이다.
- 이번 변화: READY +1 / GAP +0 / WATCH +16 / EXCLUDE +0. inventory 총 245: **ACTIVE 9 / READY 20 / GAP 29 / WATCH 105 / EXCLUDE 0 / UNREVIEWED 82**.
- 다음 deterministic queue는 **`chungbuk-괴산`**부터다. Registry·collector·production·D1·Cron/manual ingestion은 변경하지 않았다.

## 2026-09-23 Phase 6B — 충북 하위 11개 source 조사 완료

- 충북 하위 11개 시·군을 current official source 기준으로 조사해 UNREVIEWED에서 제거했다.
- **ONBOARDING_READY 1**: `chungbuk-옥천` — 공식 문화관광 축제/체험 12건·2페이지 목록이 2026 항목의 title·기간·venue를 self-contained로 제공.
- **COLLECTOR_GAP 1**: `chungbuk-영동` — 영동군 문화관광재단 2026 축제 일정표는 title·기간을 current 제공하지만 venue가 list에 없어 `list_detail_core_followup_needed`.
- **WATCH 9**: 괴산·단양·보은·음성·제천·증평·진천·청주·충주. 보도/주간행사 혼합, 편집형 단일 공지, 월별 문서 일정표, canonical listing 미검증 등의 사유다.
- inventory 총 245: **ACTIVE 9 / READY 21 / GAP 30 / WATCH 114 / EXCLUDE 0 / UNREVIEWED 71**. 다음 queue는 **`chungnam-계룡`**부터다.
- Registry·collector·production·D1·Cron/manual ingestion은 변경하지 않았다.

## 2026-09-23 Phase 6B — 충남 하위 15개 source 조사 완료

- 충남 하위 15개 시·군을 current official source 기준으로 조사해 모두 UNREVIEWED에서 제거했다.
- **COLLECTOR_GAP 2**: `chungnam-논산`, `chungnam-당진` — current/durable 공식 문화·축제 목록은 title·기간·detail을 제공하지만 venue가 list에 일관되게 self-contained하지 않아 기존 `list_detail_core_followup_needed`.
- **WATCH 13**: 계룡·공주·금산·보령·부여·서산·서천·아산·예산·천안·청양·태안·홍성. 대표 사유는 개별 공지/대표축제 detail, 행정 일정 혼합, current payload/freshness 미검증, 문서/보도자료 중심이다.
- inventory 총 245: **ACTIVE 9 / READY 21 / GAP 32 / WATCH 127 / EXCLUDE 0 / UNREVIEWED 56**. 다음 queue는 **`jeonbuk-고창`**부터다.
- Registry·collector·production·D1·Cron/manual ingestion은 변경하지 않았다.

## 2026-09-24 Phase 6B — 전북 하위 14개 source 조사 완료

- 전북특별자치도 하위 14개 시·군을 current official source 기준으로 live read-only 조사해 모두 UNREVIEWED에서 제거했다.
- **COLLECTOR_GAP 3**: `jeonbuk-완주`(공식 축제 목록 title/date는 충분하지만 venue detail 필요), `jeonbuk-익산`(익산예술의전당 공연·전시 일정 detail에서 venue/core 보완), `jeonbuk-전주`(공식 공연/행사 calendar의 venue/multi-day detail 보완). 모두 기존 `list_detail_core_followup_needed` 계열이다.
- **WATCH 11**: 고창·군산·김제·남원·무주·부안·순창·임실·장수·정읍·진안. 대표 사유는 flagship 축제/개별 공지 중심, source-wide canonical bounded listing 미확인, 또는 행정/홍보 feed 혼합이다. 명시되지 않은 연도·장소를 다른 페이지에서 임의 결합하지 않았다.
- 이번 변화: READY +0 / GAP +3 / WATCH +11 / EXCLUDE +0. inventory 총 245: **ACTIVE 9 / READY 21 / GAP 35 / WATCH 138 / EXCLUDE 0 / UNREVIEWED 42**.
- 전북 하위 UNREVIEWED는 0. 다음 deterministic queue는 **`gyeongbuk-경산`**부터다.
- Registry·collector·production·D1·Cron/manual ingestion은 변경하지 않았다. C 2026-09-24 10:00 KST → D 11:00 KST checkpoint 전 production onboarding 금지 원칙 유지.

## 2026-09-24 Phase 6B — 경북 하위 22개 source 조사 완료

- 경북 하위 22개 시·군을 current official source 기준으로 조사해 모두 UNREVIEWED에서 제거했다.
- **ONBOARDING_READY 6**: `gyeongbuk-경산`, `gyeongbuk-경주`, `gyeongbuk-상주`, `gyeongbuk-안동`, `gyeongbuk-영주`, `gyeongbuk-포항`. current/future 2026 일정에서 title·explicit full-year date/period·venue가 self-contained인 official 또는 official-affiliated 지속 listing을 확인했다.
- **COLLECTOR_GAP 1**: `gyeongbuk-구미` — official 문화예술행사/통합일정은 durable하지만 일부 candidate의 venue/full-year core가 detail follow-up이 필요해 기존 `list_detail_core_followup_needed`로 분류했다.
- **WATCH 15**: 고령·김천·문경·봉화·성주·영덕·영양·영천·예천·울릉·울진·의성·청도·청송·칠곡. 대표 사유는 flagship/개별 공지 중심, source-wide canonical listing 미확인, current payload/freshness 미검증, 편집형 일정표 또는 calendar payload 오류다.
- 이번 변화: READY +6 / GAP +1 / WATCH +15 / EXCLUDE +0. inventory 총 245: **ACTIVE 9 / READY 27 / GAP 36 / WATCH 153 / EXCLUDE 0 / UNREVIEWED 20**.
- 경북 하위 UNREVIEWED는 0. 다음 deterministic queue는 **`gyeongnam-거제`**부터다.
- Registry·collector·production·D1·Cron/manual ingestion은 변경하지 않았다. C 2026-09-24 10:00 KST → D 11:00 KST checkpoint 전 production onboarding 금지 원칙 유지.

## 2026-09-24 Phase 6B — 경남 하위 18개 source 조사 완료

- 경남 하위 18개 시·군을 current official source 기준으로 조사해 모두 UNREVIEWED에서 제거했다.
- **ONBOARDING_READY 2**: `gyeongnam-거제`, `gyeongnam-산청` — official 월별 행사 listing에서 title·explicit full-year 기간·venue·detail이 self-contained.
- **COLLECTOR_GAP 3**: `gyeongnam-밀양`, `gyeongnam-양산`, `gyeongnam-의령` — current/durable official calendar/list는 충분하지만 venue 또는 multi-day core가 detail follow-up이 필요해 기존 `list_detail_core_followup_needed`.
- **WATCH 13**: 거창·고성·김해·남해·사천·창녕·창원·통영·하동·함안·함양·합천·진주. 대표 사유는 flagship/개별 공지 중심, source-wide canonical listing 미검증, 시설별/행정 콘텐츠 혼합, freshness 부족이다.
- inventory 총 245: **ACTIVE 9 / READY 29 / GAP 39 / WATCH 166 / EXCLUDE 0 / UNREVIEWED 2**. 다음 queue는 **`jeju-서귀포`**부터다.
- Registry·collector·production·D1·Cron/manual ingestion은 변경하지 않았다.

## 2026-09-24 Phase 6B — 전국 municipal/source survey 분류 완료

- 제주 마지막 2개 research unit을 조사했다. `jeju-제주`, `jeju-서귀포` 모두 **WATCH**: 개별 2026 행사/예약 정보는 공식 source에서 확인되지만 시 전체 문화행사를 지속 공급하는 canonical event-only bounded listing과 source-wide core를 검증하지 못했다.
- 이로써 전국 **245 research units 전부 분류 완료**, deterministic survey queue는 비었다. **UNREVIEWED 0**.
- 최종 inventory: **ACTIVE 9 / ONBOARDING_READY 29 / COLLECTOR_GAP 39 / WATCH 168 / EXCLUDE 0 / UNREVIEWED 0**.
- survey 중 발견된 공통 collector gap은 기존 `list_detail_core_followup_needed`, `generic_html_card_structure_gap`, JS/API/access-protection 계열에 유지했고, 애매한 source는 READY로 과대판정하지 않고 WATCH로 fail-closed했다.
- 이번 전국 survey는 Registry·collector·production·D1·Cron/manual ingestion을 변경하지 않았다. 2026-09-24 **10:00 KST C 정규 Cron read-only 검증 → 11:00 KST D TourAPI watchdog read-only 검증** 이후 Phase 6E에서 READY source를 3~5개 단위로 onboarding한다.
- 조사 단계 종료 후 운영 우선순위: C → D → Phase 6E READY onboarding → 공통 GAP 해소 순이다.

## 2026-09-24 00:12 KST — 새 채팅 전환용 최종 스냅샷

- 현재 `origin/main`: **`8914f9901dd4b2329985449c503b3ceb5e952915`** — `docs: complete nationwide municipal source survey`.
- 해당 commit의 GitHub **Project checks는 success**. CI에는 `npm run check` + `npm run municipal:inventory:check`가 포함되어 inventory/generator 불일치를 자동 차단한다.
- 전국 municipal/source survey는 **이미 완료**됐다. 새 채팅에서 부산/대구/경기 등 survey를 다시 시작하지 않는다.
- 최종 inventory: **총 245 / ACTIVE 9 / ONBOARDING_READY 29 / COLLECTOR_GAP 39 / WATCH 168 / EXCLUDE 0 / UNREVIEWED 0**. deterministic survey queue length **0**.
- survey 작업은 Registry·collector·production·D1·Cron/manual ingestion을 변경하지 않았다. 따라서 2026-09-24 10:00 KST 정규 수집과 직접 충돌하지 않는다.
- 사용자는 routine municipal 작업에 대해 중간 승인 없이 진행하도록 위임했다. 단, destructive D1, secret/resource 변경, 신규 비용, outage-risk 등 고위험 작업만 확인을 받는다.
- **다음 실제 작업 순서**:
  1. 2026-09-24 **10:00 KST C checkpoint** — 기존 production ACTIVE 9 정규 Cron 결과를 read-only 검증. manual ingestion/수정 금지.
  2. 2026-09-24 **11:00 KST D checkpoint** — TourAPI watchdog 결과를 read-only 검증. 기존 snapshot(219 / success 123 / failed 18 / never_processed 78) 대비 recovery 확인.
  3. C/D 이상 없으면 **Phase 6E READY onboarding**. READY 29개를 한꺼번에 넣지 말고 **3~5개 bounded batch**로 Registry opt-in → targeted test/probe → deploy → production verify 순으로 진행.
  4. 그 다음 공통 COLLECTOR_GAP 해소를 반복 빈도/해결 효율 기준으로 묶어 처리.
- 새 채팅 시작 시 규칙대로 `AGENTS.md → PROJECT_CONTEXT.md → NEXT_CHAT_HANDOFF.md → docs/WORKING_RULES.md`를 읽고, 최신 `origin/main`/working tree를 확인한 뒤 **C/D 또는 그 시각 이후 남은 다음 단계부터** 이어간다.

## 2026-09-24 16:20 KST — municipal onboarding production 배포 완료

- 기준 commit `c223028fde02ed6bbff2badf39e80b14c4c6100e`를 기존 Worker `weekend-mwohae`에 배포했다. Cloudflare latest deployment 확인: version `d9118a65-9d67-490b-b51d-016c3bbbc437`.
- 배포된 Registry에는 과천·하남·상주 설정이 포함됐다. generic HTML 카드/목록형 extractor 보강 및 venue 오탐 방지도 포함됐다.
- 배포된 Cron: `0 1 * * *`, `0 2 * * *`, `45 2 * * *`, `50 4 * * *`, `55 8 * * *` UTC (10:00 base, 11:00 watchdog, 11:45/13:50/17:55 retry recovery KST).
- `https://galteum.com/api/health`와 `/api/events?limit=1&period=today` HTTP 200. manual base/municipal/detail, D1 write는 실행하지 않았다.
- 다음: 2026-09-25 10:00 KST 자연 Cron 결과를 read-only 확인하고 과천·하남·상주 ingestion/state 및 후보 품질을 검증한다. 수동 수집은 하지 않는다.


## 2026-09-24 — HOLD / 재개 조건 추적

- HOLD는 폐기가 아니라 **재개 조건이 붙은 추적 상태**다. 새 채팅/후속 작업에서 아래 항목을 임의로 READY로 되돌리거나 처음부터 재조사하지 않는다.
- **달력형 municipal 5곳 HOLD**: 목포, 울산 중구, 원주, 경주, 안동.
  - 목포: calendarContext로 날짜 partial 5건까지 확인했지만 상세에서 장소/제목 검증 실패.
  - 원주: 날짜 partial 1건까지 확인했지만 상세 장소 확인 실패.
  - 울산 중구 / 경주 / 안동: 현재 HTML 날짜 그룹 계약과 calendarContext 규칙이 불일치.
  - 재개 조건: 공식 근거로 날짜+장소까지 bounded하게 확정 가능한 공통 구조 또는 compatible source 사례가 확보될 때.
- **calendarContext 코드 상태**:
  - `5320599346e52a5e8e21e6b4595a184b1fe4eea7` 구현은 HOLD 판정에 따라 revert됐으며, 재개 조건이 충족될 때까지 main에 포함하지 않는다.
  - 판정은 **DO_NOT_MERGE_YET 의미로 운영 보류**: Registry opt-in/production deploy는 compatible source가 실제로 생기기 전까지 금지.
  - 이유: live 5곳 compatible 전환 0개이며, extractor 약 97줄 + detail follow-up 의미 변경 약 37줄로 calendar 전용 범위를 넘어서는 영향이 있음.
  - 현재 production은 이전 배포 기준 `c223028fde02ed6bbff2badf39e80b14c4c6100e`이며 calendarContext 변경은 production에 반영하지 않는다.
- **접근 미확인 7곳 HOLD**: 영등포, 부산 동구, 해운대, 의정부, 영주, 거제, 산청.
  - 사유: 404 / timeout / 보안 차단 등으로 collector 판정 자체가 불가능.
  - 재개 조건: 접근 경로 변경, 공식 대체 source 확인, 또는 기존 차단 해소.
- **UI v2.1 HOLD**: 행사소개 길이, 상세 정보 hierarchy, 정보 적은 상세 화면 밀도.
  - 재개 조건: 데이터/collector 확대가 안정된 뒤 한 번에 일괄 수정.
- **WATCH 168 후순위 유지**: 공식 source 구조/채널이 바뀌거나 새 지속 source가 확인될 때만 재평가. 일상 재조사 금지.
- **TourAPI retry telemetry 의미 불일치 HOLD**: `retry_attempted/recovered/exhausted`와 `retry_rounds` 집계 의미가 어긋나는 observability 이슈. 실제 recovery 동작은 정상 확인됐으므로 즉시 운영 장애로 취급하지 않고 후순위 정리.
- 다음 즉시 작업은 HOLD 항목을 더 파는 것이 아니라, 남은 non-calendar municipal GAP 중 공통 개선 효율이 높은 그룹을 계속 bounded하게 처리한다.


## 2026-09-24 — 사용자 부재 중 autonomous queue / PAUSED_USER_ACTION

- 사용자 위임: routine municipal 작업은 중간 승인 없이 계속 진행한다. Codespaces/Cloudflare/D1가 필요한 지점은 `PAUSED_USER_ACTION`으로 남기고 다음 독립 작업을 진행한다. HOLD 항목은 기존 재개 조건 전까지 다시 열지 않는다.
- **main 코드 준비 완료**:
  - `8fbc284f29085e79fb9530333d6b4c69c60048fc` — 명시적 시작 연도가 있는 동일 범위 안에서 끝 날짜의 연도 생략형(`2026.10.17~10.18`, `2026.10.17~18`)을 보수적으로 파싱.
  - `19b1552dbcabbe548d94bc8e8a4810ab64088330` — 시간 범위(`19:00~21:00`)를 날짜 범위로 오인하지 않도록 경계를 강화하고 회귀 테스트 추가.
  - production deploy는 하지 않는다.
- **PAUSED_USER_ACTION — 카드/목록형 live 검증**:
  1. 서울 강남: 위 compact date-range 보강 후 실제 official HTML을 municipal live dry-run에 넣어 candidate/날짜/venue/gate를 확인해야 함. public page에서는 2026-10-17~10-18 및 일원에코파크/에코센터를 확인했으나 parser 실동작 검증은 Codespaces 필요.
  2. 울산 북구: 현재 외부 public fetch가 timeout이라 raw/live HTML 구조를 Codespaces에서 확인해야 함.
  3. 경기 용인: public official page에는 현재/미래 self-contained date+venue 항목이 보이지만 기존 generic probe는 0이었으므로 raw container/class 구조 probe가 필요.
  4. 경기 포천: list의 venue가 반복적으로 `기타`이며 validator가 의도대로 거부함. 실제 venue를 얻으려면 JS detail 연결 및 first-party detail core를 live probe해야 함.
- **PAUSED_USER_ACTION — production checkpoint**:
  - 2026-09-25 10:00 KST 자연 Cron 후 과천·하남·상주 ingestion/state/candidate 품질과 TourAPI base/detail 상태를 production D1에서 read-only 확인. manual ingestion 금지.
- **autonomous 조사 결과 / 다음 후보**:
  - 대구 서구 비원뮤직홀 official page는 HTML 안에 `listMonthly[].playList[]` JSON을 직접 노출하며 각 record에 title/startDate/endDate/place가 있다. generic JSON-LD와 별개인 **embedded official JSON** 패턴 후보로 기록한다. 아직 source opt-in/collector code는 만들지 않는다.
  - 포항문화재단 main listing은 public HTML에서 filter shell만 보이고 event records는 동적으로 로드된다. search index에서 first-party `performance_detail/view.do?eventId=...` detail 형태는 확인됐지만 canonical listing endpoint는 아직 미확정.
  - 이천 시정달력은 public fetch에서 현재 bad request가 발생해 raw/live 확인은 Codespaces 체크포인트로 넘긴다.
- 다음 autonomous 우선순위: latest GitHub Actions가 정상인지 확인한 뒤, production 변경 없이 embedded JSON / 남은 non-calendar GAP 중 **공통 패턴으로 2개 이상 해결 가능한 후보**를 계속 조사한다.


## 2026-09-24 — 4-source live parser probe 미실행 / 환경 DNS

- Codespaces read-only probe 시도 결과, `git fetch origin`은 성공했지만 local HEAD가 `48e8674`로 `origin/main 756d689`보다 3 commits 뒤였고 working tree는 clean이었다. checkout/pull은 수행하지 않았다.
- 강남·울산 북구·용인·포천 4 source의 raw HTML fetch는 모두 `EAI_AGAIN`으로 실패해 **parser 자체는 실행되지 않았다**. 화면/웹 검색으로 보이는 사실은 raw parser 결과로 간주하지 않는다.
- 따라서 Complete/Partial/current/gate/COMPATIBLE 판정은 전부 **미검증**이며 기존 inventory 상태를 이 결과만으로 변경하지 않는다.
- 특히 울산 북구는 기존 canonical source `https://www.bukgu.ulsan.kr/art/BBS_014List.mo`가 inventory에 남아 있으므로, 축제 안내 페이지를 본 결과만으로 HOLD로 강등하지 않는다. 현재 상태는 `PAUSED_USER_ACTION / ENV_DNS_BLOCKED`.
- 다음 사용자 환경 작업:
  1. clean working tree에서 `git pull --ff-only origin main`으로 local HEAD를 latest main에 맞춤.
  2. canonical 4 source를 **한 번만** raw fetch + parser probe 재시도.
  3. 전부 `EAI_AGAIN`이면 반복 재시도하지 말고 DNS/environment issue로 종료하고 다음 독립 작업으로 이동.
- production D1, Registry, manual ingestion, deploy는 이 검증과 무관하며 계속 금지.


## 2026-09-24 — ENV_DNS_BLOCKED 재확인

- Codespaces를 latest main `f53d826836947472a4c29faacd7ef97d8af889f0`까지 `git pull --ff-only origin main`으로 fast-forward했고 working tree clean을 확인했다.
- canonical 4 source(서울 강남, 울산 북구, 경기 용인, 경기 포천)를 source당 1회만 raw fetch 재시도했으나 **4/4 모두 `EAI_AGAIN`**으로 실패했다.
- 따라서 이번 환경에서는 parser probe를 더 반복하지 않는다. 상태는 `PAUSED_USER_ACTION / ENV_DNS_BLOCKED` 유지.
- Complete/Partial/current/gate/COMPATIBLE 결과는 전부 미실행/미검증이며 inventory 분류나 Registry를 이 결과로 변경하지 않는다.
- 다음 재개 조건: Codespaces/network DNS가 정상화되었거나 다른 실행 환경에서 raw official HTML fetch가 성공할 때, 같은 4 canonical source에 대해 parser probe를 단 1회 재실행.
- 그 전에는 해당 4 source를 이유 없이 HOLD/READY로 재분류하거나 production onboarding하지 않는다.
- 사용자 개입이 필요 없는 다음 작업은 다른 non-calendar GAP 그룹의 공통 패턴 조사/설계로 계속 진행한다.


## 2026-09-24 — ACTIVE 증가 우선 Batch A staging

- 조사/보류 루프보다 production coverage 증가를 우선하는 운영으로 전환했다.
- Batch A 후보는 `gyeonggi-평택`, `gyeonggi-여주`, `gyeongbuk-경산`.
- 평택·경산은 이전 live dry-run에서 현재 generic extractor로 실제 candidate 추출이 확인됐고 retained live-shape fixture도 있다. 여주는 이전 compatibility 분류상 후보지만 raw/live 재검증이 필요하다.
- **10:00 KST 자연 수집 안전성을 위해 Batch A Registry opt-in은 main에서 제거하고 별도 branch `staging/municipal-batch-a`에 보존했다.**
- main은 내일 10:00 전에 production deploy해도 신규 Batch A source가 들어오지 않는 상태로 유지한다. production 자체는 계속 기존 Worker `d9118a65-9d67-490b-b51d-016c3bbbc437` / code basis `c223028...`를 유지하며 오늘 밤에는 deploy하지 않는다.
- 10:00 자연수집 read-only 검증이 정상이고 DNS/raw probe가 성공할 때만 staging branch 내용을 재검토해 main으로 가져온다.


## 2026-09-24 — 10:00 KST production freeze / morning verifier

- 2026-09-25 10:00 KST 자연 base collection을 가장 우선한다. **그 전까지 production Worker deploy, manual ingestion, remote D1 write, Cron 변경을 금지**한다.
- production은 현재 검증된 `c223028fde02ed6bbff2badf39e80b14c4c6100e` / Worker version `d9118a65-9d67-490b-b51d-016c3bbbc437` 상태로 유지한다. latest main의 Batch A(평택·여주·경산)는 staged only이며 10:00 전 배포하지 않는다.
- 현재 production Cron contract는 `0 1 * * *` base, `0 2 * * *` watchdog, `45 2 * * *` / `50 4 * * *` / `55 8 * * *` retry recovery이고 main config와 동일하다.
- GitHub에는 10시 이후 production 상태를 한 번에 보는 **read-only verifier**를 추가했다.
  - 실행: `npm run verify:morning:prod -- --remote`
  - 조회만 수행하며 SQL은 SELECT/WITH만 허용한다.
  - latest base sync, 과천·하남·상주 candidate state/재검증, base 이후 detail runs, TourAPI detail backlog를 출력한다.
- 권장 실행 시점: 10:05~10:10 KST 이후. base가 아직 running이면 기다리며 polling하지 말고 나중에 1회 다시 확인한다.
- morning 결과가 정상일 때만 Batch A live probe/deploy를 다시 연다.


## 2026-09-26 — 2026-09-25 자연 Cron production checkpoint 결과

- 사용자가 2026-09-25 10:00 KST 자연 Cron 이후 `npm run verify:morning:prod -- --remote`를 실행했고, production D1에 **SELECT only** 검증을 완료했다.
- base sync: **success / stale 0**.
- TourAPI detail backlog: **target 213 / success 189 / never_processed 24 / failed 0 / retry_due 0 / retry_waiting 0**. 즉 detail recovery는 운영상 정상이며 남은 24건은 미처리 backlog이지 실패 backlog가 아니다.
- 과천·하남·상주: 이번 base 실행에서 `observed=0`. verifier 판정은 `BASE_OK_MUNICIPAL_SOURCE_NOT_OBSERVED`.
- 현재 공식 페이지 기준으로 하남은 2026-10-01 및 2026-10-07 future 항목을, 상주는 2026-10-24~25 future 축제를 실제 제공한다. 따라서 최소 하남·상주의 observed 0은 '행사 없음'으로 해석하지 않는다. source fetch / health marker / generic parser contract 중 어디에서 실패했는지 별도 진단 필요.
- 과천 공식 공연 목록은 현재 검색 가능한 9월 일정이 중심이며 대표 축제는 2026-09-20 종료. 과천 observed 0도 현재 pipeline이 candidate state를 만들지 못했다는 사실만 확정하며 원인은 아직 미분리.
- production에는 잘못된 municipal candidate가 publish되지 않았고, TourAPI/base는 정상. **안전성 문제는 없음. 다만 municipal +3 검증은 실패**.
- Batch A(평택·여주·경산)는 `staging/municipal-batch-a`에 계속 보존하고, 과천·하남·상주 원인 진단 전 production 확대 deploy는 보류.
- 다음 bounded task: source별로 raw fetch 성공 / health marker / extraction mode / candidate 수를 분리해 보는 **read-only municipal source diagnostic**. 원인 확인 후 해당 source만 수정하고, 나머지 onboarding batch를 막지 않는다.


## 2026-09-26 — municipal live diagnostic 성공 / transient fetch hardening

- 사용자가 latest main에서 `npm run diagnose:municipal:3`를 실행했고, 초기 sandbox fetch 실패 후 network 권한 재실행에서 **과천·하남·상주 모두 HTTP 200 / document healthy / generic_html extraction 성공**을 확인했다.
- 추출 complete candidate 수: **과천 6 / 하남 5 / 상주 12**. 일부 gate는 REVIEW지만 candidate 자체는 정상 추출된다.
- 따라서 2026-09-25 10:00 자연 Cron의 3 source `observed=0`은 parser가 구조적으로 0을 내는 상태가 아니라, 당시 production fetch/환경의 일시 실패 가능성이 가장 높다. gate가 REVIEW여도 state는 저장되므로 observed 0의 원인이 gate 자체일 수는 없다.
- production code basis c223028과 main의 municipal runtime 차이는 compact date-range parser 보강뿐이며 Registry/pagination/municipal worker는 동일했다.
- 다음 Cron에서 하루 전체를 놓치는 것을 줄이기 위해 municipal official fetch에 **network/timeout 한정 1회 inline retry**를 추가했다. HTTP 4xx/5xx는 retry하지 않는다.
- `runMunicipalAutonomous` 결과에 source별 `source_outcomes`(ok/error, candidate count, bounded reason)을 추가해 다음 `sync_runs.message.municipal`만으로 source failure 원인을 확인할 수 있게 했다.
- ingestion/gate/D1 publication 정책은 변경하지 않았다. 잘못된 데이터 허용 범위 확대 없음.


## 2026-09-26 — Batch A main opt-in 재개

- 과천·하남·상주는 OBSERVE 트랙으로 내리고 신규 municipal coverage 확대를 재개한다.
- staging branch에 보존하던 Batch A `gyeonggi-평택`, `gyeonggi-여주`, `gyeongbuk-경산` Registry opt-in 및 관련 tests를 current main에 재적용한다.
- 이 batch는 기존 generic extractor만 사용하고 새 parser/collector 범위 확대는 하지 않는다.
- production deploy 전 GitHub Project checks 성공이 필수다. Cloudflare 인증이 필요한 실제 deploy만 사용자 환경에서 1회 실행한다.
- source 하나가 실패해도 나머지 source 진행을 막지 않는다. 다음부터 coverage 성과는 ACTIVE 증가 수로 보고한다.


## 2026-09-26 — municipal Batch B +2 main 준비

- Codespaces를 쓰지 않고 GitHub/web read-only 조사만으로 다음 READY batch를 진행했다.
- Batch B main opt-in: `incheon-서해`, `jeonnam-gwangju-곡성`.
- 서해 공식 전체행사 목록은 현재 title/full-year period/venue를 반복 제공하고 page 2 URL에서 `pgno=2`를 확인했다. Registry는 `pgno`, max 3 pages로 bounded.
- 곡성 공식 공연/체험행사 목록은 현재 2026 월별 문화달력/행사를 title/full-year period/venue로 제공하고 pagination `page`를 사용한다. Registry는 max 3 pages로 bounded.
- 둘 다 기존 `generic_fallback`만 사용하며 새 parser/collector code는 추가하지 않았다.
- `gyeonggi-광주`는 current official page에 2026 future 행사 core가 확인되지만 pagination query contract를 GitHub/web만으로 확정하지 못해 이번 batch에서 억지로 넣지 않았다. 다음 독립 batch에서 bounded paging contract를 먼저 확정한다.
- production deploy는 아직 하지 않는다. 여러 batch를 모은 뒤 사용자 Codespaces는 최종 deploy 1회에만 사용한다.


## 2026-09-26 — municipal Batch C +1 경기 광주

- Batch C로 `gyeonggi-광주`를 main Registry에 opt-in했다.
- 공식 광주시 문화·행사 목록은 현재 31페이지이며 2026-10-15, 10-18, 10-31~11-01, 11-19 등 future 행사에서 title·explicit date·venue를 같은 목록 항목에 제공하는 것을 재확인했다.
- pagination query parameter는 GitHub/web read-only 환경에서 raw href까지 확정하지 못했으므로 추측하지 않았다. 이번 opt-in은 **현재 first page만** 읽는 `generic_fallback`으로 제한한다.
- first page 자체에 current/future candidate가 충분하며, pagination을 억지로 선언하지 않아 잘못된 repeated-page crawl 위험을 피한다.
- production deploy는 아직 하지 않는다. Batch A +3, Batch B +2, Batch C +1을 묶어 최종 deploy 1회로 가져간다.


## 2026-09-26 — 사용자 위임: 끝까지 자동 진행

- 사용자는 municipal coverage 확대를 **추가 시작/계속 명령 없이 가능한 데까지 끝까지 밀어붙이는 방식**으로 운영하길 명시했다.
- routine GitHub 조사·수정·테스트·commit/push·CI 확인은 중간 승인 없이 연속 진행한다.
- Codespaces는 여러 batch를 모은 뒤 final deploy 1회에만 요청하는 것을 기본으로 한다.
- 개별 source가 막히면 그 source만 분리하고 전체 queue는 계속 진행한다.


## 2026-09-26 — 새 채팅 `계속` 보고 규칙

- 사용자는 새 채팅에서 `계속`이라고 말하면 먼저 **현재까지 완료 / 지금 하는 중 / 앞으로 남은 작업 / 사용자 개입 필요 여부**를 한 번에 보고받고 싶어 한다.
- 보고 후에는 추가 승인 없이 안전한 다음 작업을 바로 이어간다.


## 2026-09-26 — municipal Batch D +2 강남·울산 북구

- Batch D로 `seoul-gangnam`, `ulsan-북`을 main Registry에 opt-in했다.
- 강남문화재단 공식 강남생활문화축제 목록은 2026-10-17~18 행사기간과 일원에코파크 및 에코센터 장소를 같은 목록 항목에서 제공하고 first-party detail URL도 유지한다.
- 울산 북구문화예술회관 공식 공연 목록은 2026-09~11 current/future 공연을 행사기간·장소·first-party detail과 함께 반복 제공한다.
- 두 source 모두 pagination parameter를 추측하지 않고 현재 first page만 `generic_fallback`으로 읽도록 제한했다.
- 이 batch는 새 parser나 publication policy를 추가하지 않는다. source가 runtime에서 generic candidate를 만들지 못하면 기존 fail-closed/source_outcomes 경로로 해당 source만 error 처리되고 다른 source를 막지 않는다.
- main 누적 신규 준비량은 Batch A +3 / B +2 / C +1 / D +2 = **총 +8**. production deploy는 아직 하지 않는다.


## 2026-09-26 — municipal GAP 해소: 대구 서구 parser

- 대구 서구 비원뮤직홀 공식 공연일정은 HTML 안에 `listMonthly[].playList[]` JSON payload를 직접 포함한다. 2026 schedule에서 `title/startDate/endDate/place/idx` core가 명시적으로 확인됐다.
- generic HTML DOM 추측 대신 source-specific registered parser `parseDaeguSeoMusicSchedule`를 추가해 embedded JSON만 읽도록 했다.
- parser는 balanced JSON object extraction → JSON.parse → explicit title/full-year dates/venue만 candidate로 만들고 idx로 dedupe한다. 누락 core는 fail-closed 제외한다.
- source `daegu-서`를 Registry에 registered_parser로 추가했고 retained fixture/test를 추가했다.
- main 누적 신규 준비량은 기존 +8에 대구 서구 +1을 더해 **총 +9**. production deploy는 아직 하지 않는다.


## 2026-09-26 — municipal Batch E +1 원주

- 원주시 공식 주요 문화행사 월간일정은 table header가 `행사명 / 기간 / 장소명`을 명시하고, 2026-09 실제 row에서 full-year date와 venue를 self-contained로 제공한다.
- `gangwon-원주`를 기존 generic table extractor로 Registry opt-in했다. pagination은 별도 추측하지 않고 현재 monthly source URL 한 페이지만 읽는다.
- retained live-shape fixture에서 완전한 row 1건은 candidate가 되고 venue 누락 row는 fail-closed 제외되는 테스트를 추가했다.
- main 누적 신규 준비량은 **총 +10**. production deploy는 아직 하지 않는다.


## 2026-09-26 — 대구 서구 parser CI fixture 회귀 수정

- 신규 registered parser `daegu-서` 추가 뒤 공통 parser-backed fixture test의 fixture map에 해당 key가 빠져 Project checks 1건이 실패한 원인을 확인했다.
- runtime/parser 동작은 변경하지 않고 `tests/municipal-generic-html.test.ts`의 기존 registered-parser fixture map에 대구 서구 retained fixture를 연결했다.
- 기능 변경이 아닌 test contract 누락 수정이며 production deploy 대상이 아니다.


## 2026-09-26 — municipal Batch F +2 용인·이천

- `gyeonggi-용인`: 용인문화재단 공식 전체일정은 2026 current/future 항목에서 title·full-year date range·venue를 같은 항목에 제공한다. 공식 pagination link가 실제로 `page=2`를 사용함을 확인해 max 3 pages로 bounded 등록했다.
- `gyeonggi-이천`: 이천시 공식 시정달력은 current 48-page listing에서 2026 이천아트홀 서커스 페스티벌 등 title·full-year period·venue를 self-contained로 제공한다. pagination query contract는 추측하지 않고 first page only로 등록했다.
- 둘 다 기존 `generic_fallback`만 사용하며 새 parser/publication policy는 추가하지 않았다. source parse failure는 기존 source_outcomes fail-closed 경로로 격리된다.
- main 누적 신규 준비량은 **총 +12**. production deploy는 아직 하지 않는다.


## 2026-09-26 — access HOLD 해제: 의정부 +1

- `gyeonggi-의정부` 공식 2026 연간 행사·축제 목록이 다시 정상 접근되고 현재 38페이지 table에서 제목·시작일·종료일·장소·담당부서를 명시적으로 제공함을 재확인했다.
- HOLD였던 접근 상태를 해제하고 first page only `generic_fallback` Registry opt-in으로 전환했다. pagination parameter는 추측하지 않았다.
- live-shape retained fixture로 split start/end columns와 venue가 candidate core로 추출되는 계약을 고정했다.
- main 누적 신규 준비량은 **총 +13**. production deploy는 아직 하지 않는다.


## 2026-09-26 — municipal parser Batch G +3 옥천·안동·부산 동구

- GitHub Actions read-only live diagnostic으로 남은 source를 실제 HTTP fetch했다. 목포·울산중구·포천·포항·경주·안동은 기존 generic extractor가 0 candidate였고, 옥천은 8 candidate를 만들었지만 venue를 title로 잘못 읽는 구조 문제를 확인했다.
- `chungbuk-옥천`: official `photo_item` card의 `info_title / info_item type1 / type3`를 명시적으로 읽는 registered parser를 추가해 실제 venue를 보존한다.
- `gyeongbuk-안동`: official `ct_list_li` card의 subject/date/venue/detail id를 직접 읽는 registered parser를 추가했다.
- `busan-동`: 기존 access HOLD였지만 live HTTP 200과 73건/8페이지 gallery를 확인했다. nested `dt + 기간 + 장소` 구조 전용 registered parser로 first page를 안전하게 읽도록 등록했다.
- 세 source 모두 retained live-shape fixture와 registered-parser path 회귀 테스트를 추가했다. pagination은 추측하지 않고 first page only로 제한했다.
- main 누적 신규 준비량은 기존 +13에서 **총 +16**으로 증가. production deploy는 아직 하지 않는다.


## 2026-09-26 — access HOLD 해제: 영주 +1

- GitHub Actions live fetch에서 영주시 문화달력이 HTTP 200으로 정상 접근되고, 현재 2026-09 일정의 title·venue·full-year start/end·detail `mon_uid`가 같은 행사 block에 있음을 확인했다.
- calendar는 같은 multi-day 행사를 여러 날짜에 반복 노출할 수 있어 `mon_uid` 기준 dedupe하는 registered parser를 추가했다.
- `gyeongbuk-영주` access HOLD를 해제하고 Registry opt-in했다. retained live-shape fixture에서 category/title/venue/date/detail id와 중복 제거를 검증한다.
- main 누적 신규 준비량은 **총 +17**. production deploy는 아직 하지 않는다.


## 2026-09-26 — access HOLD 해제: 해운대 +1

- 기존 해운대 문화회관 program source는 live HTTP 200이지만 current generic extractor가 0 candidate였다.
- 대신 같은 해운대구청의 더 넓고 durable한 연간행사안내를 GitHub Actions에서 live probe했다. HTTP 200, annual table에서 행사명·기간·장소·소관부서를 self-contained로 제공한다.
- source-specific parser는 table caption의 명시 연도를 같은 row의 exact yearless 날짜에만 적용한다. '9월 중'·복수 날짜 나열처럼 불명확한 일정은 fail-closed 제외하고 full-year/cross-year 범위는 그대로 사용한다.
- `busan-해운대` HOLD를 해제하고 annual source로 Registry opt-in했다.
- main 누적 신규 준비량은 **총 +18**. production deploy는 아직 하지 않는다.


## 2026-09-26 — municipal GAP 해소: 경주 +1

- GitHub Actions live probe에서 경주문화관광 `mnu_uid=4609&listType=list`가 HTTP 200으로 current list를 직접 반환하고, 각 `dl`에 title·full-year 기간·장소·first-party detail `con_uid`를 self-contained로 제공함을 확인했다.
- 기존 inventory의 `mnu_uid=4608` 대신 live current list인 4609/listType=list를 Registry canonical source로 사용한다.
- source-specific registered parser는 각 `dl` 블록 안에서만 title/기간/장소/detail id를 읽어 candidate를 만들며, core 누락은 fail-closed 제외한다.
- retained live-shape fixture와 registered-parser 회귀 테스트를 추가했다.
- main 누적 신규 준비량은 **총 +19**. production deploy는 아직 하지 않는다.


## 2026-09-26 — municipal parser Batch H +1 울산 중구

- GitHub Actions live fetch에서 울산 중구 문화예술업종행사일정이 HTTP 200으로 정상 접근되고, 공식 공연분과 table이 heading에 2026년/월을 명시하며 행사명·일자·장소를 제공함을 확인했다.
- table은 장소/내용/주최를 rowspan으로 공유하므로 generic extractor 대신 source-specific registered parser를 추가했다. parser는 같은 table 안의 rowspan만 carry하고 heading의 명시 연도와 각 row의 명시 월·일만 결합한다.
- '미정' title, 날짜를 정확히 해석할 수 없는 row, venue 누락은 fail-closed 제외한다.
- 현재 live page 자체는 2026-05 공연분과로 오래된 일정이므로 당장 publish 증가를 기대하지 않고, 다음 공식 갱신 시 자동 수집 가능한 상태로만 전환한다.
- main 누적 신규 준비량은 **총 +20**. production deploy는 아직 하지 않는다.


## 2026-09-26 — municipal JSON source staging: 포항 +1

- GitHub Actions live probe에서 포항문화재단 공개 API `/api/phcf/performance/getPerformanceList.do`가 HTTP 200 JSON으로 `event_id/event_title/start_date/end_date/space_name/event_venue/event_category/event_field`를 제공함을 확인했다.
- API client contract에서 `pageIndex/pageSize`를 공식적으로 사용하므로 source URL을 pageSize 25, max 3 pages로 bounded 등록했다. 한 run에서 최대 75개를 읽고 기존 source budget에서 현재/미래 우선 25개만 처리한다.
- registered JSON source만 사용할 수 있도록 `json_payload` document signal을 추가했다. generic extractor에는 JSON 추측 경로를 추가하지 않았다.
- Pohang parser는 취소 상태를 제외하고 full-year date만 허용한다. `space_name=기타`일 때는 `event_venue`에 '포항'이 명시된 경우만 venue로 사용해 외부 지역 행사를 포항으로 오분류하지 않는다.
- first-party detail URL은 API client의 performance/festival/region routing contract 그대로 만든다.
- staging branch Project checks 성공 후 commit `2e161e8dbe14c90fa0a217e939bd4b3e4151f89a`를 main에 fast-forward 반영했다.
- main 누적 신규 준비량은 **총 +21**. production deploy는 아직 하지 않았다.


## 2026-09-26 — municipal GAP 해소: 포천 +1

- 기존 포천 문화사업 월간목록은 list/detail 모두 장소를 `기타`로만 제공하는 항목이 많아 venue core를 안전하게 채울 수 없음을 GitHub Actions POST-detail probe로 재확인했다.
- 같은 포천문화관광재단 공식 홈페이지의 현재 추천 공연·문화관광 card는 2026-10 future 일정에서 title·full-year date·explicit venue·first-party detail uid를 self-contained로 제공한다. 예: Pride 클래식 콘서트, 가을엔 포크 콘서트, 가족뮤지컬, 산정호수 명성산 억새꽃축제.
- 따라서 canonical source를 homepage로 바꾸고 source-specific registered parser `parsePocheonHomepageEvents`를 추가했다. 각 `li.mainBx` 내부 정보만 읽고, `장소=기타` 등 invalid venue card는 fail-closed 제외한다.
- detail URL은 card의 first-party `location.href`만 허용하고 uid를 source identity로 사용한다.
- retained live-shape fixture/test를 추가했다.
- main 누적 신규 준비량은 기존 +21에서 **총 +22**. production deploy는 아직 하지 않는다.


## 2026-09-26 — municipal GAP 해소: 거제 +1

- 거제시 공식 문화관광 행사일정표는 web 확인 기준 2026 월별 목록에서 행사명·장소·기간·시간을 동일 row에 제공한다. 기간은 `26.08.21 ~ 26.08.22`처럼 2자리 연도라 generic full-year parser가 의도적으로 거부하던 구조다.
- source-specific registered parser `parseGeojeMonthlyEvents`를 추가했다. 페이지에 명시된 `2026년 08월 행사일정표`의 4자리 연도와 row의 2자리 연도가 정확히 일치할 때만 full-year 날짜로 승격한다.
- category prefix([공연]/[축제]/[전시])는 category로 분리하고, venue placeholder/날짜 불일치 row는 fail-closed 제외한다.
- first-party detail href가 있으면 보존하고 없으면 공식 월별 목록 URL을 provenance로 유지한다.
- GitHub Actions 환경에서 해당 host fetch는 실패했지만 공식 web source는 접근 가능하므로 source_outcomes 격리 전제 하에 opt-in했다. production에서 fetch 실패 시 이 source만 error로 격리된다.
- main 누적 신규 준비량은 **총 +23**. production deploy는 아직 하지 않는다.


## 2026-09-26 — 채팅 한도 도달 handoff 저장

- 사용자가 현재 대화 최대 길이에 도달해 **새 채팅에서 즉시 이어갈 수 있도록 이 지점을 canonical handoff로 저장**했다.
- 이 저장 직전 latest main: `1b647f6cfd4e346fb0b6a7a1c9feadcb53651277` — `feat: parse Geoje monthly events`.
- 해당 commit의 **Project checks / UI browser smoke 모두 success**.
- municipal source Registry는 현재 **35개**.
- 이번 expansion에서 main에 새로 준비된 source는 누적 **+23개**이며 **아직 production 미배포** 상태다.
- 포천 다음으로 **거제까지 완료**됐다. 거제는 `parseGeojeMonthlyEvents` registered parser로 2자리 연도를 페이지의 명시 4자리 연도와 일치할 때만 승격하고, venue/date/category/detail provenance를 fail-closed 처리한다.
- 현재 ONBOARDING_READY 중 Registry 미등록은 정확히 **3개**:
  1. `seoul-yeongdeungpo` — 영등포 공식 문화행사 일정. inventory상 generic_fallback_paginated 후보지만 이전 GitHub probe에서는 자동 접근 안정성이 문제였다.
  2. `jeonnam-gwangju-목포` — 목포시 공식 문예시설 공연·행사일정. inventory상 generic_fallback_paginated 후보지만 최근 GitHub 환경 fetch가 불안정했다.
  3. `gyeongnam-산청` — 산청군 공식 문화관광 행사일정. inventory상 generic_fallback 후보지만 host/path 접근 안정성 확인이 남아 있다.
- 다음 새 채팅에서 사용자가 `계속`이라고 하면:
  - 먼저 latest main / Actions / 실제 production 상태를 확인하고,
  - **완료 / 현재 / 남은 작업 / 사용자 필요 여부**를 짧게 보고한 뒤,
  - 별도 승인 없이 위 3개를 순서대로 조사·처리한다.
- source 하나가 막히면 그 source만 HOLD로 두고 나머지는 계속 진행한다.
- 3개를 가능한 범위까지 닫은 뒤, main 누적 source 변경을 **production deploy 1회**로 묶는다. 그 전까지 Codespaces를 켜라고 하지 않는다.
- production은 이번 +23 source를 아직 포함하지 않는다. last-known deployed municipal hardening 기준은 main `86163bcdfc2b67e52c3611f7676f946a632e23ed`, Worker version `5d02024b-3f76-4cdd-b751-c59d9e59e97d`; 다음 세션 시작 시 실제 production 상태가 달라졌는지 우선 재확인한다.
- TourAPI 계통은 안정화된 상태이므로 새 증거가 없는 한 다시 건드리지 않는다. UI v2도 회귀가 없는 한 동결 유지.
- 사용자는 routine GitHub 조사/수정/테스트/commit/push에 매번 `시작` 승인을 요구하지 않는다. 활성 turn 안에서는 안전한 bounded task를 연속 처리하고 마지막에 한 번 보고한다.

## 2026-09-26 — final ONBOARDING_READY audit closed

- 새 채팅 handoff에 남아 있던 Registry 미등록 READY 3개(영등포·목포·산청)를 최신 공식 source 기준으로 다시 조사했다.
- `seoul-yeongdeungpo`: 기존 공식 문화행사 canonical endpoint가 현재 404이므로 READY를 철회하고 WATCH로 fail-closed했다. 대체 durable event-only listing은 아직 확정하지 않았다.
- `jeonnam-gwangju-목포`: 목포문예시설 공식 공연·행사일정은 2026-09 current page와 최신 업데이트를 유지하지만, 현재 calendar surface를 existing generic extractor가 행사별 title/date/venue/detail core로 안정적으로 읽는 계약이 검증되지 않아 COLLECTOR_GAP으로 재분류했다.
- `gyeongnam-산청`: 공식 관광캘린더 table의 event core는 충분하지만 source가 `yyyymm` 월 파라미터에 의존한다. Registry에 특정 월을 고정하면 자동수집이 낡으므로 bounded rolling-month URL 지원 전까지 COLLECTOR_GAP으로 재분류했다.
- inventory 최신 분류: ACTIVE 9 / ONBOARDING_READY 26 / COLLECTOR_GAP 41 / WATCH 169 / EXCLUDE 0 / UNREVIEWED 0.
- Registry는 35 source이고, **ONBOARDING_READY 중 Registry 미등록은 0개**다.
- 이번 expansion에서 main에 이미 준비된 신규 source는 여전히 **+23개**이며 production 미배포다. 이번 audit은 신규 Registry source를 추가하지 않았다.
- 다음 안전한 단계는 이 audit PR 검증/merge 후, 누적 +23 source를 기존 Worker에 production deploy 1회로 반영하는 것이다. Cloudflare 인증이 필요한 실제 deploy는 사용자 Codespaces 환경이 필요한 checkpoint로 취급한다.
- TourAPI와 UI v2는 계속 동결한다.


## 2026-09-26 — PR #26 merged / production deploy checkpoint

- PR #26 `docs: close final municipal ready audit`의 Project checks가 success로 완료된 뒤 main에 병합했다.
- merge commit: `57187395084c4f9bb088af0c23d96802588e7483`.
- main Registry는 35 source, ONBOARDING_READY 중 Registry 미등록은 0개다.
- 누적 신규 +23 municipal source는 아직 production 미배포 상태다.
- 다음 단계는 사용자 Codespaces/Cloudflare 인증 환경에서 기존 Worker `weekend-mwohae`에 production deploy 1회 수행 후 galteum.com smoke를 확인하는 것.
- 신규 Cloudflare resource, D1 migration/write, Cron 변경, secret 변경은 필요 없다. 다음 자연 10:00 KST Cron에서 35 source의 `source_outcomes`를 read-only로 검증한다.


## 2026-09-26 — municipal detail route hotfix merged

- +23 municipal source production deployment itself succeeded; deployed Worker version before hotfix redeploy is `b722c4a5-70aa-43d3-ba70-3b0405c2ef0a`.
- Post-deploy production smoke exposed a real municipal detail-route bug: event IDs containing URL punctuation/Korean text were passed to `/api/events/:id` without safe percent-encoding and some public detail routes rejected those IDs, causing 404 for affected municipal events.
- PR #27 `fix: support municipal event ids in detail routes` passed both Project checks and UI browser smoke and was merged to main as `2033d54b457d4b190b1df66a1d0828bb2240e2b8`.
- The fix changes URL encoding/decoding/validation and related tests only; it does not change D1 rows/schema, Cron, secrets, ingestion policy, or Cloudflare resources.
- Next checkpoint: pull latest main in Codespaces, run one verified production redeploy, then run production smoke. If smoke passes, close the +23 deploy stabilization phase and wait for the next natural 10:00 KST Cron to validate all 35 Registry sources via `source_outcomes`.


## 2026-09-26 — +23 production deploy stabilization complete

- 누적 신규 +23 municipal source를 포함한 main이 기존 production Worker `weekend-mwohae`에 배포됐다.
- 첫 배포 후 production smoke가 municipal event ID의 URL encoding 문제를 잡았고, PR #27 hotfix를 main에 병합한 뒤 재배포했다.
- 최종 확인 production Worker version: `b187830c-1bd8-440d-b50c-31ad6ac0402e`.
- 최종 main at deploy: `b6788b0bb24abbac28c9f822815f079ede0562dd`.
- production smoke는 hotfix 재배포 후 연속 2회 PASS: D1 연결, 날짜 구간, 필터, 거리순, 페이지, 상세, 취소 제외, 입력 검증, SQL 바인딩, Static Assets, SPA 정상.
- 기존 D1 `weekend-mwohae-production`, Cron 5개, secrets, bindings는 유지됐고 schema/data migration 및 수동 ingestion은 하지 않았다.
- +23 배포 안정화 Phase는 완료로 닫는다.
- 다음 단계: 2026-09-27 10:00 KST 자연 base Cron에서 Registry 35 source의 `source_outcomes`를 read-only 검증한다. 실패 source만 분리하고 정상 source는 건드리지 않는다.
- 해당 자연수집 검증이 끝나면 전국 245개 1차 조사 + 현재 바로 onboarding 가능한 source 단계는 마감하고, COLLECTOR_GAP 41개를 반복 유형별 공통 기능으로 해결하는 다음 Phase로 넘어간다.


## 2026-09-26 — all-35 municipal production verifier ready

- PR #28 `feat: verify all municipal production sources` passed Project checks and was merged to main as `f5edabce93e3072b8d764de22bdc5d505c49b931`.
- `verify:morning:prod` now covers all 35 Registry municipal sources instead of the previous 3-source checkpoint.
- It reports municipal `source_outcomes` summary as expected/reported/ok/error/missing and bounded error reasons, while keeping all D1 access SELECT/WITH read-only.
- A regression test locks verifier keys to `MUNICIPAL_SOURCE_REGISTRY`, so future Registry additions cannot silently drift from production verification coverage.
- No Worker/runtime behavior, D1 schema/data, Cron, secrets, ingestion, or production deployment changed; Cloudflare redeploy is not needed for this verifier-only change.
- Next action remains: after the 2026-09-27 10:00 KST natural base Cron, pull latest main and run `npm run verify:morning:prod -- --remote` to inspect all 35 sources. Do not trigger manual ingestion.


## 2026-09-26 — all-source verifier D1 query compatibility fix

- PR #29 `fix: avoid complex LIKE in municipal verifier` passed Project checks and was merged to main as `6c49f05f9f6ac0d596620e14e6652f6a025e6618`.
- The previous all-35 verifier used a dynamic `LIKE 'municipal-source-municipal-' || source_key || '-%'` join for published/revalidated counts; Cloudflare D1 rejected it with `LIKE or GLOB pattern too complex`.
- The read-only verifier now joins `municipal_candidate_state.candidate_id = events.id` and groups by `source_key`, removing LIKE/GLOB entirely.
- Regression coverage forbids LIKE/GLOB in this verifier query.
- No Worker/runtime behavior, D1 schema/data, Cron, secrets, ingestion, or production deployment changed. No redeploy is required.
- A verifier run on 2026-09-26 will still reflect the latest base run from 10:00 KST, which occurred before the +23 production deploy; therefore incomplete 35-source outcomes are expected until the 2026-09-27 10:00 KST natural base run.


## 2026-09-26 — all-35 verifier compatibility confirmed against production D1

- After PR #29, `npm run verify:morning:prod -- --remote` completed successfully against production D1; the prior `LIKE or GLOB pattern too complex` error is resolved.
- The latest base run inspected was still 2026-09-26 10:01 KST (`2026-09-26T01:01:23.653Z`), which occurred before the +23 production deploy.
- Therefore the all-source summary correctly reported expected 35 / reported 12 / ok 9 / error 3 / missing 23. The 23 missing keys are exactly the post-deploy batch and are not treated as current failures yet.
- The three legacy sources 과천·하남·상주 remain explicit `source_error` in that pre-deploy base run.
- Next decisive checkpoint remains the 2026-09-27 10:00 KST natural base run. After it finishes, rerun the same read-only verifier and classify only sources that are still error/missing/zero-observed in that new base.


## 2026-09-26 — SEO internal-link fix merged / production deploy checkpoint

- SEO practical audit found the home event cards were button-only navigation, so crawlers had no ordinary internal `href` path from the home results to canonical event detail pages; discovery depended mostly on sitemap/JS.
- PR #30 `fix: expose crawlable home event links` changed home event cards to canonical `/events/:id` anchors while preserving the existing SPA detail dialog for normal left-clicks. Modified clicks/new tabs follow the real detail URL.
- Existing detail exploration cards were already canonical anchors; this closes the main home-to-detail internal-link gap without changing visual design.
- Project checks and UI browser smoke both passed. PR #30 merged to main as `3de8d6f270cec27461d341a599d3a83aef787d32`.
- No municipal ingestion, D1, Cron, Registry, API contract, or production data changed.
- This frontend/runtime change still needs one verified production deploy and production smoke from the authenticated Codespaces environment before the SEO task is closed.


## 2026-09-26 — SEO home-to-detail internal links deployed

- PR #30의 crawlable home event-card links가 authenticated Codespaces에서 production에 verified deploy됐다.
- Deploy main: `c8b9ecbbde9c141a6761b952b4e820bb2bc7bd63`.
- Production Worker version: `3fe9b62a-5a77-4704-bd6e-f9af4b499d78`.
- Production smoke PASS: D1 연결, 날짜 구간, 필터, 반려동물, 거리순, 페이지, 상세, 취소 제외, 입력 검증, SQL 바인딩, Static Assets, SPA 정상.
- 홈 행사 카드는 이제 canonical `/events/:id` href를 노출하면서 일반 클릭에서는 기존 SPA 상세 UX를 유지한다.
- Municipal ingestion/D1/Cron/Registry에는 변경 없음.
- 이 SEO bounded task는 production까지 완료로 닫는다.
- 다음 독립 SEO 후보: 지역/기간 검색어를 받을 indexable landing surface 필요성 및 현재 query-URL canonical 동작 점검. 기존 municipal 35-source natural validation은 별도 대기 상태를 유지한다.


## 2026-09-26 — Seoul weekend SEO landing merged / production deploy checkpoint

- SEO 2차는 faceted query URL 전체를 색인시키지 않고, 실제 검색 의도와 제품 결과가 일치하는 단일 pilot landing만 여는 것으로 결정했다.
- PR #31 `feat: add Seoul weekend SEO landing`이 Project checks와 UI browser smoke를 모두 통과하고 main에 `20a3d7e493bed1073177021b320ac9ff8dcb8f4c`로 병합됐다.
- Pilot URL: `/weekend/seoul`.
- 해당 URL은 서울 + 이번 주말 필터 결과를 직접 보여주며 자체 title/description/canonical/OG metadata를 갖고 sitemap에 포함된다.
- 홈 footer에 `서울 이번 주말 행사` 실제 `<a href>` 내부링크를 추가해 sitemap-only discovery를 피했다.
- 일반 `?period=&region=&theme=&...` 필터 URL은 계속 홈 `/` canonical로 통합해 faceted URL 폭증을 막는다.
- No municipal ingestion, D1 schema/data, Cron, Registry, collector, event API contract change.
- Frontend/Worker/SEO runtime change이므로 authenticated Codespaces에서 verified production deploy + smoke가 필요하다.
- Municipal 35-source natural validation은 독립적으로 2026-09-27 10:00 KST checkpoint를 유지한다.


## 2026-09-26 — Seoul weekend SEO landing deployed

- SEO 2차 pilot landing이 authenticated Codespaces에서 production에 verified deploy됐다.
- Deploy main: `e8ce8b2507622bf3749df97e1cfdf0d499c5ecc4`.
- Production Worker version: `380b70e2-1b23-4565-947b-a09d29399a06`.
- Production smoke PASS: D1 연결, 날짜 구간, 필터, 반려동물, 거리순, 페이지, 상세, 취소 제외, 입력 검증, SQL 바인딩, Static Assets, SPA 정상.
- Pilot URL은 `/weekend/seoul`; 일반 faceted query URL은 계속 홈 canonical 통합 정책을 유지한다.
- Municipal ingestion/D1/Cron/Registry에는 변경 없음.
- External fetch 도구에서는 galteum.com 직접 응답 검증이 차단되어 있어, production-specific SEO head/sitemap 최종 확인은 Codespaces에서 curl로 확인한다.


## 2026-09-26 — Seoul weekend SEO landing production verification complete

- Production `https://galteum.com/weekend/seoul` returned HTTP 200.
- Production HTML verified:
  - title: `서울 이번 주말 행사·축제 | 갈틈`
  - description: 서울 이번 주말 행사·축제·체험 안내 문구 정상
  - canonical: `https://galteum.com/weekend/seoul`
  - og:url: `https://galteum.com/weekend/seoul`
- Production sitemap contains `https://galteum.com/weekend/seoul`.
- SEO 2차 pilot landing task is fully closed through production verification.
- Expansion to additional regional/period landing pages remains gated on pilot indexing/traffic evidence; do not mass-generate similar pages yet.


## 2026-09-26 — pre-promotion production QA completed: 2 blockers found

- 홍보 전 production 실사용 QA를 임시 PR #32에서 read-only로 실행했고, PR은 결과 수집 후 merge 없이 closed 처리했다. main/production 데이터에는 영향 없음.
- 표본: production event pool 78 unique 중 30건, 15개 region 분산 표본. today/weekend/next-weekend를 섞어 검사.
- 30/30 detail API는 정상 응답했고 목록↔상세 핵심 필드 불일치는 없었다.
- 공식/근거 source URL은 30/30 HTTP reachable. 정적 HTML에서 제목/날짜/장소 content signal이 잡힌 것은 21/30; 나머지 9건의 no-content-signal은 JS rendering/목록형 페이지일 수 있어 heuristic warning이며 데이터 오류로 단정하지 않는다.
- Warning 1건은 `2026 수원화성 미디어아트`의 event.checked_at이 약 149h old. 별도 freshness 검토 필요.
- 실제 promotion blocker #1: `서울함공원 한가위 특별행사`는 detail API 200 및 공식 source content signal 정상인데 public canonical `/events/:id` 페이지가 HTTP 404. ID가 URL 문자를 포함하는 municipal ID라 Static Assets/SEO shell path 처리 회귀가 의심된다.
- 실제 promotion blocker #2: mobile 390px에서 production event grid가 document width를 432px까지 밀어 오른쪽 42px overflow. offender는 `.event-card/.card-button/.scene` 2열 카드(각 약 220px). 상세 dialog 자체는 5/5 HTTP 200, primary facts/source row 정상, dialog horizontal overflow 없음.
- 따라서 현재 verdict는 `NOT_PROMOTION_READY`. 본격 홍보 전 위 2개 blocker를 각각 bounded fix로 닫고 동일 production QA를 다시 통과시켜야 한다.
- 다음 bounded task 우선순위: municipal URL형 ID의 public detail 404 수정 → regression test → CI → deploy → affected URL production 200/canonical 확인. 그 다음 mobile 390px event-grid overflow 수정.


## 2026-09-26 — encoded municipal public detail 404 fix merged / deploy checkpoint

- Promotion blocker #1 root cause confirmed: event lookup/decode was correct (detail API 200), but SEO/public detail rendering fetched the encoded `/events/:id` path from the Static Assets binding. For URL-bearing municipal IDs, the asset layer could return 404 even after the Worker had already found the event.
- PR #33 `fix: serve SEO event pages from root SPA shell` changes SEO/public pages to always render from the root SPA shell, then inject event/landing SEO metadata. Missing events still fail closed before shell rendering.
- Regression test now simulates the production asset-fallback failure for an encoded Seoul Hangang municipal ID and requires the public detail page to remain HTTP 200 with canonical URL.
- Project checks SUCCESS. PR #33 merged to main as `4fc86027485f1ca9d7935b6a6587a9ebb0db98f2`.
- No D1, ingestion, Cron, Registry, collector, or API contract changes.
- Production deploy + direct verification of `서울함공원 한가위 특별행사` public URL (HTTP 200 + canonical) is still required before blocker #1 is closed.
- Promotion blocker #2 remains: 390px mobile event-grid horizontal overflow (~42px).


## 2026-09-26 — promotion blockers status: #1 production closed, #2 merged / deploy checkpoint

- Promotion blocker #1 (`서울함공원 한가위 특별행사` encoded municipal public detail 404) is fully closed in production.
  - deployed main: `b83c10bb68932cffa214a6d01d6aa294e8f543cc`
  - production Worker: `41d96f2e-a713-49e2-aba2-b3fc3e358d40`
  - production smoke PASS
  - affected public detail URL returned HTTP 200 and emitted the correct percent-encoded canonical URL.
- Promotion blocker #2 root cause: mobile two-column grid items kept intrinsic minimum width because `.event-card`/inner blocks used default min-width behavior; at 390px event cards expanded to ~220px and pushed document width to ~432px.
- PR #34 `fix: prevent mobile event grid overflow` adds `min-width:0` to the event card shrink chain and a 390px `/weekend/seoul` browser regression requiring document width <= viewport and every event card inside the viewport.
- UI browser smoke SUCCESS and Project checks SUCCESS. PR #34 merged to main as `2d7affe25555e0205791d801785a07da404fd172`.
- No D1, ingestion, Cron, Registry, collector, API, or SEO-route change.
- Promotion blocker #2 still needs authenticated production deploy + smoke + direct 390px production verification before the promotion readiness gate can be re-evaluated.


## 2026-09-26 — promotion blocker #2 production verification complete

- PR #34 mobile event-grid overflow fix was deployed from main `5f9fc492aa9bf9592332c9df43518216416aabd3`.
- Production Worker version: `c855645d-f173-41aa-9d3a-cfba2d264371`.
- Production smoke PASS.
- Direct 390x844 Playwright check on `https://galteum.com/weekend/seoul` returned:
  - HTTP 200
  - viewport 390
  - document scrollWidth 390
  - 12 event cards
  - cardsFit=true
- Promotion blocker #2 is fully closed in production.
- Promotion blocker #1 was already closed in production with HTTP 200 + correct canonical for the encoded Seoul Hangang municipal event detail.
- Therefore the two concrete blockers found by the 30-event pre-promotion QA are both closed. A final read-only promotion QA rerun is the remaining gate before starting broad promotion.


## 2026-09-26 — final promotion-readiness QA passed

- Final read-only production QA rerun completed via temporary PR #35; PR was closed without merge and made no production writes.
- Sample: 30 production events across 15 regions, using today/weekend/next-weekend pools.
- Result:
  - critical_events: 0
  - mobile_checks: 6
  - mobile_failures: 0
  - verdict: `PROMOTION_READY_WITH_REVIEW`
- The previously failing `서울함공원 한가위 특별행사` now passes public detail/canonical validation in the sampled run.
- 390px mobile detail/landing checks passed; no promotion-blocking horizontal overflow remained.
- Warnings: 17 total. Sixteen were `source_fetch_error` from the GitHub runner while probing external official pages; these are treated as external-network/probe warnings, not confirmed event-data defects. One warning was `2026 수원화성 미디어아트` with event.checked_at roughly 150h old and remains a freshness item for routine monitoring.
- Promotion readiness gate is now passed for broad promotion, with normal post-launch monitoring required. SEO/indexing and the Sep 27 municipal all-35 natural-run verification remain separate lanes.


## 2026-09-26 — Search Console/indexing readiness audit

- Public search probe for `site:galteum.com` returned no visible indexed results at audit time. This is not a definitive Search Console index verdict, but indicates no obvious public search presence yet.
- Technical indexing prerequisites in production code are already present: canonical URLs, robots.txt with sitemap, sitemap.xml, crawlable home→detail links, Event JSON-LD, and one indexable pilot landing at `/weekend/seoul`.
- Repository has Naver site verification meta but no Google site verification meta. This does not imply Search Console is unverified because a Google Domain property should normally be verified by DNS TXT/CNAME and does not require an HTML meta tag.
- Next operational gate is Search Console account/property verification plus sitemap submission and URL Inspection for `/`, `/weekend/seoul`, and representative event detail URLs.
- No code change is required before Search Console setup. Do not add a Google verification meta token unless the user chooses URL-prefix HTML-tag verification and provides the exact token.


## 2026-09-26 — Google Search Console connected / sitemap re-submitted

- GSC Wizard connection confirmed with Google Search Console full access.
- Property: `sc-domain:galteum.com`.
- Existing sitemap: `https://galteum.com/sitemap.xml`.
- Before re-submit: lastSubmitted `2026-09-21T16:38:28.770Z`, lastDownloaded `2026-09-25T15:31:46.285Z`, warnings 0, errors 0, contents submitted 222 / indexed 0.
- URL Inspection:
  - `https://galteum.com/`: PASS, `Submitted and indexed`, robots allowed, indexing allowed, fetched successfully as MOBILE, last crawl `2026-09-23T22:44:28Z`.
  - `https://galteum.com/weekend/seoul`: unknown to Google (not yet crawled).
  - representative encoded municipal detail (`서울함공원 한가위 특별행사`): unknown to Google (not yet crawled).
- Sitemap was re-submitted successfully at `2026-09-26T05:58:59.708Z`; accepted/confirmed, warnings 0, errors 0, currently pending Google re-download.
- Do not repeatedly poll. Re-check sitemap/index status after Google has had time to fetch the updated sitemap.


## 2026-09-26 — social share preview metadata merged / deploy checkpoint

- Promotion-link audit found homepage and `/weekend/seoul` had no `og:image`; event pages only had an image when a usable event image existed.
- PR #36 `feat: add social share preview metadata` merged to main as `f3505b387812be38bc5f5fc317019ca4938f7183` after Project checks SUCCESS.
- Added branded 1200x630 raster share image at `/galteum-share.png` using current production visual direction.
- Homepage and SEO landing now emit Open Graph title/description/url/site_name/image metadata plus `twitter:card=summary_large_image`.
- Event pages keep their real verified event image for social preview when available and fall back to `/galteum-share.png` when no usable event image exists. Event JSON-LD still uses only the real event image, not the branding fallback.
- Regression coverage locks homepage, landing, event image, and image-less encoded municipal event fallback behavior.
- No D1, ingestion, Cron, Registry, municipal source, or public API change.
- Production deploy + direct verification of `/galteum-share.png` and page OG tags is still required before this promotion-share task is closed.


## 2026-09-26 — social share preview production verification complete

- Social share preview changes were deployed from main `c6216f810b61ed8ca9a80e1d759f0f566f40f8a9`.
- Production Worker version: `1410e37d-27b5-40e2-a090-de61c4d20a8c`.
- Production smoke PASS.
- `https://galteum.com/galteum-share.png` returns HTTP 200 with `content-type: image/png`.
- Homepage production HTML emits expected Open Graph metadata including title, description, site_name, 1200x630 share image, alt text, and `twitter:card=summary_large_image`.
- `/weekend/seoul` production HTML emits the same complete social-preview image metadata with landing-specific title/description.
- Social share preview bounded task is fully closed in production.


## 2026-09-26 — first promotion channel selected: Threads 7-day organic pilot

- Search Console baseline before active promotion: last 28 settled days through 2026-09-23 = 0 clicks, 2 impressions, root page only. This is the measurement baseline for first-promotion lift.
- First promotion channel is Threads, using organic posts only for the first 7-day pilot; no paid ads yet.
- First campaign URL is `https://galteum.com/weekend/seoul`, not the generic homepage, because it matches a clear search/social intent and already has dedicated title/description/canonical/OG metadata.
- Strategy: conversation-first post copy, one clear link CTA, topic tagging where relevant, and Threads Insights/link-click data to compare hooks. Do not spam identical link posts or mass-post to unrelated communities.
- First 7-day experiment should test three message angles: `서울 이번 주말 뭐하지?`, `아이랑/데이트 어디 가지?`, and `축제·행사 한눈에 보기`.
- Success is evaluated on Threads views/replies/reposts/link clicks plus GA/Search Console lift, not follower count alone.


## 2026-09-26 — promotion pilot paused / UI polish reprioritized

- User paused the planned Threads promotion pilot before execution.
- Do not start active promotion yet.
- Immediate priority is UI polish/review on current production before traffic acquisition resumes.
- When UI work restarts, inspect current production/code state and follow `docs/UI_V2_DIRECTION.md`; do not reopen already-completed UI v2 work unless there is a concrete regression or a newly identified visual/UX issue.


## 2026-09-26 — home hierarchy + horizontal rail fix merged / production pending

- User reopened home UI polish after production screenshot review and explicitly identified top/bottom width mismatch.
- Root cause confirmed in CSS: header/main use the current 1280px layout system while legacy footer still used `max-width:1112px` (plus separate narrow-screen margins), producing a visibly shorter footer rail.
- PR #37 `style: strengthen home hierarchy and align layout rails` merged as `16a458b42c07efc5d62ad539c4bb7fd5397e16b7`.
- Changes are deliberately bounded to home hierarchy/layout:
  - footer surface aligns to the hero/content visible rail on desktop and main content rail on mobile;
  - slightly larger brand/header presence;
  - hero increased from the compressed ~188px treatment to a ~220px desktop target;
  - headline/search field/CTA enlarged so search reads as the primary action;
  - quick-category row given more breathing room while keeping the same information architecture;
  - existing warm ivory / charcoal / orange system, 4-column desktop cards, 2-column mobile cards, filters, APIs and data behavior preserved.
- Regression coverage added for desktop hero sizing, desktop hero↔principle↔footer rail equality, mobile principle↔footer rail equality, and existing overflow behavior.
- UI browser smoke #107 SUCCESS; Project checks #630 SUCCESS.
- No D1/API/SEO route/municipal/detail-page change.
- Production deploy and public desktop/mobile visual verification are still required before this UI task is closed.


## 2026-09-26 — home hierarchy + horizontal rail production verification complete

- Main `ae73de30adaa9d8b1d546e5ad959c503d67640a2` deployed to production.
- Production Worker version: `000a38e2-dab1-49e1-bef7-e21f60ee0f87`.
- Production smoke PASS.
- Desktop 1365px verification:
  - document scrollWidth = viewport = 1365
  - hero = x 67 / width 1232 / height 220
  - principle = x 67 / width 1232
  - footer = x 67 / width 1232
  - hero search = width 499 / height 52
- Mobile 390px verification:
  - document scrollWidth = viewport = 390
  - principle = x 16 / width 358
  - footer = x 16 / width 358
- Therefore the user-reported top/bottom width mismatch is closed in production and the stronger first-screen hierarchy is live without horizontal overflow.


## 2026-09-26 — home card / section hierarchy merged, production pending

- PR #38 `style: strengthen home card and section hierarchy` merged as `12b3739c8e123dd7f67e8cdebcb4d75b2cf9d364`.
- Scope stayed limited to the home discovery/results area:
  - featured recommendation section now has a restrained warm-white editorial surface and clearer heading hierarchy;
  - full-list section is separated more strongly with additional top spacing/divider;
  - event title/date/place typography is stronger and easier to scan;
  - recommendation reason uses the orange discovery accent rather than reading like low-priority metadata;
  - desktop remains 4-column and mobile remains 2-column.
- New browser assertions cover featured-section distinction, card title/date hierarchy, mobile 2-column layout, and horizontal overflow.
- UI browser smoke #109 SUCCESS; Project checks #639 SUCCESS.
- No D1/API/ingestion/municipal/SEO-route/detail-page changes.
- Production deploy + desktop/mobile visual verification remain required before closing this bounded task.


## 2026-09-26 — home card / section hierarchy production verification complete

- Main `a44a0ab5618844eee5bfea3846f4ca4a8855f8a9` deployed to production.
- Production Worker version: `04accdb5-c6da-4c35-8069-2249755d92aa`.
- Production smoke PASS.
- Desktop 1365px verification:
  - document scrollWidth = viewport = 1365
  - featured padding-top 22px / radius 22px / warm-white background live
  - all-events padding-top 34px / divider 1px live
  - featured card title 18px / weight 800
  - date weight 750
  - featured grid remains 4 columns
- Mobile 390px verification:
  - document scrollWidth = viewport = 390
  - featured grid remains 2 columns
  - featured card title size 14px
- Therefore the home card/section hierarchy task is fully closed in production without layout regression.


## 2026-09-26 — trust section / footer polish merged, production pending

- PR #39 `style: polish home trust section and footer` merged as `7eb50cef60f3de2cc7d722b5dbe885047348fc11`.
- Home trust/principle area now uses a bright warm surface with restrained deep-green verification accent instead of an orange notice-box treatment.
- Footer no longer appears as a detached charcoal slab; it now uses a warm light brand finish while preserving the shared horizontal rail.
- Obsolete production footer copy `운영 준비 중` was removed; production mode now reads `공식 출처 기반 · 확인된 정보만 안내합니다.` while sample mode still identifies itself as sample data.
- Existing trust modal entry point, footer SEO landing link, page rails, cards, filters, APIs and data behavior are unchanged.
- Browser regression covers light footer treatment, trust surface, removal of prelaunch copy, and horizontal overflow.
- UI browser smoke #111 SUCCESS; Project checks #649 SUCCESS.
- Production deploy + desktop/mobile public verification remain required before closing this bounded task.


## 2026-09-26 — trust section / footer production verification complete

- Main `fa47301a4790d0074ac41e2ce12a4aa881ebca11` deployed to production.
- Production Worker version: `d88238c4-c3e0-460a-a087-23f87207d56f`.
- Production smoke PASS.
- Desktop 1365px verification:
  - document scrollWidth = viewport = 1365
  - principle radius 22px; its background uses a CSS linear-gradient, so `backgroundColor` reports transparent by design
  - footer background = rgba(239,234,225,0.76), radius 22px, text color charcoal, brand weight 900
  - obsolete `운영 준비 중` copy absent
  - footer copy: `공식 출처 기반 · 확인된 정보만 안내합니다.`
- Mobile 390px verification:
  - document scrollWidth = viewport = 390
  - obsolete prelaunch copy absent
- Trust/footer polish task is fully closed in production.


## 2026-09-26 — home control cleanup merged, production pending

- User production review found the home still visually cluttered, especially when a quick category such as 공연 was selected: theme selection auto-opened the advanced filter panel, the same theme controls were repeated inside that panel, and the active-filter row repeated the selection again.
- PR #40 `refactor: simplify home filters and page ending` merged as `eb0e7f9afe946d52d46788f1df4bd5cbe43fb89e`.
- Quick categories are now the single theme/category control. Selecting a theme no longer auto-opens advanced filters and no longer creates a duplicate theme active-filter chip.
- Advanced filters now focus on audience, location-related state and notifications; duplicate `무엇을` theme chips were removed.
- Discovery/filter container removes side borders/rounded outer box; advanced-filter summary becomes a compact control and its open body uses a light divider instead of another nested card.
- Sparse-result exploration CTA is now a light divider/action row instead of a large boxed panel. Actual result counts remain unchanged; e.g. a 공연 filter that returns 4 official matches still shows exactly those 4 rather than invented filler cards.
- Footer now has a full bottom border/radius plus bottom breathing room, fixing the visually clipped ending.
- UI browser smoke #113 SUCCESS; Project checks #659 SUCCESS.
- Production deploy + desktop/mobile visual verification are still required before closing this bounded task.


## 2026-09-26 — home control cleanup production verification complete

- Main `f511901a68f60b13dc327062c35f43617574a98a` deployed to production.
- Production Worker version: `6b8faaf3-9ab1-4ded-a2a7-5aea14fb52cb`.
- Production smoke PASS.
- 공연 filter production API returned exactly 4 matches; renderedCards = 4, confirming the four-card state is data-driven rather than a UI cap.
- Desktop 1365px verification:
  - document scrollWidth = viewport = 1365
  - advanced filters remain closed after quick-category selection
  - duplicate theme row absent
  - redundant active-filter bar absent
  - sparse-results CTA uses top divider only (1px top / 0px left / 0 radius)
  - footer bottom radius 22px / bottom border 1px / bottom margin 34px
- Mobile 390px verification: document scrollWidth = viewport = 390.
- Home control cleanup / sparse-result / footer-finish bounded task is fully closed in production.


## 2026-09-26 — benchmark-informed home visual cleanup merged, production pending

- User requested that remaining home polish be done while actively benchmarking Klook, Fever and GetYourGuide rather than by intuition alone, including color balance.
- Current benchmark takeaways used for this bounded task:
  - Klook: search/content first, vivid orange accent, mostly neutral surfaces;
  - Fever: dark immersive discovery/hero treatment with content imagery carrying most of the visual weight;
  - GetYourGuide: strong dark text + vivid coral-orange CTA/selection accent, generous white/neutral surfaces and limited container chrome.
- 갈틈 keeps its own warm-ivory canvas and deep-green official/trust state. It does not copy competitor layouts/assets.
- New home discovery accent is `#F45A2A`, intentionally between the Klook/GetYourGuide orange-coral family but distinct from either exact brand color; neutral surfaces now dominate more strongly.
- PR #41 `style: benchmark home visual hierarchy and palette` merged as `438ccb8ca2bb76b1ab9e793c7454f254a0054260`.
- Changes:
  - featured recommendation outer box removed; differentiation now comes from heading/spacing rather than another rounded container;
  - repeated editorial wording simplified: top kicker `이번 주말`, featured heading `먼저 볼 곳`, lower kicker `전체 행사`;
  - card region + venue collapsed to one compact location line;
  - fallback date graphic reduced so it does not overpower photo cards;
  - quick-category/date/control surfaces use less border chrome and a single stronger orange selection accent;
  - desktop 4-column/mobile 2-column and all data behavior remain unchanged.
- Initial UI CI failed only because two older visual assertions still required the previously boxed featured section and 14px mobile title. Contracts were updated to the new unboxed direction and mobile title kept at 14px for readability.
- Final UI browser smoke #117 SUCCESS; Project checks #674 SUCCESS.
- Production deploy + public desktop/mobile visual verification remain required before closing this bounded task.


## 2026-09-26 — benchmark home visual production deploy complete / mobile direct verify pending

- Main `7bd0a2651dfa84f5dff102160a0c2c3fb1f3a259` deployed to production.
- Production Worker version: `0e30b84c-3549-4fac-b1cd-d6f7e93b8582`.
- Production smoke PASS.
- Desktop 1365px direct verification PASS:
  - document scrollWidth = viewport = 1365
  - discovery accent = rgb(244,90,42) / #F45A2A
  - featured section padding 0 / radius 0 / transparent background (unboxed editorial treatment live)
  - featured heading = `먼저 볼 곳`
  - obsolete `이번 주말 먼저 볼 곳` absent
  - first card location line combines region + venue
- Mobile direct verification script failed before assertions because `document.querySelector('.featured-grid')` was null when `getComputedStyle` ran. This is a verification-script timing issue, not evidence of a production UI failure; UI browser smoke #117 had already passed mobile coverage before merge.
- Run one short mobile production check that waits for `.featured-grid` before reading computed styles, then close this bounded task if 2 columns / 14px title / no horizontal overflow pass.


## 2026-09-26 — benchmark-informed home visual production verification complete

- Production Worker `0e30b84c-3549-4fac-b1cd-d6f7e93b8582` remains live with the benchmark-informed home visual cleanup.
- Desktop direct verification had already passed.
- Final mobile 390x844 direct verification PASS:
  - viewport = 390
  - document scrollWidth = 390
  - featured grid = 2 columns
  - featured card title = 14px
- Therefore the benchmark-informed home palette / hierarchy bounded task is fully closed in production.
- No redeploy is required for this documentation-only closure.


## 2026-09-27 — home typography rhythm production verification complete

- PR #43 `style: tighten home typography rhythm` is merged and production-closed.
  - merge commit: `e1c5dd92d7b52b28cf083e64a4ffd502326ea457`
  - UI browser smoke #122: SUCCESS
  - Project checks #693: SUCCESS
- Production deployment used main `923472d65fa8a59acb1610f009b4cb9b48b60f15`.
- Production Worker version: `77db54bf-267e-4eed-a4d5-a2f556ad1d86`.
- Production smoke PASS.
- Direct verification:
  - desktop 1365px: `scrollWidth=1365`, quick category 44px, period 40px;
  - mobile 390px: `scrollWidth=390`, quick category 50px, period 42px;
  - removed quick/category/date/filter helper copy is absent;
  - mobile featured grid remains 2 columns (`169px 169px`).
- No D1, ingestion, municipal, SEO route, detail-page or API behavior changed.
- Do not redeploy for this documentation-only closure.

### Current continuation point

- Completed home tasks must not be repeated: shared rails, card/recommendation hierarchy, trust/footer polish, duplicate-theme cleanup, benchmark palette cleanup, and typography/control-density cleanup are all production-closed.
- Active promotion remains paused until the user finishes the current UI review.
- Do not start another speculative UI redesign. Continue UI work only from a new production screenshot or a concrete visible issue.
- Independent lane: the 2026-09-27 municipal all-35 natural-run checkpoint becomes due after the 10:00 KST base Cron; it does not block the closed UI task.
- Do not mass-create SEO landing pages or reopen TourAPI detail/recovery without new evidence.
