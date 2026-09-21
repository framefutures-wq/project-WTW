# 갈틈 프로젝트 컨텍스트

> 마지막 갱신: 2026-09-21
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
- SEO canonical/sitemap/robots/structured data는 별도 SEO Phase에서 처리한다.

## 3. 운영 아키텍처

- Cloudflare Workers + Static Assets
- Cloudflare D1
- Cloudflare Cron Triggers
- Cloudflare Secrets
- React + TypeScript
- GitHub source of truth
- GitHub Codespaces + Codex CLI

Production Cron:
- 매일 06:00 KST
- 기존 cron expression: `0 21 * * *` UTC

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
  - 현재 실제 GA4/Cloudflare external ID가 없어 **production disabled**
- 공개 브랜드 리브랜딩: 주말뭐해? → 갈틈
- Custom Domain `galteum.com` 연결

## 7. Analytics 현재 상태

Analytics 코드는 production에 배포되어 있으나 실제 provider는 꺼져 있다.

현재 정책:
- 정확한 GPS 좌표 전송 금지
- raw 검색어 전송 금지
- push endpoint/auth/key 전송 금지
- User-ID 사용 금지
- 광고/리마케팅 용도 아님

향후 순서:
1. domain cutover 완료
2. GA4 property / Web stream을 **갈틈 / https://galteum.com** 기준으로 생성
3. GA4 Measurement ID 설정
4. Cloudflare Web Analytics token 설정
5. production enable
6. Search Console 등록
7. SEO 작업

## 8. 현재 발견된 중요 문제 — 일반 행사 상세정보가 빈약함

### 증상

일반 TourAPI 행사 상세를 열면 다음 정도만 보이는 경우가 많다:
- 대표 이미지
- 행사명
- 일정
- 장소
- 문의
- 공식 안내 링크
- 출처

반면 아래는 대부분 보이지 않는다:
- 행사 소개
- 주요 볼거리
- 프로그램
- 상세 시간
- 가격
- 주차
- 기타 유용한 방문 정보

### 원인

이 현상은 도메인/리브랜딩 문제가 아니다.

현재 UI는 정확성 정책에 따라 **공식적으로 확인되지 않은 optional 정보는 숨긴다**.

상세 UI는 다음 테이블이 채워진 경우에만 풍부한 정보를 보여준다:
- `event_enrichments`
- `event_highlights`
- `event_programs`
- `event_program_occurrences`
- `event_operating_hours`

하지만 현재 `scripts/enrich-selected-events.mjs`는 대표 5개 행사만 수동으로 보강하는 **폐쇄형 스크립트**다. 코드 주석상 discovery/backfill 용도로 확장하지 않게 되어 있다.

TourAPI 기본 `description`도 실제 소개문 대신 일반 안내문을 저장하고, UI의 `usefulDescription()`이 해당 일반 문구를 숨긴다.

따라서 **일반 행사 전체에 대한 자동 detail enrichment pipeline이 아직 없다.**

## 9. 다음 최우선 작업 — Zero-Human Detail Enrichment

도메인/Analytics/SEO를 계속 진행하기 전에, 일반 행사 상세의 품질을 서비스 수준으로 올리는 작업이 우선이다.

목표:
- 현재/향후 공개 행사에 대해 자동 상세정보 보강
- 사람이 특정 행사 5개씩 골라 넣는 구조 제거
- 공식 데이터만 사용
- optional 정보 누락은 publish blocker로 만들지 않음
- source failure는 fail-closed
- Cron으로 자동 갱신
- D1 read/write bounded

우선 활용할 수 있는 공식 데이터:
- TourAPI 행사 목록
- TourAPI 상세 계열 endpoint에서 제공 가능한 공통정보/소개정보/반복정보/이미지정보
- 필요한 경우 기존 official organizer/municipal evidence

상세 후보 필드:
- 행사 소개
- 운영시간
- 주요 프로그램/행사 내용
- 행사별 비용
- 공식 문의
- 공식 홈페이지
- 주차
- 공식 이미지
- 기타 방문 판단에 실제로 유용한 필드

절대 하지 말 것:
- AI로 빈 필드 생성
- 시설 입장료를 행사 참가비로 오인
- 판매/예약기간을 행사기간으로 오인
- 여러 날짜 구간을 임의로 하나로 합치기
- 모든 행사에 가짜 summary를 채우기
- 수동 review queue를 일상 운영에 넣기

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
  - 현재 list snapshot 기반 core event 저장
  - 기본 description은 일반 안내문
  - raw payload에는 fact classification에 활용 가능한 필드들이 존재

현재 수동 enrichment:
- `scripts/enrich-selected-events.mjs`
  - 대표 5개 이벤트 전용
  - 일반 자동 enrichment 해결책이 아님

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

현재 우선순위:
1. **Zero-Human Detail Enrichment**
2. galteum.com host cutover 마무리
3. GA4 + Cloudflare Web Analytics 실제 활성화
4. Search Console
5. SEO/Public Launch readiness
6. 무료 공개 후 실제 traffic 관찰
7. 행사/지역 coverage 확대
8. 수익화는 traffic 확보 뒤 진행

수익화는 현재 보류한다.

## 12. Git / 작업 종료 규칙

- 정상 완료 시 relevant tests → git status/diff → secret check → commit → push main
- Worker/API/frontend/production behavior 변경이면 기존 Worker에 deploy 후 public verify
- docs/tests/dev scripts만 변경이면 불필요한 Cloudflare deploy 금지
- D1 파괴적 변경은 사용자 승인 전 자동 실행 금지
- 실패한 테스트, 미완성 작업, Secret 노출 가능성, destructive migration, resource replacement 필요 시 자동 종료 절차 중단

## 13. 최근 기준점

주요 최근 commit:
- `716f5f2` — `feat: rebrand public service as 갈틈`
- `d3c4026` — `feat: add privacy-safe analytics foundation`
- `8bb3346` — private source description safety fix
- `8c13a85` — Korean Folk Village private source

이 문서를 읽을 때는 GitHub의 최신 `main`을 항상 다시 확인하고, commit hash나 운영 데이터 count처럼 변할 수 있는 값은 현재 상태를 우선한다.

## 14. 새 세션 시작 방법

새 ChatGPT/Codex 세션에서는 먼저:
1. `AGENTS.md` 확인
2. **`PROJECT_CONTEXT.md` 확인**
3. 최신 `origin/main` 확인
4. working tree 확인
5. 이 문서의 "현재 우선순위"와 실제 repo 상태가 일치하는지 검증
6. 이전 대화 전체를 다시 재구성하려 하지 말고 이 문서를 handoff 기준으로 사용

이 문서는 중요한 제품 결정이나 운영 상태가 바뀔 때 갱신한다.
