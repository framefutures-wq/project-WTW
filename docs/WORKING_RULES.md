# 갈틈 작업 운영 규칙

> 목적: 새 ChatGPT/Codex 세션에서도 프롬프트 작성 방식, 모델 선택, 작업 단위, 검증·배포 방식이 흔들리지 않도록 하는 고정 운영 계약.
> 프로젝트 작업을 시작하거나 Codex용 실행 프롬프트를 만들기 전에 반드시 읽는다.

## 1. 기본 작업 원칙

- 설명보다 실제 실행을 우선한다. 사용자가 "진행", "진행해봐", "ㄱㄱ", "고고", "실행해"라고 하면 가능한 범위에서 바로 작업한다.
- 중간 진행상황을 계속 보고하지 않는다.
- 한 번의 bounded task는 구현/수정 → 관련 검증 → commit/push → 필요 시 deploy/public verify → 최종 보고 1회로 닫는다.
- 이미 완료된 단계, PR, CI, deploy, probe를 불필요하게 다시 확인하지 않는다.
- GitHub Actions가 진행 중이면 짧은 간격으로 반복 polling하지 않는다.
- 현재 working tree의 사용자 작업이나 미커밋 변경을 임의로 reset/restore/delete하지 않는다.
- 중단된 작업은 처음부터 다시 하지 말고 git status, 최근 commit, diff를 먼저 읽고 남은 작업만 이어간다.
- 범위를 넓혀 겸사겸사 구조개편하지 않는다. 현재 요청에 필요한 최소 범위만 수정한다.
- production 상태와 문서가 다르면 최신 GitHub main / 실제 production을 source of truth로 삼는다.

## 2. 모델 선택 규칙 — 가장 낮은 충분한 모델 우선

Codex/작업 프롬프트에는 가능하면 맨 위에 권장 모델을 명시한다.

### Luna 우선
- 조사 / 공식 문서 확인
- 현재 상태 확인
- git status / log / diff 읽기
- 로그·CI 결과 해석
- 단순 명령 실행
- 문서 갱신
- 작은 단일 파일 수정
- 코드 변경 전 사전 검증 / 후보 소스 조사

### Terra / Medium
- 실제 기능 구현
- 여러 파일 수정
- extractor / parser 구현
- 테스트 추가·수정
- UI의 의미 있는 한 덩어리 구현
- 기존 구조를 유지한 중간 난도 버그 수정

### Sol / High
- 아키텍처 변경
- 여러 subsystem이 얽힌 어려운 버그
- 운영 위험이 큰 변경
- 낮은 모델로 충분히 해결하기 어려운 복합 추론

원칙:
- 강한 모델이니까 더 좋겠지로 Sol을 기본 선택하지 않는다.
- Sol/High를 쓴다면 체크리스트 확인 수준이 아니라 그 비용을 정당화할 만큼 하나의 의미 있는 작업 덩어리를 끝내야 한다.
- research/state check와 implementation을 분리할 수 있으면 Luna로 먼저 조사 → 실제 코드 변경이 필요할 때만 Terra로 넘어간다.

## 3. 실행 프롬프트 작성 규칙

사용자에게 Codex 실행 프롬프트를 주기 전에 프롬프트 자체를 먼저 검증한다.

반드시 확인:
- 현재 origin/main / working tree / 최근 완료 상태와 충돌하지 않는가
- **프롬프트를 사용자에게 주기 직전에 불필요한 작업이 섞이지 않았는지 한 번 더 검토한다.** 현재 bounded task의 목표에 직접 필요하지 않은 refactor, formatting, 파일 이동, 공통화, 문서 수정, 전체 테스트, deploy/probe는 제거한다.
- 이미 끝난 작업을 다시 시키고 있지 않은가
- 필요한 조건이 빠지지 않았는가
- 위험한 reset/delete/대규모 수정 가능성이 없는가
- 작업 범위가 불필요하게 커지지 않았는가
- 관련 테스트 / 회귀검증 / commit-push / 필요 시 deploy 조건이 포함됐는가
- production D1 write, cron 강제 실행, 신규 Cloudflare resource 같은 위험 행동이 정말 필요한가

