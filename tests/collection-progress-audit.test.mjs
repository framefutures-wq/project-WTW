import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { auditCollection } from "../scripts/collection-progress-audit.mjs";

const at = "2026-10-17T06:00:00.000Z";
const fixture = () => ({
  success: true,
  result: [
    [
      {
        observed_at: at,
        operating_date: "2026-10-17",
        status: "ACTIVE",
        source_cursor: 2,
        source_count: 35,
        updated_at: at,
        completed_at: null,
      },
    ],
    [
      {
        observed_at: at,
        queue: "official_detail",
        stage: "RETRY",
        retained: 3,
        due_active: 1,
        future_active: 1,
        expired_unfinished: 1,
        latest_update: at,
      },
    ],
    [
      {
        observed_at: at,
        persistence: "MISSING_EVENT",
        publish_quality_state: null,
        verification: null,
        is_sample: null,
        checkpoints: 1,
        latest_checkpoint_update: at,
        latest_event_update: null,
      },
    ],
    [
      {
        observed_at: at,
        kind: "scan_retry",
        stage: "RETRY",
        retry_stage: "LIST_PENDING",
        reason: "http_5xx",
        source_key: "paju",
        retained: 2,
        due_active: 1,
        future_active: 1,
        expired_unfinished: 0,
        min_attempt_count: 2,
        max_attempt_count: 3,
        min_candidate_cursor: null,
        max_candidate_cursor: null,
        min_candidate_count: null,
        max_candidate_count: null,
      },
      {
        observed_at: at,
        kind: "scan_retry",
        stage: "RETRY",
        retry_stage: "LIST_PENDING",
        reason: "list_parse_requires_fallback",
        source_key: "taebaek",
        retained: 3,
        due_active: 1,
        future_active: 2,
        expired_unfinished: 0,
        min_attempt_count: 2,
        max_attempt_count: 4,
        min_candidate_cursor: null,
        max_candidate_cursor: null,
        min_candidate_count: null,
        max_candidate_count: null,
      },
      {
        observed_at: at,
        kind: "candidate_progress",
        stage: "CANDIDATE_PENDING",
        retry_stage: null,
        reason: "none",
        source_key: null,
        retained: 1,
        due_active: 1,
        future_active: 0,
        expired_unfinished: 0,
        min_attempt_count: 4,
        max_attempt_count: 4,
        min_candidate_cursor: 7,
        max_candidate_cursor: 7,
        min_candidate_count: 25,
        max_candidate_count: 25,
      },
    ],
  ].map((results) => ({
    success: true,
    meta: { changed_db: false, changes: 0, rows_written: 0, rows_read: 7 },
    results,
  })),
});

test("only fixed SELECT/WITH SQL reaches the one fixed database; unapproved fields are discarded", async () => {
  const data = fixture();
  data.result[0].results[0].raw_html = "DO_NOT_OUTPUT";
  let calls = 0;
  const report = await auditCollection({
    token: "synthetic-token",
    fetcher: async (url, options) => {
      calls++;
      assert.equal(
        url,
        "https://api.cloudflare.com/client/v4/accounts/a3ced956d23f59da4cfcf41377cf3ec6/d1/database/91c55189-7bea-4111-8b20-448e8c1a9dd3/query",
      );
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      const sql = JSON.parse(options.body).sql;
      const reviewed = readFileSync(
        new URL("../scripts/collection-progress.sql", import.meta.url),
        "utf8",
      )
        .replace(/--[^\n]*/g, "")
        .split(";")
        .filter((s) => s.trim())
        .map((s) => s.trim())
        .join(";\n");
      assert.equal(sql, reviewed);
      assert.doesNotMatch(
        sql,
        /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|PRAGMA)\b/i,
      );
      return Response.json(data);
    },
  });
  assert.equal(calls, 1);
  assert.equal(report.jobs[0].due_active, 1);
  assert.equal(report.scan_diagnostics[0].source_key, "paju");
  assert.equal(report.scan_diagnostics[1].source_key, "taebaek");
  assert.equal(report.scan_diagnostics[2].source_key, null);
  assert.deepEqual(report.scan_diagnostics.map(({ kind, reason, min_candidate_cursor }) => ({
    kind, reason, min_candidate_cursor,
  })), [
    { kind: "scan_retry", reason: "http_5xx", min_candidate_cursor: null },
    { kind: "scan_retry", reason: "list_parse_requires_fallback", min_candidate_cursor: null },
    { kind: "candidate_progress", reason: "none", min_candidate_cursor: 7 },
  ]);
  assert.equal(report.publication[0].persistence, "MISSING_EVENT");
  assert.equal(report.public_visibility, "NOT_VERIFIED");
  assert.equal(report.progress_comparison, "SECOND_SNAPSHOT_REQUIRED");
  assert.doesNotMatch(JSON.stringify(report), /DO_NOT_OUTPUT|synthetic-token/);
});

test("missing credential stops before network; 403 is not retried", async () => {
  await assert.rejects(
    auditCollection({ fetcher: () => assert.fail("network") }),
    /Missing D1/,
  );
  let calls = 0;
  await assert.rejects(
    auditCollection({
      token: "synthetic",
      fetcher: async () => {
        calls++;
        return new Response("DO_NOT_OUTPUT", { status: 403 });
      },
    }),
    /D1 query HTTP 403/,
  );
  assert.equal(calls, 1);
});

test("write indicators or missing write evidence fail closed", async () => {
  for (const change of [
    { rows_written: 1 },
    { changes: 1 },
    { changed_db: true },
    { rows_written: undefined },
  ]) {
    const data = fixture();
    Object.assign(data.result[0].meta, change);
    await assert.rejects(
      auditCollection({
        token: "synthetic",
        fetcher: async () => Response.json(data),
      }),
      /rejected/,
    );
  }
});

test("injected values, excessive rows, oversized body and missing query results are rejected", async () => {
  for (const mutate of [
    (d) => {
      d.result[1].results[0].queue = "::warning::DO_NOT_OUTPUT";
    },
    (d) => {
      d.result[0].results[0].updated_at = "DO_NOT_OUTPUT";
    },
    (d) => {
      d.result[1].results[0].retained = -1;
    },
    (d) => {
      d.result[1].results = Array(151).fill(d.result[1].results[0]);
    },
    (d) => {
      d.result.pop();
    },
    (d) => {
      d.result[3].results[0].reason = "::warning::DO_NOT_OUTPUT";
    },
    (d) => {
      d.result[3].results[0].source_key = "::warning::DO_NOT_OUTPUT";
    },
  ]) {
    const data = fixture();
    mutate(data);
    await assert.rejects(
      auditCollection({
        token: "synthetic",
        fetcher: async () => Response.json(data),
      }),
      /rejected/,
    );
  }
  await assert.rejects(
    auditCollection({
      token: "synthetic",
      fetcher: async () => new Response("x".repeat(262145)),
    }),
    /rejected/,
  );
});

test("empty queues remain empty without claiming successful progress", async () => {
  const data = fixture();
  for (const result of data.result) result.results = [];
  const report = await auditCollection({
    token: "synthetic",
    fetcher: async () => Response.json(data),
  });
  assert.deepEqual(report.jobs, []);
  assert.deepEqual(report.scan_diagnostics, []);
  assert.deepEqual(report.publication, []);
  assert.equal(report.progress_comparison, "SECOND_SNAPSHOT_REQUIRED");
});
