# Analytics 운영 준비

Phase 14A의 분석은 서비스 개선에 필요한 최소 행동만 수집한다. GA4와
Cloudflare Web Analytics는 선택적으로 client-side에서 best-effort 초기화하며,
분석 장애가 앱/API를 막지 않는다. 이 단계에서는 광고, remarketing, User-ID,
자체 analytics DB, D1 migration을 사용하지 않는다.

## 설정

`GET /api/analytics/config`가 공개 client 설정을 반환한다. Worker 환경변수는
`ANALYTICS_ENABLED=true`, `GA4_MEASUREMENT_ID=G-...`,
`CLOUDFLARE_WEB_ANALYTICS_TOKEN=...`이다. production mode에서만 활성화되며,
값이 없거나 형식이 유효하지 않으면 해당 provider만 disabled다.

GA4 Measurement ID와 Cloudflare site token은 client에 공개되는 값이다. 현재
repository와 production vars에는 실제 외부 ID/token이 없으므로 기본값은 disabled다.
TourAPI key와 VAPID private key는 이 endpoint나 client bundle에 절대 포함하지 않는다.

설정할 때는 실제 값을 production vars에만 등록하고 `npm run check` 후
`/api/analytics/config`에서 상태를 확인한다. 끌 때는
`ANALYTICS_ENABLED=false`로 되돌린다. local, sample, automated test 환경은
production mode가 아니므로 provider network 요청을 하지 않는다.

## GA4 Admin checklist

1. Google Analytics에서 property와 Web data stream을 만든다.
2. Measurement ID(`G-...`)를 확인해 production 설정에 등록한다.
3. 앱은 enabled일 때만 `gtag.js`를 동적으로 한 번 로드한다.
4. `send_page_view: false`로 두고 SPA pageview를 앱에서 명시적으로 보낸다.

Google Ads 연결, remarketing, personalized advertising, User-ID는 사용하지 않는다.
검색 원문과 정확한 위치를 custom dimension/event parameter로 등록하지 않는다.

## Cloudflare Web Analytics

Cloudflare Dashboard에서 Web Analytics site를 만들고 site token을 확인한다.
enabled일 때 공식 `https://static.cloudflareinsights.com/beacon.min.js` snippet을
한 번 로드하며 `spa: false`로 자동 SPA navigation과 앱 pageview 중복을 막는다.

## Search Console 준비

향후 URL-prefix property로 다음 주소를 등록한다.

`https://weekend-mwohae.framefutures.workers.dev/`

사용자 작업은 Search Console에서 property를 생성한 뒤, production GA4 tag가
활성화되어 같은 Google 계정에 연결된 경우 Analytics verification을 선택하는
것이다. 그렇지 않으면 Search Console이 제공하는 HTML meta tag 또는 HTML file
verification을 선택한다. property 생성과 verification은 Google 계정 권한이
필요하므로 Codex가 대신 실행하지 않는다.

Search Console API, sitemap, robots.txt, canonical, structured data는 이번 Phase에
구현하지 않는다.

## 추적 이벤트

- `page_view`: 최초 진입, 성공한 행사 상세, 상세에서 목록 복귀.
- `event_detail_view`: 허용된 `event_id`, `source_kind`, `period`.
- `filter_apply`: `period`, `region`, `audience`, `theme`, `sort`의 known value.
- `search_submit`: 검색어 원문 없이 길이 bucket(`1-5`, `6-10`, `11+`)과 결과 수
  bucket(`0`, `1-5`, `6-20`, `21+`).
- `official_link_click`: `event_id`, 제한된 `source_kind`.
- `nearby_use`: `granted`, `denied`, `error` 중 permission result.
- `push_subscribe`, `push_unsubscribe`: region/audience/theme 선택 여부 boolean.
- `load_more`: page bucket.

pageview가 아닌 동작은 필터 변경, 검색, 더보기다. 공유 기능은 이번 Phase에
추가하지 않는다.

## Privacy rule

Analytics payload에는 latitude, longitude, GPS, raw search query, 전체 query string,
전화번호, 이메일, 이름, IP custom field, push endpoint/p256dh/auth, VAPID key,
request/response body, raw source/API payload, error stack, request ID를 넣지 않는다.
`buildAnalyticsPath`는 `period`, `region`, `audience`, `theme`, `sort`, `event`만
허용하고 `q`, lat/lng, unknown query를 제거한다. 주소 표시줄의 검색어와 unknown
query도 초기 렌더에서 제거하여 provider beacon에 포함되지 않게 한다. User-ID와 fingerprinting은 사용하지
않는다. 현재는 분석 목적이며 광고/remarketing용 cookie consent 흐름은 만들지 않는다.

사이트 안내 UI는 provider가 disabled면 비활성 상태를 표시하고, enabled면 사용
중인 분석 도구와 전송하지 않는 민감 데이터를 안내한다. 이는 법률 준수 완료를
의미하지 않으며 광고·개인화 광고 도입 전 별도 privacy/consent review가 필요하다.

## 검증

배포 후 `/api/health`, `/api/events`, `/api/push/config`,
`/api/analytics/config`가 200인지 확인한다. disabled 상태에서는 GA script와
Cloudflare beacon external request가 0이어야 한다. enabled 상태에서는 각각 한
번만 존재해야 하며, 실제 property에 fake event를 대량 발생시키지 않는다.
