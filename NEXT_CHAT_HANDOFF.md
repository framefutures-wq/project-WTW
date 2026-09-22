# 갈틈 새 채팅 인수인계

> 2026-09-22 기준. 새 ChatGPT 세션에서 이 파일과 `PROJECT_CONTEXT.md`를 먼저 읽고 바로 이어서 작업한다.

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
- 새 운영 결정(아직 미구현):
  - 10:00 base가 끝날 때까지 11시를 기다리지 않는다.
  - base 수집에서 새 행사/변경 행사가 확인되는 즉시 상세보강 단계로 자동 handoff한다.
  - 11:00 Cron은 주 작업이 아니라 watchdog/recovery 역할로 남겨 미완료·실패·재시도 대상만 처리한다.
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
4. 최신 `origin/main` 확인
5. GitHub Actions 확인
6. 상세 이미지 production 검증 완료 상태 확인
7. 부천 지자체 상세보강을 이어간다. 공식 core 충돌은 덮어쓰지 않는다.

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
