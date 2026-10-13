import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { enqueueMunicipalListPage, seedMunicipalDailyScanOne } from "../worker/sources/municipal";
import { municipalCandidateFastPathReady, runMunicipalMicroJobOne, type MunicipalMicroSchedulerDependencies } from "../worker/sources/municipal-micro-scheduler";

const NOW = "2026-10-11T00:00:00.000Z";

const emptyCleanup = async () => ({ meta: { changes: 0 } });
const dependencies = (calls: string[], outcomes: Partial<Record<Exclude<keyof MunicipalMicroSchedulerDependencies, "candidateFastPathReady">, { id?: string; job_id?: string; stage: string } | null>> = {}, candidateFastPathReady = false): MunicipalMicroSchedulerDependencies => ({
  candidateFastPathReady: async () => { calls.push("candidate-fast-path"); return candidateFastPathReady; },
  detailPersistOne: async () => { calls.push("persist"); return outcomes.detailPersistOne ?? null; },
  detailParseOne: async () => { calls.push("parse"); return outcomes.detailParseOne ?? null; },
  detailFetchOne: async () => { calls.push("fetch"); return outcomes.detailFetchOne ?? null; },
  runVerifiedGenericMunicipalPublicationOne: async () => { calls.push("verified-publication"); return outcomes.runVerifiedGenericMunicipalPublicationOne ?? null; },
  runMunicipalSourceFinalizeOne: async () => { calls.push("finalize"); return outcomes.runMunicipalSourceFinalizeOne ?? null; },
  runMunicipalCandidateCheckpointOne: async () => { calls.push("candidate"); return outcomes.runMunicipalCandidateCheckpointOne ?? null; },
  runMunicipalListPageOne: async () => { calls.push("list"); return outcomes.runMunicipalListPageOne ?? null; },
  cleanupExpiredMunicipalDetailJobs: async () => { calls.push("cleanup-detail"); return emptyCleanup(); },
  cleanupExpiredMunicipalScanJobs: async () => { calls.push("cleanup-scan"); return emptyCleanup(); },
});

async function setup() {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default {fetch(){return new Response('ok')}}", compatibilityDate: "2026-09-18", d1Databases: ["DB"], cf: false }));
  const DB = await mf.getD1Database("DB");
  for (const file of readdirSync("migrations").sort())
    for (const sql of readFileSync(`migrations/${file}`, "utf8").split(";").map((value) => value.trim()).filter(Boolean))
      await DB.prepare(sql).run();
  return { mf, DB, env: { DB, APP_MODE: "production", TOUR_API_ENABLED: "false", ASSETS: {} } };
}

test("micro scheduler selects exactly one stage in durable priority order", async () => {
  const cases: Array<[keyof MunicipalMicroSchedulerDependencies, string, string]> = [
    ["detailPersistOne", "DETAIL_PERSIST", "DONE"],
    ["detailParseOne", "DETAIL_PARSE", "PERSIST_PENDING"],
    ["detailFetchOne", "DETAIL_FETCH", "PARSE_PENDING"],
    ["runVerifiedGenericMunicipalPublicationOne", "VERIFIED_GENERIC_PUBLICATION", "AUTO_PUBLISH"],
    ["runMunicipalSourceFinalizeOne", "SOURCE_FINALIZE", "SOURCE_FINALIZED"],
    ["runMunicipalCandidateCheckpointOne", "CANDIDATE_PENDING", "DONE"],
    ["runMunicipalListPageOne", "LIST_PENDING", "DONE"],
  ];
  for (const [winner, stage, status] of cases) {
    const calls: string[] = [];
    const result = await runMunicipalMicroJobOne({ DB: {} } as never, dependencies(calls, { [winner]: { id: "job-1", stage: status } }));
    assert.deepEqual(result, { stage, status, job_id: "job-1" });
    assert.equal(calls.length, cases.findIndex(([name]) => name === winner) + 2);
  }
});