프롬프트 형식:
- 맨 위에 권장 모델
- 목표는 하나의 bounded task
- 현재 기준점과 이미 끝난 것 명시
- 해야 할 일 / 하지 말아야 할 일
- 필요한 최소 테스트
- 종료 조건
- 최종 보고 항목

금지:
- 한 프롬프트에 여러 Phase를 몰아넣기
- 전체적으로 확인하고 개선해처럼 끝이 없는 지시
- 이미 검증된 CI/deploy를 또 돌리기
- 무조건 npm run check
- 중간보고 요구
- 긴 배경 설명을 프롬프트 절반 이상 차지하게 만들기

## 4. 프롬프트 길이 / 작업 크기 규칙

프롬프트는 짧되 실행에 필요한 조건은 빠지지 않게 쓴다.

한 프롬프트는 보통 다음 중 하나만:
- 공식 source 1~2개 조사/온보딩
- 하나의 extractor/parser 기능
- UI 한 덩어리(예: 홈+카드 시각체계 또는 상세 정보구조)
- 하나의 production deploy/verify
- 하나의 probe/검증

작업이 크면 프롬프트를 여러 개로 나누되, 각 프롬프트가 자체적으로 완료 가능한 경계를 가져야 한다.

사용자가 좋아한 기준:
- 필요한 명령 몇 개
- 예상 밖 변경만 확인
- 관련 테스트
- commit/push
- 최종 요약

## 5. 테스트 / 검증 규칙

- 변경한 영역과 직접 관련된 테스트부터 실행한다.
- npm run check 전체 실행은 범위가 크거나 release boundary에서 실제 필요할 때만 한다.
- UI 변경은 테스트 통과만으로 완료하지 않는다. desktop/mobile 실제 viewport에서 시각 검증한다.
- production behavior가 바뀌면 기존 Worker에 deploy 후 public verify한다.
- docs/tests/dev script만 바뀌면 Cloudflare deploy하지 않는다.
- D1 destructive change, resource recreate, secret change, outage-risk change는 자동 진행하지 않는다.
- 실패한 테스트를 무시하고 commit/deploy하지 않는다.

## 6. CI / 배포 / 상태 확인 규칙

- CI를 짧은 간격으로 반복 조회하지 않는다.
- 이미 success가 확인된 run은 동일 작업에서 재확인하지 않는다.
- 배포가 필요한 변경만 deploy한다.
- production smoke는 변경 기능과 핵심 회귀만 확인한다.
- 배포됨과 코드가 main에 있음을 구분한다.
- 사용자가 배포 전 확인을 요구한 영역은 먼저 확인하고 진행한다.

## 7. 최종 보고 규칙

중간보고 없이 마지막에 한 번만 짧게 보고한다.

필요한 항목:
- 무엇을 완료했는지
- 테스트 결과
- commit hash / push 여부
- deploy 필요 여부와 수행 여부
- public verify 결과(해당 시)
- 현재 source count 등 이번 작업의 핵심 결과
- git status clean 여부

사용자가 Codex 결과를 가져올 때는 보통 최종 summary 블록만 있으면 충분하다. Ran / Edited / Explored 전체 로그를 다시 붙이라고 요구하지 않는다.
- **큰 파트 하나가 끝날 때마다 현재 로드맵을 사용자에게 보여준다.** 완료된 위치, 현재 위치, 다음 큰 파트를 짧게 표시한다. 작은 bounded task마다 반복해서 보여주지는 않는다.

## 8. 비용 / 사용량 절약 규칙

### 프롬프트 전 사용량 감사

프롬프트를 사용자에게 주기 전에 안전성뿐 아니라 **예상 사용량과 반복 비용**도 반드시 검토한다.

