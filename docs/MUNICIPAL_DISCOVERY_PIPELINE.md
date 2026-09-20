# 지자체 행사 Discovery Pipeline — Phase 10A

## 목적과 범위

이 도구는 TourAPI를 대체하지 않는다. 파주시·수원시·고양시·화성시의 **공식 목록**에서 소수의 행사 후보를 발견하고, 사람이 다음 등록 단계를 검토할 수 있도록 정리하는 dry-run이다. production DB에는 어떤 `INSERT`, `UPDATE`, `DELETE`도 실행하지 않는다.

## 지원 source와 흐름

- 파주시: `tour.paju.go.kr` 이달의 문화행사 목록과 후보별 공식 상세
- 수원시: `swcf.or.kr` 수원문화재단 행사정보 목록과 후보별 공식 상세
- 고양시: `goyang.go.kr/visitgoyang` 대표축제 목록. 2026년처럼 연도가 명시된 기간과 후보별 공식 링크만 수집하며, 매년 반복 안내는 추측하지 않는다.
- 화성시: `tour.hscity.go.kr` 2026년 주요 축제·행사 일정. 시 공식 표 자체가 후보의 canonical detail source이며, 개별 상세 페이지가 없는 행사는 표에 명시된 값만 후보화한다.

1. 지역별 목록을 한 번 가져와 최소 필드(제목, 날짜, 장소, 공식 URL, category/snippet)를 parser로 추출한다.
2. deterministic Selection Gate로 `MAIN`, `NEARBY_ONLY`, `EXCLUDE`, `REVIEW`를 부여한다. 교육·모집·워크숍·시설 편성은 EXCLUDE, 축제·페스티벌·야행 등은 MAIN, 애매하면 REVIEW다.
3. Phase 9B의 indexed exact-title lookup과 지역·기간 겹침 최대 25건 lookup을 사용한다. `DUPLICATE`, `LIKELY_DUPLICATE`, `REVIEW`는 후보를 등록 가능 상태로 만들지 않는다.
4. `MAIN/NEARBY_ONLY + NEW`만 공식 상세를 최대 10건 fetch해 enrichment 후보를 만든다. EXCLUDE에는 detail request를 하지 않는다.
5. title/date/venue/official URL이 있고 duplicate가 NEW인 후보만 `ready_for_review: true`가 된다. 이는 production 승인이나 등록을 뜻하지 않는다.

## Enrichment와 이미지

detail parser는 공식 page의 명시적 행사 운영시간만 `operating_hours` 후보로 남긴다. 프로그램 시간은 운영시간으로 승격하지 않는다. summary, 프로그램 텍스트도 공식 detail에 있는 범위만 후보화한다.

이미지는 선택 사항이다. 공식 목록/상세에서 명확히 확인된 대표 이미지 URL만 `image_candidate`로 기록하며, 없으면 `null`이다. 이 단계에서는 hotlink, 복사, production 저장을 하지 않는다.

## 실행

```bash
npm run municipal:discover
```

기본값은 dry-run이며 결과는 git-ignored `.wrangler/municipal-discovery-dry-run.json`에 저장된다. 공식 요청 상한은 목록 4건과 상세 최대 10건(총 20건 이하)이다. parser 테스트는 `fixtures/municipal-discovery-*.html`만 사용한다.

## 제한과 다음 단계

## Human approval flow (Phase 10B-1)

`npm run municipal:review`는 현재 manifest에서 `MAIN + NEW + ready_for_review`만 번호·candidate ID·날짜·장소·공식 source·핵심 정보·이미지 후보와 함께 출력한다. `NEARBY_ONLY`, EXCLUDE, REVIEW, DUPLICATE는 승인 목록에 없다.

`npm run municipal:apply -- --approve <candidate-id> --manifest <fingerprint>`는 fingerprint가 현재 manifest와 같고, 명시적 ID가 최대 3개이며, 각 후보가 아직 MAIN/NEW/ready인 경우에만 현재 D1 duplicate 검사를 다시 수행한다. approve 누락, `all`류 값, stale manifest, unknown ID, 새 duplicate는 모두 write 전에 실패한다. Phase 10B-1에서는 production writer 자체가 disabled이며 다음 사람 승인 후에도 등록은 Phase 10B-2 범위다.

두 source adapter는 현재 HTML 구조에 한정된다. 필수 필드나 title identity가 불완전하면 REVIEW/PARSE_ERROR로 두며 추측하지 않는다. source가 목록에서 동일 행사를 중복 게재하면 source-level로 한 번만 남긴다. Cron, apply mode, production write는 Phase 10A 범위 밖이다.
