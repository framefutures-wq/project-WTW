import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import {
  BASE_SYNC_CRON,
  DETAIL_SYNC_CRON,
  runScheduled,
  type ScheduledDependencies,
} from "../worker/cron";

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
      .map((part) => part.trim())
      .filter(Boolean))
      await DB.prepare(sql).run();
  return {
    mf,
    DB,
    env: {
      DB,
      APP_MODE: "production",
      TOUR_API_ENABLED: "true",
      TOUR_API_KEY: "test",
      ASSETS: {},
      WEB_PUSH_ENABLED: "false",
    },
  };
}
function dependencies(
  calls: string[],
  detail = { candidates: 1, requested: 3, enriched: 1, empty: 0, failed: 0 },
): ScheduledDependencies {
  return {
    syncTourApi: async () => {
      calls.push("tourapi");
      return { imported: 1 } as never;
    },
    enrichTourApiDetails: async () => {
      calls.push("detail");
      return detail;
    },
    runMunicipalAutonomous: async () => {
      calls.push("municipal");
      return { imported: 0 } as never;
    },
    runPrivateOfficialSources: async () => {
      calls.push("private");
      return { imported: 0 } as never;
    },
    processPushDeliveries: async () => {
      calls.push("push");
      return { delivered: 0 } as never;
    },
  };
}
const baseTime = new Date("2026-09-21T01:00:00.000Z");
const detailTime = new Date("2026-09-21T02:00:00.000Z");

test("10:00 KST runs base ingestion, official sources, and push without detail", async () => {
  const { mf, DB, env } = await setup();
  const calls: string[] = [];
  try {
    await runScheduled(
      env as never,
      BASE_SYNC_CRON,
      baseTime,
      dependencies(calls),
    );
    assert.deepEqual(calls, ["tourapi", "municipal", "private", "push"]);
    assert.deepEqual(
      await DB.prepare("SELECT provider,status FROM sync_runs").first(),
      { provider: "tourapi", status: "success" },
    );
  } finally {
    await mf.dispose();
  }
});

test("11:00 KST runs detail only after the same KST date base succeeds", async () => {
  const { mf, DB, env } = await setup();
  const calls: string[] = [];
  try {
    await DB.prepare(
      "INSERT INTO sync_runs(id,started_at,finished_at,status,provider) VALUES('base',?,?, 'success','tourapi')",
    )
      .bind("2026-09-21T01:00:00.000Z", "2026-09-21T01:10:00.000Z")
      .run();
    await runScheduled(
      env as never,
      DETAIL_SYNC_CRON,
      detailTime,
      dependencies(calls),
    );
    assert.deepEqual(calls, ["detail"]);
    const row = await DB.prepare(
      "SELECT provider,status,message FROM sync_runs WHERE provider='tourapi-detail'",
    ).first<{ provider: string; status: string; message: string }>();
    assert.equal(row?.status, "success");
    assert.equal(JSON.parse(row!.message).requested, 3);
  } finally {
    await mf.dispose();
  }
});

for (const [name, status] of [
  ["missing", null],
  ["failed", "failed"],
  ["running", "running"],
] as const) {
  test(`11:00 KST safely skips detail when base is ${name}`, async () => {
    const { mf, DB, env } = await setup();
    const calls: string[] = [];
    try {
      if (status)
        await DB.prepare(
          "INSERT INTO sync_runs(id,started_at,status,provider) VALUES('base',? ,?,'tourapi')",
        )
          .bind("2026-09-21T01:00:00.000Z", status)
          .run();
      await runScheduled(
        env as never,
        DETAIL_SYNC_CRON,
        detailTime,
        dependencies(calls),
      );
      assert.deepEqual(calls, []);
      const row = await DB.prepare(
        "SELECT status,message FROM sync_runs WHERE provider='tourapi-detail'",
      ).first<{ status: string; message: string }>();
      assert.equal(row?.status, "skipped");
      assert.match(row!.message, /base_run_(missing|not_successful|running)/);
    } finally {
      await mf.dispose();
    }
  });
}

test("unknown cron is fail-closed and detail failure does not block the next base run", async () => {
  const { mf, DB, env } = await setup();
  const calls: string[] = [];
  try {
    await runScheduled(
      env as never,
      "0 21 * * *",
      detailTime,
      dependencies(calls),
    );
    assert.equal(
      (
        await DB.prepare("SELECT count(*) AS n FROM sync_runs").first<{
          n: number;
        }>()
      )?.n,
      0,
    );
    await DB.prepare(
      "INSERT INTO sync_runs(id,started_at,finished_at,status,provider) VALUES('base',?,?, 'success','tourapi')",
    )
      .bind("2026-09-21T01:00:00.000Z", "2026-09-21T01:10:00.000Z")
      .run();
    const failingDependencies = dependencies(calls);
    failingDependencies.enrichTourApiDetails = async () => {
      throw new Error("detail down");
    };
    await assert.rejects(
      runScheduled(
        env as never,
        DETAIL_SYNC_CRON,
        detailTime,
        failingDependencies,
      ),
    );
    await runScheduled(
      env as never,
      BASE_SYNC_CRON,
      new Date("2026-09-22T01:00:00.000Z"),
      dependencies(calls),
    );
    assert(calls.includes("tourapi"));
  } finally {
    await mf.dispose();
  }
});
