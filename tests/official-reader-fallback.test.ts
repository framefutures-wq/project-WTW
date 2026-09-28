import assert from "node:assert/strict";
import test from "node:test";
import { fetchOfficialPageViaReader } from "../shared/official-reader-fallback";

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

test("reader fallback uses anonymous GET rendered-html transport", async () => {
  const originalFetch = globalThis.fetch;
  const seen: {
    url?: string;
    method?: string;
    respondWith?: string | null;
    referer?: string | null;
  } = {};
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.url = String(input);
    seen.method = init?.method;
    const headers = new Headers(init?.headers);
    seen.respondWith = headers.get("x-respond-with");
    seen.referer = headers.get("x-referer");
    return new Response(
      JSON.stringify({
        data: {
          url: "https://example.org/events?year=2026",
          html:
            '<table><tr><td><a href="#" onclick="fnView(\'2016\')">축제</a></td></tr></table>',
          images: { poster: "https://example.org/poster.jpg" },
        },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    const page = await fetchOfficialPageViaReader(
      "https://example.org/events?year=2026",
      { refererUrl: "https://example.org/events" },
    );
    assert.equal(
      seen.url,
      "https://r.jina.ai/https://example.org/events?year=2026",
    );
    assert.equal(seen.method, "GET");
    assert.equal(seen.respondWith, "html");
    assert.equal(seen.referer, "https://example.org/events");
    assert.match(page.html, /onclick="fnView\('2016'\)"/);
    assert.match(page.html, /src="https:\/\/example\.org\/poster\.jpg"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reader fallback still normalizes markdown when html is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        data: {
          url: "https://example.org/events",
          content:
            "| 제목 | 날짜 | 장소 |\n|---|---|---|\n| [축제](https://example.org/view?id=1) | 2026-10-03 | 중앙광장 |",
        },
      }),
      { status: 200 },
    )) as typeof fetch;
  try {
    const page = await fetchOfficialPageViaReader("https://example.org/events");
    assert.match(page.html, /<table>/);
    assert.match(page.html, /href="https:\/\/example\.org\/view\?id=1"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
