import assert from "node:assert/strict";
import test from "node:test";
import { runMunicipalAutonomous } from "../worker/sources/municipal.ts";

const pajuUrl = "https://tour.paju.go.kr/user/link/cultural/BD_index.do";
const suwonUrl = "https://www.swcf.or.kr/?p=29";
const emptyDb = {
  prepare() {
    return {
      bind() { return this; },
      async all() { return { results: [], meta: { rows_read: 0 } }; },
      async run() { return { meta: { changes: 0 } }; },
    };
  },
};
const env = { DB: emptyDb, APP_MODE: "production", TOUR_API_ENABLED: "false", ASSETS: {} };

test("scheduled municipal budget aborts a hanging source and reports skipped sources", async () => {
  const originalFetch = globalThis.fetch;
  const progress = [];
  globalThis.fetch = (_url, init) =>
    new Promise((_resolve, reject) =>
      init.signal.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      ),
    );
  try {
    const result = await runMunicipalAutonomous(env, {
      shardIndex: 0,
      sourceKeys: ["paju", "suwon"],
      maxDurationMs: 50,
      onProgress: (item) => progress.push(item),
    });
    assert.equal(result.status, "budget_exhausted");
    assert.equal(result.municipal_budget_exhausted, true);
    assert.deepEqual(result.skipped_due_to_budget, ["paju", "suwon"]);
    assert.equal(result.last_started_source, "paju");
    assert.equal(progress.at(-1).municipal_budget_exhausted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a failed municipal source does not stop the next source", async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    const value = String(url);
    seen.push(value);
    if (value === pajuUrl) throw new TypeError("fetch failed");
    if (value === suwonUrl) return new Response("<table></table>");
    return new Response("");
  };
  try {
    const result = await runMunicipalAutonomous(env, {
      sourceKeys: ["paju", "suwon"],
      maxExternalFetches: 4,
    });
    assert.ok(seen.includes(suwonUrl));
    assert.deepEqual(
      result.failed_sources,
      ["paju", "suwon"],
    );
    assert.equal(result.status, "success");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
