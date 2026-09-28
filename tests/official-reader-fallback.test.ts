import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDetailLinkInjection,
  fetchOfficialPageViaReader,
} from "../shared/official-reader-fallback";

test("reader fallback rejects non-public or non-https targets", async () => {
  await assert.rejects(
    () => fetchOfficialPageViaReader("http://example.org/event"),
    /official_reader_invalid_target/,
  );
  await assert.rejects(
    () => fetchOfficialPageViaReader("https://localhost/event"),
    /official_reader_invalid_target/,
  );
});

test("reader fallback normalizes markdown tables and image summaries into parseable html", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        data: {
          url: "https://example.org/events",
          content:
            "| 제목 | 날짜 | 장소 |\n|---|---|---|\n| [축제](https://example.org/view?id=1) | 2026-10-03 | 중앙광장 |",
          images: { poster: "https://example.org/poster.jpg" },
        },
      }),
      { status: 200 },
    )) as typeof fetch;
  try {
    const page = await fetchOfficialPageViaReader("https://example.org/events");
    assert.match(page.html, /<table>/);
    assert.match(page.html, /href="https:\/\/example\.org\/view\?id=1"/);
    assert.match(page.html, /src="https:\/\/example\.org\/poster\.jpg"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("detail link injection contains the configured exact-detail parameters", () => {
  const script = buildDetailLinkInjection(
    "https://ui4u.go.kr/portal/eventNoti/list.do?mId=0301170300",
    {
      path: "/portal/eventNoti/view.do",
      idParam: "idx",
      fixedQuery: { mId: "0301170300" },
    },
  );
  assert.match(script ?? "", /idx/);
  assert.match(script ?? "", /0301170300/);
});
