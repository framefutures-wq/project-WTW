import assert from "node:assert/strict";
import test from "node:test";
import { tourApiPrimaryImage, tourApiSecondaryImage } from "../shared/tourapi-images";

test("selects firstimage as primary and firstimage2 as distinct secondary", () => {
  const raw = {
    firstimage: "https://tong.visitkorea.or.kr/cms/a.jpg",
    firstimage2: "https://tong.visitkorea.or.kr/cms/b.jpg",
  };
  assert.equal(tourApiPrimaryImage(raw), raw.firstimage);
  assert.equal(tourApiSecondaryImage(raw), raw.firstimage2);
});

test("falls back to firstimage2 when firstimage is absent", () => {
  const raw = { firstimage2: "https://tong.visitkorea.or.kr/cms/b.jpg" };
  assert.equal(tourApiPrimaryImage(raw), raw.firstimage2);
  assert.equal(tourApiSecondaryImage(raw), null);
});

test("rejects unsafe or decorative TourAPI image URLs", () => {
  assert.equal(tourApiPrimaryImage({ firstimage: "http://example.com/a.jpg" }), null);
  assert.equal(tourApiPrimaryImage({ firstimage: "https://example.com/icon.png" }), null);
});