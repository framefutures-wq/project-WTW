import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  enqueueMunicipalListPage,
  runMunicipalListPageOne,
  runMunicipalCandidateCheckpointOne,
  cleanupExpiredMunicipalScanJobs,
  serializeMunicipalScanBatch,
} from "../worker/sources/municipal.ts";

async function setup() {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('ok')}}",
      compatibilityDate: "2026-09-18",
      d1Databases: ["DB"],
      cf: false,
    }),
  );
  const DB = await mf.getD1Database("DB");
  for (const file of readdirSync("migrations").sort())
    for (const sql of readFileSync(`migrations/${file}`, "utf8")
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean))
      await DB.prepare(sql).run();
  return { mf, DB };
}
const DATE = "2026-10-11",
  NOW = "2026-10-11T00:00:00.000Z";
const html = readFileSync("fixtures/municipal-generic-gyeongsan.html", "utf8");

test("list page checkpoint stores normalized bounded items only and page identities do not collide", async () => {
  const { mf, DB } = await setup();
  try {
    const first = await enqueueMunicipalListPage(DB, {
      operatingDate: DATE,
      sourceKey: "gyeongbuk-경산",
      pageIndex: 1,
      now: NOW,
    });
    const duplicate = await enqueueMunicipalListPage(DB, {
      operatingDate: DATE,
      sourceKey: "gyeongbuk-경산",
      pageIndex: 1,
      now: NOW,
    });
    const second = await enqueueMunicipalListPage(DB, {
      operatingDate: DATE,
      sourceKey: "gyeongbuk-경산",
      pageIndex: 2,
      now: NOW,
    });
    assert.equal(first.id, duplicate.id);
    assert.notEqual(first.id, second.id);
    const result = await runMunicipalListPageOne(DB, {
      now: NOW,
      fetchPage: async () => ({
        html,
        finalUrl: "https://gsctf.or.kr/user/performance/all/gal?pageNum=1",
      }),
    });
    assert.equal(result.stage, "CANDIDATE_PENDING");
    assert.equal(result.raw_html_stored, false);
    assert.ok(result.candidate_batch_bytes <= 128 * 1024);
    const row = await DB.prepare(
      "SELECT stage,candidate_cursor,candidate_count,candidate_batch_json FROM municipal_scan_jobs WHERE id=?",
    )
      .bind(first.id)
      .first();
    assert.equal(row.stage, "CANDIDATE_PENDING");
    assert.equal(row.candidate_cursor, 0);
    assert.equal(
      JSON.parse(row.candidate_batch_json).length,
      row.candidate_count,
    );
    assert.equal(
      (await DB.prepare("SELECT COUNT(*) n FROM municipal_scan_jobs").first())
        .n,
      2,
    );
    assert.deepEqual(
      await DB.prepare("SELECT COUNT(*) n FROM events").first(),
      { n: 0 },
    );
    assert.deepEqual(
      await DB.prepare(
        "SELECT COUNT(*) n FROM municipal_candidate_state",
      ).first(),
      { n: 0 },
    );
  } finally {
    await mf.dispose();
  }
});

test("empty stage is a no-op and expired checkpoints are cleaned", async () => {
  const { mf, DB } = await setup();
  try {
    assert.equal(await runMunicipalListPageOne(DB, { now: NOW }), null);
    await enqueueMunicipalListPage(DB, {
      operatingDate: DATE,
      sourceKey: "gyeongbuk-경산",
      pageIndex: 1,
      now: NOW,
    });
    await DB.prepare(
      "UPDATE municipal_scan_jobs SET expires_at='2000-01-01T00:00:00.000Z'",
    ).run();
    await cleanupExpiredMunicipalScanJobs(DB, NOW);
    assert.equal(
      (await DB.prepare("SELECT COUNT(*) n FROM municipal_scan_jobs").first())
        .n,
      0,
    );
  } finally {
    await mf.dispose();
  }
});

