# project-WTW Codex 지침

관리용 프로젝트 이름은 `project-WTW`, 사용자 서비스명은 `주말뭐해?`다.

## 작업 완료 시 자동 저장

사용자 요청 하나를 정상 완료하고 해당 변경에 필요한 모든 테스트와 검사를 통과하면, 별도의 저장 요청 없이 전체 완료 변경사항을 Git에 commit하고 GitHub `framefutures-wq/project-WTW`의 `main` 브랜치에 push한다. 이 규칙은 이후 이 프로젝트의 작업에도 계속 적용하며 정상 완료 시 commit·push를 다시 승인받지 않는다.

commit 전에 git status와 diff를 확인하고, 새 파일을 포함한 저장 대상 전체에 Secret·API Key·토큰·비밀번호·개인키 등 민감정보가 없는지 검사한다. Cloudflare Secret 값과 로컬 인증 파일·환경 파일·DB 덤프·실행 결과물은 commit하지 않는다. 값이 없는 변수명·등록 절차·명확한 합성 테스트 데이터는 실제 인증정보와 구분한다.

다음 중 하나라도 있으면 자동 push를 중단하고 사용자에게 원인과 현재 상태를 먼저 알린다.

- 테스트 또는 필수 검사 실패
- 미완성 작업 또는 해결되지 않은 오류
- Secret·API Key 등 민감정보 포함 가능성
- 대규모 삭제
- 운영 인프라의 파괴적 변경

이 예외를 임의로 무시하거나 사용자 작업을 삭제해 clean 상태를 만들지 않는다. 강제 push·기록 재작성·운영 리소스 삭제는 자동 저장 범위에 포함하지 않는다. 원격 변경 충돌이나 로그인·실행 승인이 필요한 경우에도 정상 절차를 따르고, 우회하지 않는다.

push 후 원격 main을 확인하고 로컬 HEAD와 origin/main이 동일한지, working tree가 clean인지 확인한다. 완료 보고에는 commit hash, push 결과, 원격 일치 여부와 clean 여부를 포함한다.

## 운영 자원과 데이터

기존 Cloudflare Worker `weekend-mwohae`, D1 `weekend-mwohae-production`, Cron과 공개 URL을 유지한다. 사용자 요청 없이 리소스를 재생성하거나 이름을 바꾸지 않는다. TourAPI 인증키는 Cloudflare Secret으로만 관리한다. 공식 데이터에서 확인되지 않는 일정·장소·가격·개최/취소 여부 등을 추측하지 않는다.
