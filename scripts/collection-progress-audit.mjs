import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { assertReadOnlySql } from "./morning-production-check-lib.mjs";

const ENDPOINT =
  "https://api.cloudflare.com/client/v4/accounts/a3ced956d23f59da4cfcf41377cf3ec6/d1/database/91c55189-7bea-4111-8b20-448e8c1a9dd3/query";
const SQL = readFileSync(
  new URL("./collection-progress.sql", import.meta.url),
  "utf8",
)
  .replace(/--[^\n]*/g, "")
  .split(";")
  .filter((s) => s.trim())
  .map(assertReadOnlySql);
if (SQL.length !== 4) throw new Error("Invalid fixed collection queries");
const fail = () => {
  throw new Error("Collection progress response rejected");
};
const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : fail());
const choice = (v, values) => (values.includes(v) ? v : fail());
const timestamp = (v) => {
  if (v === null) return null;
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?Z?$/.test(v)
  )
    fail();
  const parsed = Date.parse(v.endsWith("Z") ? v : v.replace(" ", "T") + "Z");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fail();
};
const stages = [
  "LIST_PENDING",
  "CANDIDATE_PENDING",
  "FETCH_PENDING",
  "READER_PENDING",
  "PARSE_PENDING",
  "POSTER_PENDING",
  "PERSIST_PENDING",
  "FETCH_COMMON",
  "FETCH_INTRO",
  "FETCH_INFO",
  "PERSIST_ONE",
  "RETRY",
  "DONE",
];
const queues = [
  "municipal_scan",
  "municipal_detail",
  "official_detail",
  "tourapi_detail",
];
const municipalSourceKeys = [
  "paju", "suwon", "goyang", "hwaseong", "bucheon", "taebaek",
  "seoul-hangang", "daejeon-fvu", "incheon-res", "gyeonggi-과천",
  "gyeonggi-하남", "gyeongbuk-상주", "gyeonggi-평택", "gyeonggi-여주",
  "gyeongbuk-경산", "incheon-서해", "jeonnam-gwangju-곡성", "gyeonggi-광주",
  "seoul-gangnam", "ulsan-북", "daegu-서", "gangwon-원주", "gyeonggi-용인",
  "gyeonggi-이천", "gyeonggi-의정부", "chungbuk-옥천", "gyeongbuk-안동",
  "busan-동", "gyeongbuk-영주", "busan-해운대", "gyeongbuk-경주",
  "ulsan-jung", "gyeongbuk-포항", "gyeonggi-포천", "gyeongnam-거제",
  "jeonbuk-전주",
];

