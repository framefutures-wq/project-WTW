import test from "node:test";
import assert from "node:assert/strict";
import {
  extractUrls,
  normalizeUrl,
  plain,
  classify,
  compare,
} from "../scripts/official-source-lib.mjs";

test("URL extraction preserves provenance, decodes links, separates images and rejects credentials", () => {
  const urls = extractUrls({
    homepage: '<a href="https://example.org/event?a=1&amp;b=2">공식</a>',
    firstimage: "https://example.org/photo.jpg",
    overview: "www.example.org/about",
    unsafe: "https://example.org/?serviceKey=synthetic-test-only",
  });
  assert.equal(urls.length, 3);
  assert.equal(urls[0].url, "https://example.org/event?a=1&b=2");
  assert.equal(urls[1].asset, true);
  assert.equal(urls[2].url, "https://www.example.org/about");
  assert.equal(normalizeUrl("javascript:alert(1)"), null);
  assert.equal(normalizeUrl("https://user:pass@example.org"), null);
  assert.equal(extractUrls({homepage: "공식 홈페이지 example.org"})[0].url, "https://example.org/");
  assert.equal(extractUrls({overview: "contact@example.org"}).length, 0);
  assert.equal(extractUrls({overview: "(https://example.org/?page=1)를 확인"})[0].url, "https://example.org/?page=1");
  assert.equal(
    plain("<!-- old dates --> <script>old</script><b>행사</b>&nbsp;안내"),
    "행사 안내",
  );
});
const page = {
  accessStatus: "ok",
  contentHash: "synthetic-hash",
  finalUrl: "https://example.org/event",
  text: "합성 행사 주최 테스트재단 2026-09-19 무료",
};
const review = {
  contentHash: page.contentHash,
  sourceTypes: ["event_official", "organizer_official"],
  official: true,
  excerpt: "합성 행사 주최 테스트재단",
  reason: "합성 주최기관 확인",
};
test("officialness requires matching fetched content, not host or HTTP failure", () => {
  for (const accessStatus of ["http_error", "network_error"]) {
    const c = classify({ ...page, accessStatus, httpStatus: 403 });
    assert.equal(c.official, null);
    assert.throws(() => classify({ ...page, accessStatus }, review));
  }
  assert.deepEqual(classify(page, review).sourceTypes, [
    "event_official",
    "organizer_official",
  ]);
  assert.throws(() => classify(page, { ...review, contentHash: "changed" }));
  assert.throws(() => classify(page, { ...review, excerpt: "invented" }));
  assert.throws(() =>
    classify(page, { ...review, sourceTypes: ["visitkorea"] }),
  );
});
test("comparison needs explicit evidence and missing values never become mismatches", () => {
  const c = classify(page, review);
  const observed = {
    value: "2026-09-19",
    excerpt: "2026-09-19",
    reason: "해당 회차 날짜",
  };
  assert.equal(
    compare("start_date", "2026-09-19", observed, page, c).result,
    "match",
  );
  assert.equal(
    compare(
      "title",
      "서울·빛 축제",
      { ...observed, value: "서울빛 축제", excerpt: "2026-09-19" },
      page,
      c,
    ).result,
    "match",
  );
  assert.equal(
    compare(
      "start_date",
      "2026-09-19",
      { ...observed, value: "2026.09.19" },
      page,
      c,
    ).result,
    "match",
  );
  assert.equal(
    compare(
      "start_date",
      "2026-09-19",
      { ...observed, value: "2026.99.99" },
      page,
      c,
    ).result,
    "mismatch",
  );
  assert.equal(
    compare("start_date", "2026-09-20", observed, page, c).result,
    "mismatch",
  );
  assert.equal(
    compare("start_date", null, observed, page, c).result,
    "not_comparable",
  );
  assert.equal(compare("cancelled", null, null, page, c).result, "unconfirmed");
  assert.throws(() =>
    compare(
      "start_date",
      "2026-09-19",
      { ...observed, excerpt: "invented" },
      page,
      c,
    ),
  );
  assert.throws(() =>
    compare("start_date", "2026-09-19", observed, page, { official: null }),
  );
});
