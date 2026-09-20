import assert from "node:assert/strict";
import test from "node:test";
import { CARD_IMAGE_RATIO, cardImageFit } from "../shared/image-fit";

test("ordinary 3:2 and 4:3 photos retain cover in the 16:10 card", () => {
  assert.equal(CARD_IMAGE_RATIO, 1.6);
  assert.equal(cardImageFit(1500, 1000), "cover");
  assert.equal(cardImageFit(1200, 900), "cover");
});

test("extreme portrait and panorama images preserve the official whole image", () => {
  assert.equal(cardImageFit(800, 1600), "contain");
  assert.equal(cardImageFit(3000, 800), "contain");
});

test("invalid intrinsic dimensions fall back to stable cover", () => {
  assert.equal(cardImageFit(0, 1000), "cover");
  assert.equal(cardImageFit(Number.NaN, 1000), "cover");
});
