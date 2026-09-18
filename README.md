# 주말뭐해?

오늘 / 이번 주말 / 다음 주말의 한국 축제·지역행사를 찾는 서비스의 첫 실행 단계입니다. **현재 모든 행사 데이터는 가상 샘플**이며 실제 방문 정보로 사용할 수 없습니다. TourAPI 키를 넣지 않았고 외부 행사 수집은 비활성입니다.

스택: Cloudflare Workers, Static Assets, D1, Cron Triggers, Cloudflare Secrets, TypeScript, React. [구조 설계](docs/ARCHITECTURE.md).

## 로컬 실행

Node.js 22.12 이상(현재 검증 환경: 24), npm을 사용합니다.

```bash
npm ci
npm run setup
npm run dev
```

http://localhost:8787 에서 React와 Worker API가 같은 도메인으로 동작합니다. `setup`은 로컬 D1 마이그레이션과 실행일 기준 샘플 생성만 수행합니다. 샘플 날짜가 오래되면 다시 `npm run db:seed` 하세요. 시드는 샘플 행사만 교체하며 실제 데이터와 Cron 이력은 보존합니다.

UI 수정 시 자동 갱신을 원하면 Wrangler를 실행한 상태에서 별도 터미널에서 `npm run dev:ui`를 실행하고 http://localhost:5173 에 접속합니다. `/api`는 8787 Worker로 프록시됩니다. 8787의 Static Assets는 `npm run build` 후 갱신됩니다.

```bash
npm run check
npm run test:smoke  # 8787 로컬 서버 실행 중
npx playwright install --with-deps chromium  # 최초 브라우저 검증 준비
npm run test:ui     # 8787 로컬 서버 실행 중, 데스크톱·모바일 검증
curl 'http://localhost:8787/api/events?period=weekend&region=%EC%84%9C%EC%9A%B8&cost=free'
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

`.dev.vars.example`과 `worker/env.ts`에 `TOUR_API_KEY` 자리를 준비했습니다. 지금은 값을 입력하지 않습니다. 실제 키 도입 시 `.dev.vars`(git 제외)에 로컬 값을 넣고 운영에는 다음을 사용합니다.

```bash
npx wrangler secret put TOUR_API_KEY --config wrangler.production.jsonc
```

키를 `VITE_*`, 코드, SQL, Git에 넣지 마세요. `TOUR_API_ENABLED=false`가 기본이며 실제 수집 어댑터는 아직 구현 전입니다. 키와 설정만 바꿔도 수집을 시작하지 않도록 되어 있습니다.

## 운영 전환

로컬 `wrangler.jsonc`와 운영 `wrangler.production.jsonc`를 분리했습니다. **운영 배포는 이번 단계에서 수행하지 않습니다.**

1. `npx wrangler login`으로 계정을 연결합니다.
2. `npx wrangler d1 create weekend-mwohae-production`으로 운영 DB를 생성합니다.
3. 반환된 ID를 `wrangler.production.jsonc`의 `database_id`에 입력합니다.
4. `npx wrangler d1 migrations apply weekend-mwohae-production --remote --config wrangler.production.jsonc`로 스키마를 적용합니다. 샘플 시드는 운영에 적용하지 않습니다.
5. 공식 데이터 수집·검증·게시 절차를 구현하고 검토합니다. 현재 운영 모드는 확인된 실제 데이터가 없으면 빈 목록을 반환합니다.
6. `npm run deploy`를 실행합니다. 실제 D1 ID 없이는 배포를 차단하며 타입 검사·테스트·빌드를 먼저 수행합니다.

운영 Cron은 매일 06:00 한국 시간입니다. 지금은 오래된 근거 처리와 실행 이력만 동작합니다. 공식 데이터 동기화는 `sync_runs.status=skipped`로 기록하고, 오류는 `failed`로 기록합니다. 운영 전환 시 도메인, 로그 경보, 데이터 수집 실패 알림, D1 복구 절차를 별도 설정해야 합니다.

## 디렉터리

```text
src/                       React 화면과 스타일
shared/domain.ts           타입, 필터 항목, 한국 날짜, 거리 계산
worker/                    읽기 전용 API, Cron, Secret 타입, 수집 어댑터 자리
migrations/                D1 스키마
scripts/                   로컬 시드, 통합 smoke 검사, 운영 배포 가드
tests/                     한국 날짜 경계, 필터 검증, 거리, 브라우저 검사
docs/ARCHITECTURE.md        전체 구조와 정확성 정책
wrangler.jsonc             샘플 로컬 환경
wrangler.production.jsonc  운영 환경
```

Cloudflare 공식 참고: [Static Assets](https://developers.cloudflare.com/workers/static-assets/), [D1 로컬 개발](https://developers.cloudflare.com/d1/build-with-d1/local-development/), [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
