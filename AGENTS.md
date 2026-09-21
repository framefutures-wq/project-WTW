# project-WTW Codex 지침

관리용 프로젝트 이름은 `project-WTW`, 사용자 서비스명은 `갈틈`이다.

## 작업 종료 절차

사용자 요청 하나가 정상 완료되면, 사용자가 별도로 저장·배포를 요청하지 않아도 아래 절차를 기본으로 수행한다. 이 규칙은 이후 작업에도 계속 적용하며, 정상 완료 시 commit·push·필요한 운영 반영을 다시 승인받지 않는다.

### 완료 검증

- 이번 변경과 관련된 테스트와 필수 검사를 실행하고 통과 여부를 확인한다.
- `git status`와 diff를 확인한다.
- 저장 대상 전체에 Secret·API Key·Token·비밀번호·개인키 등 민감정보가 없는지 검사한다. Cloudflare Secret 값, 로컬 인증 파일·환경 파일·DB dump·실행 결과물은 commit하지 않는다. 값이 없는 변수명·등록 절차·명확한 합성 테스트 데이터는 실제 인증정보와 구분한다.
- 임시 디버깅 코드와 불필요한 파일이 남아 있지 않은지 확인한다.

테스트 실패, 미완성 작업, 해결되지 않은 오류 또는 아래 예외가 있으면 자동 commit·push·배포를 진행하지 말고 원인과 현재 상태를 먼저 보고한다. 이 예외를 임의로 무시하거나 사용자 작업을 삭제해 clean 상태를 만들지 않는다.

테스트 assertion 실패는 배포를 중단한다. 다만 optional browser smoke가 application과 무관한 missing OS dependency 때문에 browser process를 시작하지 못한 경우에는, core tests·integration·build가 모두 통과하고 사용자가 명시적으로 승인한 때에만 `NOT RUN / ENVIRONMENT UNAVAILABLE`로 기록하고 진행할 수 있다. 이 경우 production 시각 QA는 별도로 수행한다.

### GitHub 저장

정상 완료된 변경사항이 있으면 적절한 commit message로 commit하고, GitHub `framefutures-wq/project-WTW`의 `main` 브랜치에 push한다. 현재 repository와 `origin` remote를 유지하며 새 repository를 만들거나 remote를 임의로 변경하지 않는다. push 후 원격 `main`을 확인하여 로컬 HEAD와 `origin/main`이 동일하고 working tree가 clean인지 검증한다.

GitHub 인증 시 `GITHUB_TOKEN` 또는 `GH_TOKEN` 환경변수가 저장된 `gh` 인증을 가리면 토큰 값을 출력하지 않고 환경변수 영향을 안전하게 제거한 뒤 기존 `gh` 인증을 사용한다. 강제 push와 기록 재작성은 자동 저장 범위에 포함하지 않으며, 원격 충돌·로그인·실행 승인이 필요한 경우 정상 절차를 따른다.

### Cloudflare 운영 반영

이번 작업이 실제 서비스 동작에 영향을 주는 경우에만 GitHub push 이후 운영 환경에 반영한다. 대상에는 Worker 코드, API, 프론트엔드, Static Assets, 운영 설정, 서비스 동작에 필요한 D1 schema 변경이 포함된다. 문서·테스트 코드·개발용 스크립트만 변경된 경우에는 재배포하지 않는다.

운영 반영 시 기존 Worker `weekend-mwohae`, D1 `weekend-mwohae-production`, Cron, 공개 URL과 Secrets를 유지한다. 리소스를 재생성·교체·삭제하거나 이름을 바꾸지 않는다. 배포 후 공개 URL 응답, 변경 기능, 기존 핵심 기능 회귀, API, 운영 D1 연결을 검증하고 가능한 경우 최신 Git commit이 운영 배포에 반영됐는지 확인한다.

### D1 migration과 운영 DB 변경

D1 schema 변경 전 기존 데이터 손상 여부를 확인하고, migration과 새 코드의 호환성 및 적용 순서를 검토한다. 원격 D1 반영 후 검증하고 필요한 Cloudflare 배포를 진행한다. `DROP`, 대량 `DELETE`, 초기화, 기존 컬럼 제거 등 파괴적 변경은 자동 실행하지 말고 먼저 사용자에게 알린다. 정상 행사 데이터와 기존 운영 데이터를 새 기능을 위해 삭제하거나 초기화하지 않는다.

### 종료 보고

완료 보고에는 완료한 작업, 관련 테스트 결과, commit hash, GitHub push 여부, Cloudflare 배포 필요 여부와 수행 여부, 공개 서비스 검증 결과, working tree clean 여부를 간단히 포함한다. 문서만 변경된 경우 Cloudflare를 배포하지 않았다고 명시한다.

### 자동 종료 예외

다음 상황에서는 자동 종료 절차를 멈추고 원인과 현재 상태를 먼저 알린다.

- 테스트 실패, 미완성 작업 또는 해결되지 않은 오류
- Secret·API Key·Token 등 민감정보 노출 가능성
- 대규모 삭제
- 파괴적 D1 migration
- 기존 운영 리소스의 교체·삭제가 필요함
- 공개 서비스 장애 가능성이 큰 변경

## 운영 자원과 데이터

기존 Cloudflare Worker `weekend-mwohae`, D1 `weekend-mwohae-production`, Cron과 공개 URL을 유지한다. 사용자 요청 없이 리소스를 재생성하거나 이름을 바꾸지 않는다. TourAPI 인증키는 Cloudflare Secret으로만 관리한다. 공식 데이터에서 확인되지 않는 일정·장소·가격·개최/취소 여부 등을 추측하지 않는다.