test("candidate fast path skips empty higher-priority runners but retains the candidate claim", async () => {
  const calls: string[] = [];
  const result = await runMunicipalMicroJobOne(
    { DB: {} } as never,
    dependencies(calls, {
      runMunicipalCandidateCheckpointOne: { id: "candidate-1", stage: "CANDIDATE_PENDING" },
    }, true),
  );
  assert.deepEqual(result, { stage: "CANDIDATE_PENDING", status: "CANDIDATE_PENDING", job_id: "candidate-1" });
  assert.deepEqual(calls, ["candidate-fast-path", "candidate"]);
});

test("candidate fast-path eligibility excludes a due higher-priority detail checkpoint", async () => {
  const { mf, DB } = await setup();
  const readyAt = "2099-10-11T00:00:00.000Z";
  try {
    await DB.batch([
      DB.prepare(
        `INSERT INTO municipal_scan_jobs
         (id,operating_date,source_key,page_url,page_identity,page_index,stage,candidate_batch_json,candidate_cursor,candidate_count,source_finalized_at,available_at,created_at,updated_at,expires_at)
         VALUES('candidate','2026-10-11','gyeongbuk-경산','https://gb.go.kr/','candidate',1,'CANDIDATE_PENDING','[]',0,1,?,?,?,?,?)`,
      ).bind(readyAt, readyAt, readyAt, readyAt, "2099-10-12T00:00:00.000Z"),
      DB.prepare(
        `INSERT INTO municipal_detail_jobs
         (id,source_key,candidate_id,event_id,official_url,candidate_json,stage,available_at,created_at,updated_at,expires_at)
         VALUES('detail','gyeongbuk-경산','detail','municipal-detail','https://gb.go.kr/','{}','FETCH_PENDING',?,?,?,?)`,
      ).bind(readyAt, readyAt, readyAt, "2099-10-12T00:00:00.000Z"),
    ]);
    assert.equal(await municipalCandidateFastPathReady(DB as never, readyAt), false);
    await DB.prepare("UPDATE municipal_detail_jobs SET stage='DONE'").run();
    assert.equal(await municipalCandidateFastPathReady(DB as never, readyAt), true);
  } finally { await mf.dispose(); }
});

test("micro scheduler does not claim a future retry and returns a compact no-op", async () => {
  const { mf, DB, env } = await setup();
  try {
    await enqueueMunicipalListPage(DB, { operatingDate: "2026-10-11", sourceKey: "gyeongbuk-경산", pageIndex: 1, now: NOW });
    await DB.prepare("UPDATE municipal_scan_jobs SET stage='RETRY',retry_stage='LIST_PENDING',available_at='2099-10-11T00:10:00.000Z',retry_at='2099-10-11T00:10:00.000Z'").run();
    assert.deepEqual(await runMunicipalMicroJobOne(env as never), { stage: "NO_OP", status: "empty", job_id: null });
    assert.deepEqual(await DB.prepare("SELECT stage FROM municipal_scan_jobs").first(), { stage: "RETRY" });
  } finally { await mf.dispose(); }
});

test("daily scan seed is source-bounded, idempotent, and preserves pagination pages", async () => {
  const { mf, DB } = await setup();
  try {
    const first = await seedMunicipalDailyScanOne(DB, { operatingDate: "2026-10-11", sourceCursor: 0, now: NOW });
    const repeated = await seedMunicipalDailyScanOne(DB, { operatingDate: "2026-10-11", sourceCursor: 0, now: NOW });
    assert.equal(first.source_key, "paju");
    assert.equal(first.seeded_pages, 1);
    assert.deepEqual(repeated, first);
    const paginated = await seedMunicipalDailyScanOne(DB, { operatingDate: "2026-10-11", sourceCursor: 8, now: NOW });
    assert.equal(paginated.seeded_pages, 3);
    const rows = await DB.prepare("SELECT source_key,page_index FROM municipal_scan_jobs WHERE source_key=? ORDER BY page_index").bind(paginated.source_key).all<{ source_key: string; page_index: number }>();
    assert.deepEqual(rows.results.map((row) => row.page_index), [1, 2, 3]);
  } finally { await mf.dispose(); }
});