- 같은 Codespace/같은 연속 작업 세션에서 이미 읽은 장문 프로젝트 문서를 매 bounded task마다 다시 전부 읽게 하지 않는다. 새 세션이거나 상태가 바뀐 문서만 다시 확인한다.
- 같은 큰 UI 파트 안의 소작업마다 typecheck + build + browser regression + deploy + production smoke/public visual verify를 전부 반복하지 않는다.
- 소작업은 변경 영역에 필요한 최소 로컬 검증 + commit/push로 닫고, **production deploy/public verify는 큰 파트 완료 시 1회**로 묶는 것을 기본으로 한다. 단, 운영 동작 자체를 바꾸거나 즉시 production 검증이 필요한 고위험 변경은 예외다.
- 프롬프트에 포함된 각 명령/검증/배포가 이번 bounded task 결과를 바꾸는지 확인하고, 아니면 제거한다.
- 모델은 CSS 중심 단일 UI 수정·문서/상태 확인은 Luna 가능 여부를 먼저 본다. JSX 구조 변경이나 의미 있는 UI 덩어리는 Terra/Medium을 사용한다.
- 사용량을 많이 쓰는 browser screenshot/visual QA, deploy, production smoke는 한 작업에서 중복 수행하지 않는다.
- 작업 시작 전에 “이 작업을 로컬에서 끝내도 되는가 / 지금 deploy가 꼭 필요한가 / 같은 검증을 이미 직전 작업에서 했는가”를 명시적으로 판단한다.


- 상태 확인과 조사에 고급 모델을 쓰지 않는다.
- 같은 사실을 여러 번 검증하지 않는다.
- 불필요한 전체 테스트, 전체 repo 탐색, 반복 CI polling을 피한다.
- 먼저 cheap deterministic path를 사용한다.
- 신규 Cloudflare resource / Workers AI / Queue는 실제 필요와 비용 근거가 있을 때만 사용한다.
- 사용량이 빠르게 소모되면 작업을 더 작은 bounded task로 줄이고 Luna → Terra 순으로 사용한다.

## 9. 새 세션 시작 체크

새 ChatGPT/Codex 세션에서는 다음을 먼저 읽는다:
1. AGENTS.md
2. PROJECT_CONTEXT.md
3. NEXT_CHAT_HANDOFF.md
4. docs/WORKING_RULES.md
5. UI/상세 작업이면 docs/UI_V2_DIRECTION.md

그 다음 최신 origin/main, working tree, 중단된 변경을 확인하고 처음부터 재작업하지 말고 중단 지점부터 이어간다.

이 운영 규칙을 변경하려면 사용자의 최신 명시적 결정을 우선한다.
## 10. Deterministic 전국 municipal survey 자동 진행 권한

- 사용자는 전국 municipal/source coverage survey에 대해 **지자체별·batch별 중간 승인 없이 deterministic queue 순서대로 계속 진행**하도록 명시적으로 위임했다.
- 각 batch는 여전히 하나의 bounded task로 유지한다. 한 task가 끝나면 필요한 최소 검증 → docs/data 갱신 → commit/push까지 닫고, 다음 survey batch는 별도 bounded task로 이어간다.
- routine read-only source 조사, inventory 상태 분류, docs/data 갱신, 검증, commit/push는 다시 허락을 묻지 않는다.
- 조사 중 READY가 누적돼도 production/Registry onboarding은 기존 운영 순서와 checkpoint를 따른다. C/D checkpoint 전 production onboarding 금지 원칙은 유지한다.
- D1 destructive change, resource recreate, secret 변경, 신규 Cloudflare resource/비용 영향, outage-risk 변경, 예상하지 못한 구조 변경처럼 고위험 작업만 멈추고 사용자 확인을 받는다.
- source가 불명확하거나 접근 실패인 경우 임의 추론하지 않고 WATCH/GAP 등 fail-closed로 분류한 뒤 다음 queue로 진행한다.
- 사용자에게는 매 batch마다 승인 요청하지 않고, 큰 지역 또는 큰 Phase가 닫힐 때만 요약 보고한다.

