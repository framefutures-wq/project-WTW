import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { runMunicipalCandidateOne } from "../worker/sources/municipal.ts";

const LIST_URL = "https://tour.paju.go.kr/user/link/cultural/BD_index.do";
const TODAY = new Date().toISOString().slice(0, 10);
const FUTURE = `${Number(TODAY.slice(0, 4)) + 1}-10-03`;
const envFor = (DB) => ({ DB, APP_MODE: "production", TOUR_API_ENABLED: "false", ASSETS: {} });

async function setup() {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: "export default {fetch(){return new Response('ok')}}",
    compatibilityDate: "2026-09-18",
    d1Databases: ["DB"],
    cf: false,
  }));
  const DB = await mf.getD1Database("DB");
  for (const file of readdirSync("migrations").sort())
    for (const sql of readFileSync(`migrations/${file}`, "utf8").split(";").map((part) => part.trim()).filter(Boolean))
      await DB.prepare(sql).run();
  return { mf, DB };
}

const candidate = (id, overrides = {}) => ({
  source: "paju",
  source_candidate_id: id,
  title: `2027 제1회 파주 시민문화축제 ${id}`,
  start_date: FUTURE,
  end_date: FUTURE,
  region: "경기",
  locality: "파주",
  venue: "임진각 평화누리",
  official_url: LIST_URL,
  category: "축제",
  snippet: "지역 시민과 방문객을 위한 공식 문화축제",
  image_candidate: null,
  ...overrides,
});

async function run(DB, value, options = {}) {
  return runMunicipalCandidateOne(envFor(DB), {
    candidate: value,
    mode: "structured_event",
    now: `${TODAY}T03:00:00.000Z`,
    koreaToday: TODAY,
    publishMutations: 0,
    maxPublishMutations: 10,
    ...options,
  });
}

test("one valid normalized candidate persists the same core/source/evidence contract", async () => {
  const { mf, DB } = await setup();
  try {
    const result = await run(DB, candidate("core-proof"));
    assert.equal(result.decision, "AUTO_PUBLISH");
    assert.equal(result.inserted, 1);
    assert.equal(result.detail_required, false);
    const event = await DB.prepare("SELECT id,title,region,venue,start_date,end_date,verification FROM events WHERE id=?").bind(result.candidate_id).first();
    assert.equal(event.title, "2027 제1회 파주 시민문화축제 core-proof");
    assert.equal(event.verification, "verified");
    const source = await DB.prepare("SELECT kind,priority,url FROM sources WHERE id=?").bind(`municipal-source-${result.candidate_id}`).first();
    assert.deepEqual(source, { kind: "municipality", priority: 2, url: LIST_URL });
    const evidence = await DB.prepare("SELECT field,excerpt FROM event_evidence WHERE event_id=? ORDER BY field").bind(result.candidate_id).all();
    assert.deepEqual(evidence.results.map((row) => row.field), ["schedule", "status", "venue"]);
    const state = await DB.prepare("SELECT decision_state,source_key,source_candidate_id FROM municipal_candidate_state WHERE candidate_id=?").bind(result.candidate_id).first();
    assert.deepEqual(state, { decision_state: "AUTO_PUBLISH", source_key: "paju", source_candidate_id: "core-proof" });
  } finally { await mf.dispose(); }
});

test("existing identity is stable on rerun; changed core waits for a later observation", async () => {
  const { mf, DB } = await setup();
  try {
    const original = candidate("stable");
    const first = await run(DB, original);
    const repeated = await run(DB, original);
    assert.equal(repeated.candidate_id, first.candidate_id);
    assert.equal(repeated.decision, "AUTO_PUBLISH");
    assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM events WHERE id=?").bind(first.candidate_id).first()).count, 1);
    const changed = await run(DB, candidate("stable", { venue: "파주 임진각 평화누리" }));
    assert.equal(changed.decision, "AUTO_RETRY");
    assert.equal(changed.reason, "core_conflict");
    assert.equal((await DB.prepare("SELECT venue FROM events WHERE id=?").bind(first.candidate_id).first()).venue, "임진각 평화누리");
  } finally { await mf.dispose(); }
});

