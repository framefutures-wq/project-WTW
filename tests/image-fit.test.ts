import assert from "node:assert/strict";
import test from "node:test";
import { CARD_IMAGE_RATIO, cardImageFit } from "../shared/image-fit";

test("home cards use a portrait editorial frame", () => {
  assert.equal(CARD_IMAGE_RATIO, 0.75);
});

test("portrait and square-ish artwork keeps the full poster", () => {
  assert.equal(cardImageFit(800, 1200), "contain");
  assert.equal(cardImageFit(1000, 1000), "contain");
});

test("landscape photography fills the portrait card", () => {
  assert.equal(cardImageFit(1500, 1000), "cover");
  assert.equal(cardImageFit(1200, 900), "cover");
});

test("invalid intrinsic dimensions fall back to stable cover", () => {
  assert.equal(cardImageFit(0, 1000), "cover");
  assert.equal(cardImageFit(Number.NaN, 1000), "cover");
});