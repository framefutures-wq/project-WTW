# Cloudflare 실제 데이터 배포 기록

거절 기록 보완 후 현재 Worker 버전은 `d12e1ab8-fb39-4d72-8e2f-d97fa67294a5`다. 기존 D1에 별도 기록 테이블만 추가했으며 정상 행사 구조와 Worker·Cron·URL은 유지했다. 실행 결과는 [TOURAPI_REJECTIONS.md](TOURAPI_REJECTIONS.md)를 참고한다. 아래는 최초 실제 데이터 전환 당시의 검증 기록이다.

2026-09-18 18:17 UTC(한국 날짜 2026-09-19)에 실제 데이터 전환과 공개 배포 검증을 완료했습니다. 아래 샘플 기록은 이전 이력입니다.

**공개 URL:** https://weekend-mwohae.framefutures.workers.dev

- 관리 이름: `project-WTW`, 서비스명: 주말뭐해?
- 기존 Worker `weekend-mwohae`, D1 `weekend-mwohae-production`, URL과 Cron `0 21 * * *` 유지.
- 최종 배포 버전: `01eb8499-3097-4841-9f89-bcd03e11e961`.
- 설정: `wrangler.production.jsonc`, `APP_MODE=production`, `TOUR_API_ENABLED=true`.
- 인증키: 기존 Worker의 `TOUR_API_KEY` Secret만 사용. 로컬·프론트엔드·Git에 키를 저장하지 않음.
- 실제 목록 916건 조회 후 2026-09-19~2026-10-19에 겹치는 유효 행사 251건 저장. 로컬에도 동일 스냅샷 복사.
- 양쪽 샘플은 백업 후 제거하여 0건. 출처 251건, 필드 근거 1,004건, 원격 외래키 오류 0건.
- 실제 원문과 저장된 행사 필드 251건 전체 대조 통과.
- TypeScript, 단위 검사 8개, workerd/D1 통합 검사, 빌드 통과.
- 로컬 실제 데이터 Chromium 12개, 최종 공개 Chromium 12개(30.7초) 통과. 데스크톱·모바일, 기간·전체 지역·미확인 필터·상세·한국 시간 표시·레이아웃·JS 오류 검사 포함.
- 로컬·공개 API 234개 응답과 고유 행사 123건 대조 일치. HTML·JS·CSS 동일(`index-C9yfi624.js`, `index-B4tLkMJE.css`). 양쪽 API 기본 검사 통과.

2026-09-19 한국 날짜 기준 오늘 116건, 이번 주말 117건, 다음 주말 66건입니다. 공식 목록에 없는 요금·동행·주제·개최 확인값은 추측하지 않았습니다. 화면에는 개최·취소 미확인과 출발 전 공식 공지 확인 안내를 표시합니다.

새 Worker·D1 생성이나 스키마 마이그레이션은 없었습니다. 실제 수집은 인증된 원격 개발용 scheduled 실행으로 검증했으며 자연 Cron 실행은 아직 관찰하지 않았습니다. 이번 배포는 현재 작업 디렉터리 변경분이며 새 Git 커밋·push는 이번 단계에서 수행하지 않았습니다.

자세한 계약과 재검증 명령은 [TOURAPI.md](TOURAPI.md)를 참고하세요. 최종 결과는 `test-results/real/browser-report.json`, `test-results/real-deployed/browser-report.json`, `test-results/real/parity.json`과 공개 화면 PNG에 보관되며 Git에서 제외됩니다.

---

## 이전 Cloudflare 샘플 배포 기록

2026-09-18 UTC에 실제 Cloudflare 계정에 배포했습니다.

**공개 URL:** https://weekend-mwohae.framefutures.workers.dev

| 항목                     | 값                                                              |
| ------------------------ | --------------------------------------------------------------- |
| Worker                   | `weekend-mwohae`                                                |
| Cloudflare 버전 ID       | `2214da87-b019-4191-8e81-120c6d9d438d`                          |
| 정상 로컬 기준 커밋      | `5eff595`                                                       |
| 실제 배포 소스·설정 커밋 | `626ce83`                                                       |
| 배포 설정                | `wrangler.sample.jsonc`                                         |
| 실행 모드                | `APP_MODE=sample`                                               |
| TourAPI 수집             | `TOUR_API_ENABLED=false`                                        |
| TourAPI Secret           | 미등록, `wrangler secret list` 결과 `[]`                        |
| Static Assets            | `dist/`의 React HTML·JS·CSS, SPA fallback, `/api/*` Worker 우선 |
| Cron                     | `0 21 * * *`, 매일 06:00 한국 시간, 등록 확인                   |

