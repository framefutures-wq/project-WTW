import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { FAIR_DISPATCHER_MAX_GAP, chooseFairMicroLane, fairMicroLaneReadiness, fairMicroThroughput, runFairMicroDispatcherOne, type FairMicroDispatcherDependencies } from "../worker/sources/fair-micro-dispatcher";

const AT = "2026-10-12T01:00:00.000Z";
async function setup() {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default {fetch(){return new Response('ok')}}", compatibilityDate: "2026-09-18", d1Databases: ["DB"], cf: false }));
  const DB = await mf.getD1Database("DB");
  for (const file of readdirSync("migrations").sort()) for (const sql of readFileSync(`migrations/${file}`, "utf8").split(";").map((part) => part.trim()).filter(Boolean)) await DB.prepare(sql).run();
  return { mf, DB, env: { DB } as never };
}
const ready = (lanes: Partial<Record<"municipal" | "official" | "tourapi", number>>) => async () => ({ municipal: lanes.municipal ?? 0, official: lanes.official ?? 0, tourapi: lanes.tourapi ?? 0 });
const result = (name: string) => async () => ({ stage: name, status: "ok", job_id: name });
const deps = (lanes: Partial<Record<"municipal" | "official" | "tourapi", number>>, calls: string[]): FairMicroDispatcherDependencies => ({
  ready: ready(lanes),
  municipal: async () => { calls.push("municipal"); return { stage: "M", status: "ok", job_id: "m" }; },
  official: async () => { calls.push("official"); return { stage: "O", status: "ok", job_id: "o" }; },
  tourapi: async () => { calls.push("tourapi"); return { stage: "T", status: "ok", job_id: "t" }; },
});

test("one invocation calls exactly one heavy engine and records its result", async () => {
  const { mf, DB, env } = await setup(); try {
    const calls: string[] = [];
    assert.deepEqual(await runFairMicroDispatcherOne(env, AT, deps({ municipal: 1, official: 1 }, calls)), { status: "DONE", lane: "municipal", stage: "M", job_id: "m" });
    assert.deepEqual(calls, ["municipal"]);
    assert.deepEqual(await DB.prepare("SELECT last_lane,last_stage,last_status,lease_token FROM fair_micro_dispatcher_state").first(), { last_lane: "municipal", last_stage: "M", last_status: "ok", lease_token: null });
  } finally { await mf.dispose(); }
});

test("global lease makes a concurrent caller BUSY and stale lease is recoverable", async () => {
  const { mf, DB, env } = await setup(); try {
    const calls: string[] = [];
    let unblock: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const running = new Promise<void>((resolve) => { unblock = resolve; });
    const enteredRun = new Promise<void>((resolve) => { entered = resolve; });
    const blocking = { ...deps({ municipal: 1 }, calls), municipal: async () => {
      calls.push("municipal"); entered?.(); await running; return { stage: "M", status: "ok", job_id: "m" };
    } };
    const first = runFairMicroDispatcherOne(env, AT, blocking);
    await enteredRun;
    assert.equal((await runFairMicroDispatcherOne(env, AT, deps({ municipal: 1 }, calls))).status, "BUSY");
    unblock?.();
    assert.equal((await first).status, "DONE");
    await DB.prepare("UPDATE fair_micro_dispatcher_state SET lease_token='held',lease_until='2026-10-12T01:04:00.000Z'").run();
    assert.equal((await runFairMicroDispatcherOne(env, AT, deps({ municipal: 1 }, calls))).status, "BUSY");
    assert.equal((await runFairMicroDispatcherOne(env, "2026-10-12T01:05:00.000Z", deps({ municipal: 1 }, calls))).status, "DONE");
    assert.deepEqual(calls, ["municipal", "municipal"]);
  } finally { await mf.dispose(); }
});

test("future retry-equivalent empty lane is bypassed, and a failed lane releases the next turn", async () => {
  const { mf, env } = await setup(); try {
    const calls: string[] = [];
    assert.equal((await runFairMicroDispatcherOne(env, AT, deps({ official: 1 }, calls))).lane, "official");
    const failure = { ...deps({ municipal: 1, tourapi: 1 }, calls), municipal: async () => { calls.push("municipal"); throw new Error("isolated"); } };
    assert.equal((await runFairMicroDispatcherOne(env, "2026-10-12T01:01:00.000Z", failure)).status, "FAILED");
    assert.equal((await runFairMicroDispatcherOne(env, "2026-10-12T01:02:00.000Z", deps({ tourapi: 1 }, calls))).lane, "tourapi");
  } finally { await mf.dispose(); }
});

test("real future retries do not make official or TourAPI lanes ready", async () => {
  const { mf, DB, env } = await setup(); try {
    const future = "2026-10-12T02:00:00.000Z";
    await DB.batch([
      DB.prepare("INSERT INTO official_detail_jobs(event_id,generation,candidate_json,stage,available_at,created_at,updated_at,expires_at) VALUES('official',1,'{}','RETRY',?,?,?,?)").bind(future, AT, AT, "2026-10-13T01:00:00.000Z"),
      DB.prepare("INSERT INTO tourapi_detail_jobs(event_id,generation,candidate_json,stage,available_at,created_at,updated_at,expires_at) VALUES('tourapi',1,'{}','RETRY',?,?,?,?)").bind(future, AT, AT, "2026-10-13T01:00:00.000Z"),
    ]);
    const lanes = await fairMicroLaneReadiness(env, AT);
    assert.equal(lanes.official, 0);
    assert.equal(lanes.tourapi, 0);
  } finally { await mf.dispose(); }
});

test("cursor tie-break and starvation guard give all due lanes a turn without fixed one-to-one allocation", () => {
  const state = { lease_token: null, lease_until: null, dispatch_count: 11, cursor: 1, municipal_last_dispatch: 10, official_last_dispatch: -1, tourapi_last_dispatch: 10 };
  assert.equal(chooseFairMicroLane(state, { municipal: 1, official: 1, tourapi: 1 }), "official");
  const normal = { ...state, dispatch_count: 1, official_last_dispatch: 0, tourapi_last_dispatch: 0 };
  assert.equal(chooseFairMicroLane(normal, { municipal: 1, official: 50, tourapi: 2 }), "municipal");
  assert.equal(FAIR_DISPATCHER_MAX_GAP, 12);
});

test("all three due lanes progress while municipal receives its base share", async () => {
  const { mf, env } = await setup(); try {
    const calls: string[] = [];
    for (let index = 0; index < FAIR_DISPATCHER_MAX_GAP; index++)
      await runFairMicroDispatcherOne(env, new Date(Date.parse(AT) + index * 60_000).toISOString(), deps({ municipal: 1, official: 1, tourapi: 1 }, calls));
    assert.ok(calls.filter((lane) => lane === "municipal").length >= 8);
    assert.ok(calls.includes("official"));
    assert.ok(calls.includes("tourapi"));
  } finally { await mf.dispose(); }
});

test("throughput calculation retains municipal capacity and does not claim an unattainable freshness SLO", () => {
  assert.deepEqual(fairMicroThroughput(1435), { invocationsPerDay: 1435, municipalMinimum: 1076, municipalMaximumWhenOtherLanesIdle: 1435, eachNonMunicipalMinimumWhenDue: 119, maxDispatchGapPerDueLane: 12 });
});
