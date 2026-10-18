# Source Registry 후보 v1

이 분석은 현재 TourAPI 행사 snapshot과 저장된 TourAPI raw/detail의 명시 필드를 사용해 향후 공식 source inspection 후보를 만드는 작업이다. organizer, venue, official domain은 서로 다른 축이며, 제목·주소만으로 운영기관을 추정하지 않는다.

`npm run source-registry:candidates`는 Wrangler JSON snapshot을 stdin으로 받아 `.wrangler/source-registry-candidates.json`을 만든다. 결과는 registry 등록, D1 write, migration, Cron, public API/Worker 변경을 수행하지 않는다.

입력은 `events`의 식별·기간·장소 필드와 연결된 TourAPI `sources.raw_payload`다. raw payload에서는 `eventplace`, `sponsor1`, `sponsor1tel`의 존재 여부, `homepage`만 추출하며 raw payload나 전화번호는 report에 보존하지 않는다. 원격에서는 집계 없이 한 번의 bounded query만 실행하고, 이후 정규화·집계는 local에서 수행한다.

priority는 현재 snapshot에서의 행사 수, seed 포함 여부, 명시 `sponsor1`, `eventplace`, homepage domain만으로 계산한다. 이는 현재 snapshot의 후보 우선순위이며 연간 생산성이나 자동수집 난이도를 의미하지 않는다. 공식 domain이 없으면 `needs_source_inspection`으로 남긴다.

`shared/private-official-sources.ts`의 실제 registry는 변경하지 않는다. 이 report는 adapter 등록·D1 write·migration·Cron·public API/Worker 변경을 수행하지 않는다.

## 현재 production snapshot 결과 (2026-09-20)

단일 bounded query로 현재 TourAPI event 263건을 분석했다. 현재 저장된 raw payload에는 Source Registry 판단에 필요한 `sponsor1`, `eventplace`, `homepage`가 각각 0건이었다. 따라서 주소 또는 행사명으로 운영기관을 추정하지 않았으며, source registry 후보를 인위적으로 늘리지 않았다.

| 후보 | 분류 | 소유 | snapshot 행사 수 | 명시 organizer / venue / official domain | seed | 우선순위 | 근거 |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| DDP | cultural_space | public | 1 | 없음 | 예 | medium | 행사명 안전 alias 일치 |
| 제주신화월드 | resort | private | 1 | 없음 | 예 | medium | 행사명 안전 alias 일치 |

나머지 42개 seed는 현재 263건에서 안전하게 식별되지 않았다. 명시 metadata가 없어 seed 밖의 신규 후보, source family 후보, 반복 organizer/venue/domain 후보는 생성하지 않았다. 이는 현 데이터가 Source Registry를 자동 확장하기에는 부족하다는 검증 결과다.

로컬 상세 결과는 git-ignored [`.wrangler/source-registry-candidates.json`](../.wrangler/source-registry-candidates.json)에 생성된다. 이 파일에는 raw payload나 전화번호 값이 포함되지 않는다.