## D1 분리

| 환경                | 설정                        | DB 이름 / ID                                                         | 실제 실행 위치                        |
| ------------------- | --------------------------- | -------------------------------------------------------------------- | ------------------------------------- |
| 로컬 샘플           | `wrangler.jsonc`            | `weekend-mwohae` / `00000000-0000-0000-0000-000000000001`            | `.wrangler/state/v3/d1` 로컬 SQLite   |
| 공개 샘플           | `wrangler.sample.jsonc`     | `weekend-mwohae-production` / `91c55189-7bea-4111-8b20-448e8c1a9dd3` | Cloudflare D1 APAC                    |
| 추후 실제 행사 운영 | `wrangler.production.jsonc` | 동일 원격 DB                                                         | `APP_MODE=production`, 샘플 추천 제외 |

원격 D1은 기존 리소스 목록이 비어 있음을 확인하고 새로 생성했습니다. `0001_initial.sql` 마이그레이션을 원격에 적용했습니다. 현재 로컬 D1을 읽은 스냅샷에서 가상 행사 13개(예정 12개, 취소 1개), 태그 32개를 입력했습니다. 날짜·확인 시각·출처 메타데이터도 그대로 보존했습니다. 기존 실제 데이터는 덮어쓰지 않았습니다.

## 실제 URL 검증 결과

| 검사                                                               | 결과                                                     |
| ------------------------------------------------------------------ | -------------------------------------------------------- |
| 타입 검사, 날짜/입력/거리 단위 검사, workerd/D1 통합 검사, 빌드    | 통과                                                     |
| 로컬 Chromium 테스트                                               | 24개 통과, 49.4초                                        |
| 공개 URL Chromium 테스트                                           | 24개 통과, 59.4초, 실패·건너뜀·불안정 테스트 0개         |
| 데스크톱 / 모바일                                                  | 1440×1000 / 390×844, 정상                                |
| 날짜·17개 지역·무료/유료/미확인·동행 4종·카테고리 5종              | 정상                                                     |
| 복합 필터·초기화·빈 결과·검색·상세·거리순·위치 해제                | 정상                                                     |
| API 오류 처리·페이지·SQL 검색 입력·장애 안내/재시도·늦은 응답 처리 | 정상                                                     |
| 로컬 ↔ 공개 URL API                                                | health·meta·필터·페이지·행사 상세 등 51개 응답 완전 일치 |
| HTML·JS·CSS                                                        | 파일 내용 완전 일치                                      |
| 데스크톱 / 모바일 전체 화면 캡처                                   | 각각 로컬과 SHA-256 일치                                 |
| 원격 D1 SQL 조회                                                   | 예정 12개, 취소 1개, 태그 32개, 마이그레이션 확인        |

전체 화면 캡처 해시:

```text
desktop: 5b39949c9f736a79839a7876a4be475f8dd88729303540958e646c77605f9243
mobile:  353d519bcb702280cb6383338709fc9ce43b740a7439d1563827cf1c26eb8b81
```

기계 판독 검증 기록은 `test-results/deployed/browser-report.json`과 `test-results/deployed/parity.json`에 저장됩니다. 이미지 캡처는 같은 폴더의 `full-desktop.png`, `full-mobile.png`입니다. 이 생성 파일들은 Git에서 제외됩니다.

재검증: 로컬 서버를 실행한 상태에서 `npm run verify:deployment -- https://weekend-mwohae.framefutures.workers.dev`.

모든 행사는 명확히 표시된 가상 샘플입니다. 실제 TourAPI 연결은 하지 않았습니다. 원격 Cron은 등록을 확인했으며 이번 검증에서 자연 발생 실행이나 공개 URL을 통한 강제 실행을 주장하지 않습니다. 샘플 날짜는 고정 스냅샷이므로 시간이 지나면 목록이 비게 됩니다. 이후 샘플 갱신은 별도 절차로 처리하며 기존 데이터가 있는 원격 DB에는 최초 시드를 반복 적용하지 않습니다.