test("candidate checkpoint invokes one candidate and advances one cursor", async () => {
  const { mf, DB } = await setup();
  try {
    await enqueueMunicipalListPage(DB, {
      operatingDate: DATE,
      sourceKey: "gyeongbuk-경산",
      pageIndex: 1,
      now: NOW,
    });
    const batch = JSON.stringify([
      {
        candidate: {
          source: "gyeongbuk-경산",
          source_candidate_id: "synthetic-1",
          title: "경산 문화축제",
          start_date: "2027-10-03",
          end_date: "2027-10-04",
          region: "경북",
          locality: "경산",
          venue: "경산문화회관",
          official_url: "https://gsctf.or.kr/user/performance/all/gal?id=1",
          category: "축제",
          snippet: "공식 행사",
          image_candidate: null,
        },
        mode: "generic_html",
      },
    ]);
    await DB.prepare(
      "UPDATE municipal_scan_jobs SET stage='CANDIDATE_PENDING',candidate_batch_json=?,candidate_count=1 WHERE source_key=?",
    )
      .bind(batch, "gyeongbuk-경산")
      .run();
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("unexpected_network");
    };
    const result = await runMunicipalCandidateCheckpointOne(
      { DB, APP_MODE: "production", TOUR_API_ENABLED: "false", ASSETS: {} },
      { now: NOW, koreaToday: DATE },
    );
    globalThis.fetch = priorFetch;
    assert.equal(result.candidate_cursor_before, 0);
    assert.equal(result.candidate_cursor_after, 1);
    assert.equal(result.stage, "DONE");
    assert.equal(
      (
        await DB.prepare(
          "SELECT candidate_cursor,stage FROM municipal_scan_jobs",
        ).first()
      ).candidate_cursor,
      1,
    );
  } finally {
    await mf.dispose();
  }
});

test("retry checkpoints remain unavailable until their bounded backoff is due", async () => {
  const { mf, DB } = await setup();
  try {
    const row = await enqueueMunicipalListPage(DB, {
      operatingDate: DATE,
      sourceKey: "gyeongbuk-경산",
      pageIndex: 1,
      now: NOW,
    });
    await DB.prepare(
      "UPDATE municipal_scan_jobs SET stage='RETRY',retry_stage='LIST_PENDING',available_at='2026-10-11T00:10:00.000Z',retry_at='2026-10-11T00:10:00.000Z'",
    ).run();
    assert.equal(await runMunicipalListPageOne(DB, { now: NOW }), null);
    assert.equal(
      (
        await DB.prepare("SELECT stage FROM municipal_scan_jobs WHERE id=?")
          .bind(row.id)
          .first()
      ).stage,
      "RETRY",
    );
  } finally {
    await mf.dispose();
  }
});

test("oversized candidate checkpoint is rejected without cursor advancement", async () => {
  const { mf, DB } = await setup();
  try {
    const row = await enqueueMunicipalListPage(DB, {
      operatingDate: DATE,
      sourceKey: "gyeongbuk-경산",
      pageIndex: 1,
      now: NOW,
    });
    await DB.prepare(
      "UPDATE municipal_scan_jobs SET stage='CANDIDATE_PENDING',candidate_batch_json=?,candidate_count=1",
    )
      .bind("x".repeat(128 * 1024 + 1))
      .run();
    const result = await runMunicipalCandidateCheckpointOne(
      { DB, APP_MODE: "production", TOUR_API_ENABLED: "false", ASSETS: {} },
      { now: NOW, koreaToday: DATE },
    );
    assert.equal(result.stage, "RETRY");
    const current = await DB.prepare(
      "SELECT candidate_cursor,safe_error_category FROM municipal_scan_jobs WHERE id=?",
    )
      .bind(row.id)
      .first();
    assert.equal(current.candidate_cursor, 0);
    assert.equal(current.safe_error_category, "candidate_batch_invalid");
  } finally {
    await mf.dispose();
  }
});

test("candidate checkpoint serialization enforces both count and UTF-8 byte caps", () => {
  const value = {
    candidate: {
      source: "gyeongbuk-경산",
      source_candidate_id: "x",
      title: "축제",
      start_date: null,
      end_date: null,
      region: "경북",
      locality: "경산",
      venue: null,
      official_url: "https://gsctf.or.kr",
      category: null,
      snippet: "x".repeat(6000),
      image_candidate: null,
    },
    mode: "generic_html",
  };
  assert.throws(
    () => serializeMunicipalScanBatch(Array.from({ length: 25 }, () => value)),
    /candidate_batch_too_large/,
  );
  assert.throws(
    () =>
      serializeMunicipalScanBatch(
        Array.from({ length: 26 }, () => ({
          ...value,
          candidate: { ...value.candidate, snippet: null },
        })),
      ),
    /candidate_batch_too_large/,
  );
});
