import assert from "node:assert/strict";
import test from "node:test";
import { classifyTourApiGapSignal } from "../shared/tourapi-official-link-gap";

test("classifies explicit HTTP homepage before other URL noise", () => {
  assert.equal(
    classifyTourApiGapSignal({
      base_raw_payload: JSON.stringify({
        firstimage: "https://images.example/event.jpg",
      }),
      detail_raw_payload: JSON.stringify({
        intro: { eventhomepage: "http://festival.example/2026" },
      }),
    }),
    "EXPLICIT_HTTP_HOMEPAGE",
  );
});

test("classifies explicit bare-host homepage", () => {
  assert.equal(
    classifyTourApiGapSignal({
      base_raw_payload: null,
      detail_raw_payload: JSON.stringify({
        common: { homepage: "www.festival.example/2026" },
      }),
    }),
    "EXPLICIT_BARE_HOST",
  );
});

test("classifies other cached URLs without treating them as official", () => {
  assert.equal(
    classifyTourApiGapSignal({
      base_raw_payload: JSON.stringify({
        related: "https://ticket.example/product/1",
      }),
      detail_raw_payload: JSON.stringify({ common: {}, intro: {} }),
    }),
    "OTHER_HTTPS_URL",
  );
});

test("classifies no signal and invalid cached payload separately", () => {
  assert.equal(
    classifyTourApiGapSignal({
      base_raw_payload: JSON.stringify({ title: "행사" }),
      detail_raw_payload: JSON.stringify({ common: {}, intro: {} }),
    }),
    "NO_URL_SIGNAL",
  );
  assert.equal(
    classifyTourApiGapSignal({
      base_raw_payload: null,
      detail_raw_payload: "{bad",
    }),
    "INVALID_DETAIL_PAYLOAD",
  );
});
