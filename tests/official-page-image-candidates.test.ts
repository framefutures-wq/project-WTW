import assert from "node:assert/strict";
import test from "node:test";
import {
  extractOfficialPageImageCandidates,
  extractRawPayloadImageCandidates,
} from "../shared/official-page-image-candidates";

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