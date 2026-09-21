# 갈틈

관리용 프로젝트명은 **project-WTW**, 서비스 브랜드는 **갈틈**입니다. 한국관광공사 TourAPI의 실제 행사 데이터를 기존 D1에 저장하고 현재·향후 30일의 일정을 제공하도록 전환했습니다. [공식 명세·매핑·등록 및 검증 절차](docs/TOURAPI.md).

스택: Cloudflare Workers, Static Assets, D1, Cron Triggers, Cloudflare Secrets, TypeScript, React. [구조 설계](docs/ARCHITECTURE.md).

**공개 서비스:** [갈틈](https://galteum.com) · [실제 배포 및 검증 기록](docs/DEPLOYMENT.md). 공개 서비스는 `APP_MODE=production`, TourAPI Secret은 기존 Worker에 등록됐으며 로컬 파일에는 저장하지 않습니다.

## 로컬 실행

Node.js 22.12 이상(현재 검증 환경: 24), npm을 사용합니다.

```bash
npm ci
npm run db:migrate
npm run db:real:snapshot  # 기존 원격 D1의 실제 데이터 복사, Cloudflare 로그인 필요
npm run dev
```

http://localhost:8787 에서 React와 Worker API가 같은 도메인으로 동작합니다. 기본 로컬 설정은 실제 데이터 조회 모드이며 TourAPI 외부 수집은 비활성입니다. 키 없이 원격 D1의 행사·출처·근거만 복사해 검증합니다. 스냅샷이 72시간 이상 오래되면 원격 수집 결과를 다시 복사하세요.

가상 샘플 회귀 검증은 별도로 `npm run setup` 후 `npm run dev:sample`로 실행할 수 있습니다. 샘플 시드는 실제 데이터와 Cron 이력을 보존하며 production 화면에는 노출되지 않습니다. `npm run test:ui`는 기존 샘플 테스트 24개이고, 현재 실제 데이터 검증은 `npm run test:ui:real`을 사용합니다.

UI 수정 시 자동 갱신을 원하면 Wrangler를 실행한 상태에서 별도 터미널에서 `npm run dev:ui`를 실행하고 http://localhost:5173 에 접속합니다. `/api`는 8787 Worker로 프록시됩니다. 8787의 Static Assets는 `npm run build` 후 갱신됩니다.

```bash
npm run check
npm run test:smoke  # 8787 로컬 서버 실행 중
npx playwright install --with-deps chromium  # 최초 브라우저 검증 준비
npm run test:ui:real  # 실제 데이터 로컬 서버 실행 중, 데스크톱·모바일 검증
curl 'http://localhost:8787/api/events?period=weekend&region=%EC%84%9C%EC%9A%B8&cost=unknown'
curl 'http://localhost:8787/api/events?sort=distance&lat=37.5665&lng=126.978'
curl 'http://localhost:8787/cdn-cgi/local/scheduled?cron=0+21+*+*+*'
npx wrangler d1 execute weekend-mwohae --local --command "SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 5"
```

브라우저 위치 권한을 허용하면 거리순을 사용할 수 있습니다. 좌표는 DB나 브라우저 저장소에 저장하지 않습니다. API 쿼리에 좌표가 포함되므로 운영 시 접근 로그에 전체 쿼리를 남기지 않도록 관리해야 합니다. 표시하는 거리는 이동시간이 아닌 직선거리입니다.

## 정확성 규칙

- 출처 우선순위: 행사/주최기관 공식 공지 → 지자체 → TourAPI → 공공데이터포털.
- 공식 URL·최근 확인 시각·필드별 근거가 있는 검증 행사만 운영 추천에 노출합니다.
- 72시간 경과 근거는 추천에서 제외하고 정기 점검에서 `stale`로 바꿉니다.
- 일정 겹침으로 진행 중인 행사도 포함합니다. 주말은 한국 날짜 기준 토·일입니다.
- 비용/반려동물 정책이 `unknown`이면 무료/유료/반려동물 추천에 임의로 매칭하지 않습니다.
- 취소·연기 행사는 목록에서 제외합니다. 상세의 예정 상태도 실시간 개최 보장은 아닙니다.
- AI로 일정·가격·장소·취소 상태를 생성하지 않습니다.

## Secret 자리

인증키는 기존 Worker의 Cloudflare Secret으로만 관리합니다. 로컬 파일과 프론트엔드에는 저장하지 않습니다.

```bash
npx wrangler secret put TOUR_API_KEY --config wrangler.production.jsonc
```

프롬프트에 승인된 **Decoding 키**를 입력합니다. 현재 기존 Worker에 등록되어 있습니다. production 설정은 Secret을 필수로 선언하며 키·최근 원격 실제 데이터가 없으면 운영 배포를 중단합니다.

## 실제 데이터 전환

기존 Worker·D1·Cron·공개 URL을 사용합니다. 새 리소스 생성이나 스키마 마이그레이션은 필요하지 않습니다. [TourAPI 전환 절차](docs/TOURAPI.md)에 따라 원격 수집 → 기존 로컬 D1에 실제 응답 복사 → 기간·지역 필터 검증 → 기존 Worker 배포 → 공개 URL·로컬 결과 대조를 수행합니다. 기존 샘플은 production 모드에서 조회하지 않습니다.

Cron은 매일 06:00 한국 시간에 오래된 근거 처리와 TourAPI 수집을 수행하고 `sync_runs`에 성공/비활성/실패를 남깁니다. 현재 공개 운영 설정은 수집 활성이고, 샘플용 배포 설정만 수집 비활성입니다. TourAPI의 미제공 요금·동행 조건은 미확인으로 유지합니다. 취소 상태가 미제공이면 화면에서 개최·취소 여부 미확인을 안내합니다.

## 디렉터리

```text
src/                       React 화면과 스타일
shared/domain.ts           타입, 필터 항목, 한국 날짜, 거리 계산
worker/                    읽기 전용 API, Cron, Secret 타입, TourAPI 수집 어댑터
migrations/                D1 스키마
scripts/                   로컬 시드, 통합 smoke 검사, 운영 배포 가드
tests/                     한국 날짜 경계, 필터 검증, 거리, 브라우저 검사
docs/ARCHITECTURE.md        전체 구조와 정확성 정책
wrangler.jsonc             실제 데이터 로컬 조회 환경
wrangler.production.jsonc  운영 환경
```

Cloudflare 공식 참고: [Static Assets](https://developers.cloudflare.com/workers/static-assets/), [D1 로컬 개발](https://developers.cloudflare.com/d1/build-with-d1/local-development/), [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

## 과거 샘플 배포 절차(현재 실제 서비스에 사용하지 않음)

과거 공개 샘플도 실제 Workers·Static Assets·원격 D1을 사용했습니다. 화면의 가상 데이터 안내를 유지하고 TourAPI 수집은 비활성입니다. Cloudflare 계정 ID와 D1 ID는 인증용 Secret이 아니며 설정에 저장합니다.

```bash
npx wrangler login --device --browser=false
npm run db:snapshot
npx wrangler d1 migrations apply weekend-mwohae-production --remote --config wrangler.sample.jsonc
npm run db:seed:remote
npm run deploy:sample
npm run verify:deployment -- https://실제-배포-주소.workers.dev
```

`db:snapshot`은 현재 로컬 D1의 샘플 행사·출처·태그만 SQL로 저장합니다. `db:seed:remote`는 원격 DB가 비어 있을 때만 가져오며 기존 행사가 있으면 중단합니다. 날짜와 확인 시각까지 복제하므로 로컬과 배포 응답을 그대로 비교할 수 있습니다. 이 스냅샷은 `.wrangler/deployment`에 저장하고 Git에는 포함하지 않습니다.

`verify:deployment`는 로컬 서버(8787)를 실행한 상태에서 사용합니다. 필터·페이지·상세 API와 HTML·JS·CSS를 대조하고 배포 주소에서 HTTP 검사와 Chromium 테스트 24개를 실행합니다. 배포 검증은 `test-results/deployed`에 따로 저장합니다. 원격에서는 로컬 전용 Cron 테스트 URL을 호출하지 않습니다. Cron은 배포 설정과 실행 로그로 확인합니다.

원격 DB가 이미 준비된 다음 샘플 배포에서는 `deploy:sample`을 사용합니다. 기존 DB에 시드 스크립트를 반복 실행해 데이터를 덮어쓰지 마세요. 실제 데이터로 전환할 때는 `APP_MODE=production`으로 배포하며 샘플은 추천에서 제외됩니다.
