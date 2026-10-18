import assert from "node:assert/strict";
import test from "node:test";
import {
  extractOfficialPageImageCandidates,
  extractRawPayloadImageCandidates,
  looksDecorative,
} from "../shared/official-page-image-candidates";

test("site license badges and weather chrome are excluded without rejecting event posters", () => {
  const bad = [
    "https://tour.example.org/resources/user/common/images/new_img_opentype00.png",
    "https://city.example.org/design/tour2026/img/common/wtr-snowy.png",
    "https://city.example.org/design/tour/img/common/weather-cloudy.png",
    "https://city.example.org/images/footer/copyright.jpg",
    "https://city.example.org/images/icons/cloud.png",
    "https://city.example.org/images/kogl_type1.png",
  ];
  for (const url of bad) assert.equal(looksDecorative(url), true, url);
  const good = [
    "https://city.example.org/upload/cloud-festival-poster.jpg",
    "https://city.example.org/upload/event-banner.jpg",
    "https://city.example.org/upload/ckuploads/2026/opaque.jpg",
    "https://city.example.org/comm/getImage?upperNo=10934&fileNo=1",
  ];
  for (const url of good) assert.equal(looksDecorative(url), false, url);
  const html = [...bad, ...good].map(url => `<img src="${url}" alt="">`).join("");
  assert.deepEqual(extractOfficialPageImageCandidates("https://city.example.org/event", html).map(x => x.url), good);
  assert.equal(extractRawPayloadImageCandidates({ images: bad }).length, 0);
  assert.equal(looksDecorative(good[2], "홈페이지 배너"), true);
  assert.equal(looksDecorative("not a URL"), true);
});

test("prefers page metadata and keeps portrait poster URLs", () => {
  const html = `
    <meta property="og:image" content="/poster/main.jpg">
    <meta name="twitter:image" content="https://cdn.example.org/poster/twitter.png">
    <img src="/assets/logo.png" alt="기관 로고">
    <img src="/images/program.jpg" alt="행사 프로그램 포스터">
  `;
  assert.deepEqual(
    extractOfficialPageImageCandidates("https://festival.example.org/event/1", html),
    [
      {
        url: "https://festival.example.org/poster/main.jpg",
        signal: "OG_IMAGE",
        alt: null,
      },
      {
        url: "https://cdn.example.org/poster/twitter.png",
        signal: "TWITTER_IMAGE",
        alt: null,
      },
      {
        url: "https://festival.example.org/images/program.jpg",
        signal: "IMG",
        alt: "행사 프로그램 포스터",
      },
    ],
  );
});

test("extracts JSON-LD image values and deduplicates URLs", () => {
  const html = `
    <script type="application/ld+json">
      {"@type":"Event","image":["https://img.example.org/poster.webp"],
       "subject":{"thumbnailUrl":"https://img.example.org/thumb.jpg"}}
    </script>
    <img src="https://img.example.org/poster.webp" alt="same">
  `;
  const result = extractOfficialPageImageCandidates("https://example.org/event", html);
  assert.deepEqual(result.map((item) => item.url), [
    "https://img.example.org/poster.webp",
    "https://img.example.org/thumb.jpg",
  ]);
});

test("raw payload audit finds firstimage and poster-like values only", () => {
  const payload = {
    firstimage: "https://img.example.org/a.jpg",
    nested: {
      poster_url: "https://img.example.org/poster.png",
      homepage: "https://festival.example.org/",
      icon: "https://img.example.org/icon.png",
    },
  };
  assert.deepEqual(extractRawPayloadImageCandidates(payload), [
    { url: "https://img.example.org/a.jpg", path: "raw.firstimage" },
    { url: "https://img.example.org/poster.png", path: "raw.nested.poster_url" },
  ]);
});

test("rejects non-HTTPS and decorative image candidates", () => {
  const html = `
    <meta property="og:image" content="http://example.org/poster.jpg">
    <img src="https://example.org/assets/favicon.png">
    <img src="https://example.org/assets/event.jpg">
  `;
  const result = extractOfficialPageImageCandidates("https://example.org/event", html);
  assert.deepEqual(result, [
    { url: "https://example.org/assets/event.jpg", signal: "IMG", alt: null },
  ]);
});

test("extracts explicit poster image attachments from exact official pages", () => {
  const html = `
    <a href="/upload/2026-food-festa-poster.jpg">
      2026 동오마을 푸드페스타 포스터.jpg
    </a>
    <a href="/upload/site-banner.jpg">홈페이지 배너</a>
  `;
  assert.deepEqual(
    extractOfficialPageImageCandidates(
      "https://ui4u.go.kr/portal/eventNoti/view.do?idx=2016",
      html,
    ),
    [
      {
        url: "https://ui4u.go.kr/upload/2026-food-festa-poster.jpg",
        signal: "ATTACHMENT_IMAGE",
        alt: "2026 동오마을 푸드페스타 포스터.jpg",
      },
    ],
  );
});


test("rejects common site chrome and default placeholder images", () => {
  const html = `
    <meta property="og:image" content="/inc/img/common/swcf_img.jpg">
    <img src="/resources/zeroCMS/site/www/images/default_img.jpg">
    <img src="/inc/img/common/all_menu_show.gif" alt="전체메뉴">
    <img src="/uploads/current-event-poster.jpg" alt="행사 포스터">
  `;
  assert.deepEqual(
    extractOfficialPageImageCandidates("https://example.org/event", html),
    [
      {
        url: "https://example.org/uploads/current-event-poster.jpg",
        signal: "IMG",
        alt: "행사 포스터",
      },
    ],
  );
});


test("rejects official-site chrome logos by filename and accessibility alt", () => {
  const html = `
    <img src="/images/fvu/common/btm_logo01.png" alt="공공누리">
    <img src="/site/www/images/common/flag.jpg" alt="태극기">
    <img src="/comm/getImage?upperNo=10934&fileNo=1" alt="">
  `;
  assert.deepEqual(
    extractOfficialPageImageCandidates("https://example.org/event", html),
    [
      {
        url: "https://example.org/comm/getImage?upperNo=10934&fileNo=1",
        signal: "IMG",
        alt: null,
      },
    ],
  );
});
