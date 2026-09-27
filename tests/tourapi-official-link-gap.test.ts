import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyTourApiGapSignal,
  explicitHomepageCandidateFromStoredDetail,
} from "../shared/tourapi-official-link-gap";

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


test("extracts explicit HTTP homepage candidate without guessing", () => {
  assert.deepEqual(
    explicitHomepageCandidateFromStoredDetail(
      JSON.stringify({
        intro: {
          eventhomepage:
            '<a href="http://festival.example.org/2026">행사 홈페이지</a>',
        },
      }),
    ),
    {
      raw: "http://festival.example.org/2026",
      url: "http://festival.example.org/2026",
      kind: "http",
    },
  );
});

test("extracts explicit bare-host homepage as HTTPS candidate", () => {
  assert.deepEqual(
    explicitHomepageCandidateFromStoredDetail(
      JSON.stringify({
        common: { homepage: "www.festival.example.org/guide" },
      }),
    ),
    {
      raw: "www.festival.example.org/guide",
      url: "https://www.festival.example.org/guide",
      kind: "bare_host",
    },
  );
});

test("does not manufacture a homepage from unrelated cached URLs", () => {
  assert.equal(
    explicitHomepageCandidateFromStoredDetail(
      JSON.stringify({
        common: { homepage: "" },
        intro: { eventhomepage: "" },
        info: [{ link: "https://ticket.example/product/1" }],
      }),
    ),
    null,
  );
});
