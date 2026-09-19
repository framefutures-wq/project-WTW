import test from "node:test";
import assert from "node:assert/strict";
import { imageUrl, chooseTourApiImage } from "../scripts/event-image-lib.mjs";

test("official image URL filter accepts HTTPS images and rejects unsafe assets", () => {
  assert.equal(
    imageUrl("https://tong.visitkorea.or.kr/cms/resource/a.jpg"),
    "https://tong.visitkorea.or.kr/cms/resource/a.jpg",
  );
  assert.equal(imageUrl("http://example.com/a.jpg"), null);
  assert.equal(imageUrl("https://example.com/logo.png"), null);
  assert.equal(imageUrl("not a url"), null);
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
