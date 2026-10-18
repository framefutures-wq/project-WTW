import test from "node:test";
import assert from "node:assert/strict";
import { imageUrl, chooseTourApiImage, tourApiImageCandidates } from "../scripts/event-image-lib.mjs";
import { readFileSync } from "node:fs";

test("official image URL filter accepts HTTPS images and rejects unsafe assets", () => {
  assert.equal(
    imageUrl("https://tong.visitkorea.or.kr/cms/resource/a.jpg"),
    "https://tong.visitkorea.or.kr/cms/resource/a.jpg",
  );
  assert.equal(imageUrl("http://example.com/a.jpg"), null);
  assert.equal(imageUrl("https://example.com/logo.png"), null);
  assert.equal(imageUrl("not a url"), null);
});

test("TourAPI candidates retain firstimage then a distinct valid firstimage2", () => {
  assert.deepEqual(tourApiImageCandidates({ firstimage: "https://example.com/first.jpg", firstimage2: "https://example.com/second.jpg" }), [{ url: "https://example.com/first.jpg", sort_order: 1 }, { url: "https://example.com/second.jpg", sort_order: 2 }]);
  assert.deepEqual(tourApiImageCandidates({ firstimage: "https://example.com/first.jpg", firstimage2: "https://example.com/first.jpg" }), [{ url: "https://example.com/first.jpg", sort_order: 1 }]);
  assert.deepEqual(tourApiImageCandidates({ firstimage: "https://example.com/first.jpg", firstimage2: "http://example.com/second.jpg" }), [{ url: "https://example.com/first.jpg", sort_order: 1 }]);
  assert.deepEqual(tourApiImageCandidates({ firstimage: "https://example.com/first.jpg", firstimage2: "https://example.com/icon.png" }), [{ url: "https://example.com/first.jpg", sort_order: 1 }]);
});

test("TourAPI firstimage has priority over firstimage2 and stored inventory", () => {
  assert.deepEqual(
    chooseTourApiImage({
      firstimage: "https://example.com/first.jpg",
      firstimage2: "https://example.com/second.jpg",
    }),
    {
      url: "https://example.com/first.jpg",
      evidence: "sources.raw_payload.firstimage/firstimage2",
    },
  );
  assert.deepEqual(
    chooseTourApiImage({}, [
      {
        url: "https://example.com/stored.jpg",
        path: "raw.firstimage",
        asset: true,
      },
    ]),
    {
      url: "https://example.com/stored.jpg",
      evidence: "official_source_audits.url_inventory_json",
    },
  );
  assert.equal(chooseTourApiImage({}, []), null);
});

test("CSP allows only the official TourAPI image host", () => {
  const headers = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
  assert.match(headers, /img-src 'self' data: https:\/\/tong\.visitkorea\.or\.kr/);
  assert.doesNotMatch(headers, /img-src \*/);
});