test("generic candidate bridges to one existing municipal identity before state/detail handoff", async () => {
  const { mf, DB } = await setup();
  try {
    const value = candidate("new-normalized-id", {
      title: "2027 제1회 파주 시민문화축제 identity-bridge",
      official_url: "https://tour.paju.go.kr/user/link/cultural/BD_view.do?idx=999002",
    });
    const legacyId = "municipal-paju-legacy-stable-id";
    await DB.prepare("INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES('legacy-source','municipality',2,'legacy',?,?)").bind(LIST_URL, `${TODAY}T00:00:00Z`).run();
    await DB.prepare("INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,cost,pet_policy,status,verification,is_sample,primary_source_id,checked_at) VALUES(?,?,'legacy','경기','임진각 평화누리','임진각 평화누리',?,?, 'unknown','unknown','scheduled','verified',0,'legacy-source',?)").bind(legacyId, value.title, FUTURE, FUTURE, `${TODAY}T00:00:00Z`).run();
    const result = await run(DB, value, { mode: "generic_html" });
    assert.equal(result.candidate_id, legacyId);
    assert.equal(result.detail_required, true);
    assert.equal((await DB.prepare("SELECT candidate_id,event_id FROM municipal_detail_jobs WHERE candidate_id=?").bind("new-normalized-id").first()).event_id, legacyId);
    assert.equal((await DB.prepare("SELECT candidate_id,decision_state FROM municipal_candidate_state WHERE candidate_id=?").bind(legacyId).first()).decision_state, "AUTO_RETRY");
    assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM events WHERE id LIKE 'municipal-paju-%'").first()).count, 1);
  } finally { await mf.dispose(); }
});

test("external duplicate, invalid core, expired candidate and publish cap fail closed", async () => {
  const { mf, DB } = await setup();
  try {
    const duplicateCandidate = candidate("dupe");
    await DB.prepare("INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES('existing-source','municipality',2,'existing',?,?)").bind(LIST_URL, `${TODAY}T00:00:00Z`).run();
    await DB.prepare("INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,cost,pet_policy,status,verification,is_sample,primary_source_id,checked_at) VALUES('existing-event',?,'x','경기','임진각 평화누리','임진각 평화누리',?,?, 'unknown','unknown','scheduled','verified',0,'existing-source',?)").bind(duplicateCandidate.title, FUTURE, FUTURE, `${TODAY}T00:00:00Z`).run();
    assert.equal((await run(DB, duplicateCandidate)).decision, "AUTO_EXCLUDE");
    assert.equal((await run(DB, candidate("invalid", { venue: null }))).decision, "AUTO_RETRY");
    assert.equal((await run(DB, candidate("expired", { start_date: "2020-01-01", end_date: "2020-01-01" }))).decision, "EXPIRED");
    assert.equal((await run(DB, candidate("capped"), { publishMutations: 10, maxPublishMutations: 10 })).reason, "daily_publish_circuit_breaker");
    assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM events WHERE title LIKE '%capped'").first()).count, 0);
  } finally { await mf.dispose(); }
});

test("new generic candidate defers detail work until an event exists", async () => {
  const { mf, DB } = await setup();
  const priorFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches += 1; throw new Error("unexpected_network"); };
  try {
    const value = candidate("detail-required", { official_url: "https://tour.paju.go.kr/user/link/cultural/BD_view.do?idx=987654" });
    const first = await run(DB, value, { mode: "generic_html" });
    assert.equal(first.decision, "AUTO_RETRY");
    assert.equal(first.detail_required, true);
    assert.equal(fetches, 0);
    const jobs = await DB.prepare("SELECT candidate_id,stage FROM municipal_detail_jobs WHERE candidate_id=?").bind("detail-required").all();
    assert.deepEqual(jobs.results, []);
  } finally { globalThis.fetch = priorFetch; await mf.dispose(); }
});
