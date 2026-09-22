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
- Cron:
  - 10:00 KST base sync
  - 11:00 KST TourAPI detail enrichment
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

**중요:** 현재 대화에서는 이 `367dedd6` 버전의 production deploy 완료 로그를 아직 확인하지 못했다.
따라서 새 채팅에서 완료됐다고 단정하지 말고 최신 main/배포 상태부터 확인한다.

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

부천은 공식 보도자료/상세 페이지에 이미지·운영시간·소개·문의 등이 더 있을 가능성이 높다.
다음 데이터 작업 방향:
**부천 기본수집 → 공식 상세자료 매칭 → 대표이미지/운영시간/상세소개/문의 보강**
그 다음 공식 지역 source 1개씩 확대.

## 새 채팅 첫 순서

1. `AGENTS.md` 읽기
2. `PROJECT_CONTEXT.md` 읽기
3. 이 파일 읽기
4. 최신 `origin/main` 확인
5. GitHub Actions 확인
6. 직전 상세 이미지 수정의 production 반영 여부 확인
7. 상세 UI 안정화가 끝났다면 지자체 상세보강으로 넘어가기

## 대화 톤

사용자에게 길게 사전설명하기보다:
- "확인했다"
- "원인은 이것"
- "이렇게 수정했다"
- "검증 결과"
- "다음 작업"
순서로 짧게 보고한다.

사용자가 이미 지적한 문제를 다시 사용자에게 확인시키지 않는다.
