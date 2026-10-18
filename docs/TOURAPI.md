# project-WTW TourAPI 실제 데이터 연동

서비스명은 **갈틈**. 기존 Worker `weekend-mwohae`, D1 `weekend-mwohae-production`, 하루 1회 Production Cron `0 1 * * *`(매일 10:00 KST), 공개 URL은 유지한다. 새로운 Cloudflare 리소스나 D1 마이그레이션은 필요하지 않다.

## 공식 계약 확인

2026-09-18에 [공공데이터포털 한국관광공사_국문 관광정보 서비스_GW](https://www.data.go.kr/data/15101578/openapi.do)의 공식 Swagger 명세와 첨부 **활용매뉴얼(국문) v4.4**(2026-02-26)를 확인했다. REST 기본 주소는 `https://apis.data.go.kr/B551011/KorService2`.

| 기능                                  | 공식 엔드포인트                    | 최소 연동                                     |
| ------------------------------------- | ---------------------------------- | --------------------------------------------- |
| 행사 목록·일정·주소·좌표·진행 상태    | `searchFestival2`                  | 사용                                          |
| 법정동 시도코드·지역명                | `ldongCode2`                       | 사용                                          |
| 행사장 이름·이용요금·주최자·관람 연령 | `detailIntro2`, `contentTypeId=15` | 필드 확인만 완료, 이번 수집에서 사용하지 않음 |
| 행사 개요·홈페이지                    | `detailCommon2`                    | 필드 확인만 완료, 이번 수집에서 사용하지 않음 |

공통 필수 요청은 `serviceKey`, `MobileOS`, `MobileApp`. `MobileOS=WEB`, `MobileApp=project-WTW`, `_type=json`을 사용한다. 목록은 `eventStartDate` 필수, `eventEndDate` 선택. 지역의 이전 `areaCode`는 공식 최신 명세에서 미사용·삭제 예정이므로 `lDongRegnCd`와 법정동 코드 조회를 사용한다.

공식 문서는 시작일/종료일의 정확한 검색 경계 동작을 상세히 정의하지 않는다. 오늘을 시작일로 넣어 진행 중 행사를 누락하거나 종료일 상한 때문에 장기 행사를 누락하지 않도록 `eventStartDate=19000101`, 종료일 제한 없이 페이지를 읽고 **행사 시작 ≤ 한국 날짜 오늘+30일 AND 행사 종료 ≥ 한국 날짜 오늘**로 필터링한다. 과거 1900년 이전에 시작한 행사는 조회 범위 밖이다. 실제 응답 916건에서 진행 중 89건을 포함하는 30일 대상 251건을 확인했다.

페이지당 1,000건을 요청하되 서버가 더 적게 반환하면 페이지를 계속 읽는다. 각 기능 최대 20페이지, 전체 최대 40회 외부 요청으로 Workers Free의 호출당 50개 외부 subrequest 제한 안에서 실패하도록 설계했다. 전체 개수 변동·중복 ID·잘못된 응답·빈 수집 결과는 불완전한 스냅샷으로 간주해 현재 데이터를 대체하지 않는다. 실제 916건 조회와 251건 저장이 원격 개발 세션에서 약 2초 이내 완료됐으며 D1 batch 저장에 성공했다.

## D1 필드 비교와 매핑

| TourAPI 필드                     | 기존 D1 필드 / 처리                                                             |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `contentid`, `contenttypeid=15`  | `events.id=tourapi-{contentid}`                                                 |
| `title`                          | `title`, 원문 그대로                                                            |
| `eventstartdate`, `eventenddate` | `start_date`, `end_date`, 실제 존재하는 날짜만 YYYY-MM-DD 변환                  |
| `lDongRegnCd`                    | `ldongCode2`의 코드·이름을 공식 응답의 지역명을 서비스 표시명으로 변환          |
| `addr1`, `addr2`                 | `address`, `venue`에 제공 주소 그대로; 행사장 명칭이라고 추측하지 않음          |
| `mapx`, `mapy`                   | `lng`, `lat`; 누락·범위 오류·0/0이면 둘 다 NULL                                 |
| `progresstype`                   | 명시적 취소/연기는 해당 상태, 미제공/선택안함은 `unknown`, 미검증 상태값은 제외 |
| 목록에 요금 필드 없음            | `cost=unknown`, `price_text=NULL`                                               |
| 목록에 동행 조건·주제 근거 없음  | `pet_policy=unknown`, 태그 입력 안 함                                           |
| API 응답 원문                    | `sources.raw_payload`, 인증키 포함 요청 URL은 저장하지 않음                     |
| 수집 시각                        | `checked_at`, `sources.fetched_at`, 필드별 `event_evidence`                     |

공식 매뉴얼 예제의 `progresstype=선택안함`은 개최 예정이나 취소되지 않았다는 근거가 아니다. TourAPI 출처의 `unknown` 행사는 출처 등록 정보로 표시하면서 카드·상세에 **취소 여부 미확인 / 출발 전 공식 공지 확인**을 안내한다. 취소·연기 표시는 목록에서 제외한다. 다른 출처에 대한 기존 근거 요구는 유지한다.

`verified`는 제공된 일정·주소 등의 응답 확인을 뜻하며 실시간 개최 보장은 아니다. 요금·동행·카테고리 필터는 근거가 없으면 결과 0건을 반환하는 것이 정상이다. 제목에 ‘무료’, ‘꽃’, ‘가족’이 있어도 분류하지 않는다. 주소·날짜·지역 코드가 누락되거나 유효하지 않으면 해당 레코드는 제외하고 제외 건수를 기록한다.

소스는 TourAPI 우선순위 3으로 저장한다. 기존 행사 ID가 주최기관 등 다른 주 출처를 사용하면 덮어쓰지 않는다. 한 D1 batch 트랜잭션으로 저장·갱신·근거 기록·누락된 이전 TourAPI 데이터 stale 처리를 수행한다. 일정·주소·상태 변경 이력을 남기며 재실행해도 행사 ID가 중복되지 않는다. 기존 샘플 13건은 복구용 SQL·JSON으로 백업한 뒤 로컬·원격 D1에서 삭제했다. 운영 D1에는 실제 251건만 남는다.

## 인증키 등록: 사용자 수행 필요

공공데이터포털의 위 서비스 활용신청이 승인된 키가 필요하다. [Cloudflare Secrets 공식 문서](https://developers.cloudflare.com/workers/configuration/secrets/)에 따라 기존 Worker에만 저장한다.

```bash
npx wrangler secret put TOUR_API_KEY --config wrangler.production.jsonc
```

입력 프롬프트에 **Decoding 인증키**를 붙여 넣는다. 요청에서 URLSearchParams로 한 번 인코딩한다. 키를 채팅, `.dev.vars`, `.env`, `VITE_*`, 소스, SQL, Git에 넣지 않는다. `secret put`은 기존 Worker의 새 버전을 배포하지만 수집을 켜거나 새 리소스를 만들지는 않는다. 완료 후 Secret 목록의 이름만 확인한다.

## 실제 수집·검증·배포 절차

아래 단계로 인증키 등록 후 실제 수집·원격 저장·로컬 및 공개 배포 검증을 수행했다.

1. `npm run tourapi:sync`: Cloudflare 로그인으로 기존 Worker의 원격 개발 세션을 만든 뒤 원격 개발용 scheduled 트리거를 실행한다. 기존 원격 D1에 수집 결과를 저장하며 공개 배포 설정은 바꾸지 않는다. Secret은 Cloudflare에서 유지하며 로컬로 가져오지 않는다. `sync_runs` 성공 여부를 확인한다. 원격 세션에서 Secret 상속이 확인되지 않으면 중단한다.
2. `npm run db:real:snapshot`: 기존 원격 D1의 TourAPI 행사·출처·근거만 기존 로컬 D1에 복사한다. Secret이 없는 응답 스냅샷은 Git에서 제외된 `.wrangler/deployment`에 보관한다. 원격 DB는 조회만 한다.
3. 기존 로컬 개발 서버를 종료한 뒤 `npm run dev:real`: 같은 로컬 DB와 Static Assets를 production 조회 모드로 실행한다. 외부 수집은 비활성이며 키가 필요 없다.
4. `npm run test:ui:real`: 실제 D1 스냅샷과 독립적으로 계산한 한국 날짜를 기준으로 데스크톱·모바일, 3개 기간, 전체 지역, 미확인 필터, 상세, 오류·레이아웃을 확인한다.
5. `npm run deploy`: Secret과 최근 원격 실제 데이터가 없으면 중단한다. 검사를 통과한 코드를 기존 Worker/Assets에 배포한다. production 설정은 TourAPI Cron 수집을 활성화한다. Cron은 하루 1회 `0 1 * * *`(매일 10:00 KST)이며 DB·URL은 유지한다.
6. 빌드 후 자산 404가 발생하지 않도록 로컬 서버를 재시작한다. `TEST_BASE_URL=https://galteum.com TEST_OUTPUT_DIR=test-results/real-deployed npm run test:ui:real`로 공개 URL을 검사한다.
7. `npm run verify:real`: 로컬과 공개 API의 기간·지역·요금·동행·주제·거리·페이지·상세 결과를 비교한다. 로컬은 수집 비활성, 공개는 수집 활성인 health 차이는 의도된 설정이다.
8. Cron 자연 실행 후 `sync_runs` 성공·실제 필드·갱신 시각을 확인한다. 이번 작업에서 공개 쓰기 API, AI 분류, 변경 감시, 알림, 새 카테고리는 추가하지 않는다.

Cloudflare 로그인·명령 실행 승인이 필요하면 해당 단계에서 중단하고 정상 인증 절차를 사용한다. Workers CPU/D1 한도 실패가 발생하면 실제 응답량을 기준으로 조정하고, 요금제 변경은 임의로 하지 않는다.

## 실제 응답과 지역 코드 확인

실제 `ldongCode2`는 **전남광주통합특별시(code=12)**를 제공한다. 이를 `전남광주` 표시명으로 추가했으며 이전 광주/전남 코드를 임의로 추측하거나 통합 코드의 행사를 둘 중 하나로 나누지 않는다. 기존 광주/전남 필터 값은 이전 데이터 호환용으로 유지하므로 현재 원격 실제 데이터에서는 빈 결과가 정상이다. 세종 공식 응답은 `code=36110`이고 실제 행사 2건이 해당 지역 필터에 매칭된다. 코드·지역명은 실제 공식 API 응답으로 확인했다.

현재 목록은 `progresstype=선택안함` 220건, 미제공 31건이다. 251건 모두 개최·취소 여부를 `unknown`으로 유지하며 화면에 안내한다. 공식 목록에는 요금·동행·주제 근거가 없어 해당 필터를 임의로 채우지 않았다.

Cloudflare 원격 fetch의 `redirect:error`는 실제 실행에서 TypeError가 발생해 `manual`로 바꿨다. 3xx를 따라가지 않고 실패 처리하므로 인증키를 다른 주소로 전달하지 않는다. 원격 개발 트리거는 Static Assets보다 `/__scheduled`를 먼저 Worker로 전달하도록 개발 세션 설정에만 추가했다. 공개 배포에는 쓰기 경로를 추가하지 않았다.

## 검증 기록

수집 거절 항목의 원문·사유·시각·동기화 ID 보관 구조와 운영 조회는 [TOURAPI_REJECTIONS.md](TOURAPI_REJECTIONS.md)에 기록했다. 이전에 저장하지 못한 거절 원문을 복원한 것이 아니라 이후 실행부터 기록한다.

251건 저장과 API 234회 검증의 단위 차이, 전체 상세 조회와 기간별 제외 행사 128건의 건별 분류는 [DATA_AUDIT.md](DATA_AUDIT.md)에 기록했다. 234는 행사 수가 아니므로 누락 17건이라는 차집합은 존재하지 않는다.

- 기존 workerd/D1 테스트와 날짜·매핑·입력 단위 테스트 8개 통과.
- 실제 응답 916건 조회, 날짜·주소·지역 등 필수 정보가 유효한 30일 대상 251건 저장. 유효성 검사 제외 1건.
- 실제 행사명·ID·일정·주소·좌표를 원문 251건 전체와 대조. 진행 중 행사 89건 포함.
- 원격·로컬 D1: 실제 행사 251건, 샘플 0건. 출처 251건, 필드 근거 1,004건. 원격 외래키 오류 0건.
- 첫 실제 데이터 조회 결과(한국 날짜 2026-09-19): 오늘 116건, 이번 주말 117건, 다음 주말 66건.
- 로컬 및 공개 실제 데이터 브라우저 테스트: 각 12개 통과(데스크톱·모바일). 수집 날짜 카드 표시도 한국 시간으로 통일했다.
- 로컬·공개 API 필터/페이지/상세 234개 대조, 표시 기간의 고유 행사 123건 대조. HTML·JS·CSS 일치.
- Secret은 기존 Worker에 등록. 로컬 키 파일·프론트엔드 키·Git 인증키 없음.
- Cron `0 21 * * *` 유지. 실제 수집 함수는 원격 개발용 scheduled 실행으로 검증했으며 다음 자연 Cron 실행을 이미 관찰했다고 주장하지 않는다.
- 실행 아티팩트: `test-results/real/browser-report.json`, `test-results/real-deployed/browser-report.json`, `test-results/real/parity.json`, 공개 화면 PNG. Git에서 제외한다.
- 샘플 복구용 백업: `.wrangler/deployment/retired-samples-local.{sql,json}`, `retired-samples-remote.{sql,json}`. 현재 실제 서비스에 샘플 복구/샘플 배포 명령을 실행하지 않는다.