export async function auditCollection({ token, fetcher = fetch } = {}) {
  if (typeof token !== "string" || !token || /\s/.test(token))
    throw new Error("Missing D1 read credential");
  const response = await fetcher(ENDPOINT, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql: SQL.join(";\n") }),
  });
  if (!response.ok) throw new Error(`D1 query HTTP ${response.status}`);
  const chunks = [];
  let bytes = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 262144) fail();
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (
    body?.success !== true ||
    !Array.isArray(body.result) ||
    body.result.length !== 4
  )
    fail();
  const results = body.result.map((result) => {
    if (
      result.success !== true ||
      !Array.isArray(result.results) ||
      result.results.length > 150
    )
      fail();
    // Missing write counters are not evidence of zero writes.
    if (
      result.meta?.changed_db !== false ||
      result.meta?.rows_written !== 0 ||
      result.meta?.changes !== 0
    )
      fail();
    return { rows_read: count(result.meta.rows_read), rows: result.results };
  });
  const cycles = results[0].rows.map((r) => {
    if (!/^\d{4}-\d\d-\d\d$/.test(r.operating_date)) fail();
    return {
      observed_at: timestamp(r.observed_at),
      operating_date: r.operating_date,
      status: choice(r.status, ["ACTIVE", "WAITING", "DONE"]),
      source_cursor: count(r.source_cursor),
      source_count: count(r.source_count),
      updated_at: timestamp(r.updated_at),
      completed_at: timestamp(r.completed_at),
    };
  });
  const jobs = results[1].rows.map((r) => ({
    observed_at: timestamp(r.observed_at),
    queue: choice(r.queue, queues),
    stage: choice(r.stage, stages),
    retained: count(r.retained),
    due_active: count(r.due_active),
    future_active: count(r.future_active),
    expired_unfinished: count(r.expired_unfinished),
    latest_update: timestamp(r.latest_update),
  }));

  const scanDiagnostics = results[3].rows.map((r) => {
    const kind = choice(r.kind, ["scan_retry", "candidate_progress"]);
    const stage = choice(r.stage, ["RETRY", "CANDIDATE_PENDING"]);
    const retryStage = r.retry_stage === null
      ? null
      : choice(r.retry_stage, ["LIST_PENDING", "CANDIDATE_PENDING"]);
    const reason = choice(r.reason, [
      "unsafe_url", "candidate_batch_too_large", "list_health_check_failed",
      "list_parse_requires_fallback", "http_429", "http_5xx",
      "network_or_timeout", "list_page_failed", "candidate_batch_invalid",
      "candidate_cursor_invalid", "candidate_one_failed", "other", "none",
    ]);
    const nullableCount = (value) => value === null ? null : count(value);
    const sourceKey = r.source_key === null ? null : choice(r.source_key, municipalSourceKeys);
    if (kind === "scan_retry" && (stage !== "RETRY" || retryStage === null || reason === "none")) fail();
    if (kind === "candidate_progress" && (stage !== "CANDIDATE_PENDING" || retryStage !== null || reason !== "none" || sourceKey !== null)) fail();
    if (kind === "scan_retry" && (["http_5xx", "candidate_one_failed", "list_parse_requires_fallback"].includes(reason) !== (sourceKey !== null))) fail();
    return {
      observed_at: timestamp(r.observed_at), kind, stage, retry_stage: retryStage, reason, source_key: sourceKey,
      retained: count(r.retained), due_active: count(r.due_active),
      future_active: count(r.future_active), expired_unfinished: count(r.expired_unfinished),
      min_attempt_count: nullableCount(r.min_attempt_count),
      max_attempt_count: nullableCount(r.max_attempt_count),
      min_candidate_cursor: nullableCount(r.min_candidate_cursor),
      max_candidate_cursor: nullableCount(r.max_candidate_cursor),
      min_candidate_count: nullableCount(r.min_candidate_count),
      max_candidate_count: nullableCount(r.max_candidate_count),
    };
  });
  if (scanDiagnostics.some((r) => {
    if (r.kind === "scan_retry")
      return [r.min_candidate_cursor, r.max_candidate_cursor, r.min_candidate_count, r.max_candidate_count].some((v) => v !== null);
    if (r.retained === 0)
      return [r.min_candidate_cursor, r.max_candidate_cursor, r.min_candidate_count, r.max_candidate_count].some((v) => v !== null);
    return [r.min_candidate_cursor, r.max_candidate_cursor, r.min_candidate_count, r.max_candidate_count].some((v) => v === null);
  })) fail();
  
  const publication = results[2].rows.map((r) => ({
    observed_at: timestamp(r.observed_at),
    persistence: choice(r.persistence, ["MISSING_EVENT", "EVENT_EXISTS"]),
    publish_quality_state: choice(r.publish_quality_state, [
      null,
      "PUBLIC",
      "HOLD",
      "EXCLUDE",
    ]),
    verification: choice(r.verification, [
      null,
      "pending",
      "verified",
      "stale",
      "sample",
    ]),
    is_sample: choice(r.is_sample, [null, 0, 1]),
    checkpoints: count(r.checkpoints),
    latest_checkpoint_update: timestamp(r.latest_checkpoint_update),
    latest_event_update: timestamp(r.latest_event_update),
  }));
  return {
    mode: "read-only",
    rows_written: 0,
    rows_read: results.map((r) => r.rows_read),
    cycles,
    jobs,
    publication,
    scan_diagnostics: scanDiagnostics,
    public_visibility: "NOT_VERIFIED",
    progress_comparison: "SECOND_SNAPSHOT_REQUIRED",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(
      JSON.stringify(
        await auditCollection({ token: process.env.CLOUDFLARE_D1_READ_TOKEN }),
        null,
        2,
      ),
    );
  } catch {
    console.error(
      "Collection progress audit failed; raw details suppressed. No automatic retry.",
    );
    process.exitCode = 1;
  }
}
