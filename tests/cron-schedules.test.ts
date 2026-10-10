import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import {
  BASE_SYNC_CRON,
  DETAIL_SYNC_CRON,
  DETAIL_RETRY_RECOVERY_CRONS,
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
  detail = {
    candidates: 1,
    requested: 3,
    attempts: 3,
    retry_attempted: 0,
    retry_recovered: 0,
    retry_exhausted: 0,
    enriched: 1,
    empty: 0,
    failed: 0,
    failure_reasons: {},
    failure_endpoints: {},
    network_failure_subtypes: {},
    failure_latency: {},
    retry_rounds: {},
  },
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
    runMunicipalAutonomous: async (_env, plan) => {
      calls.push(`municipal:${plan!.shardIndex}`);
      return { imported: 0 } as never;
    },
    runPrivateOfficialSources: async () => {
      calls.push("private");
      return { imported: 0 } as never;
    },
    runOfficialDetailRecovery: async () => {
      calls.push("official-detail");
      return {
        candidates: 1,
        attempted: 1,
        fetched: 1,
        recovered: 1,
        images_recovered: 1,
        detail_recovered: 1,
        title_mismatch: 0,
        core_conflict: 0,
        insufficient_core_signal: 0,
        empty: 0,
        fetch_failed: 0,
        fetch_failure_reasons: {},
        reader_attempts: 0,
        reader_successes: 0,
        reader_failures: 0,
        reader_failure_reasons: {},
      };
    },
    processPushDeliveries: async () => {
      calls.push("push");
      return { delivered: 0 } as never;
    },
  };
}
const baseTime = new Date("2026-09-21T01:00:00.000Z");
const detailTime = new Date("2026-09-21T02:00:00.000Z");

test("10:00 KST finalizes the TourAPI-only base before immediate detail handoff", async () => {
  const { mf, DB, env } = await setup();
  const calls: string[] = [];
  try {
    await runScheduled(
      env as never,
      BASE_SYNC_CRON,
      baseTime,
      dependencies(calls),
    );
    assert.deepEqual(calls, ["tourapi", "detail", "push"]);
    const runs = await DB.prepare(
      "SELECT provider,status,finished_at,message FROM sync_runs ORDER BY started_at,provider",
    ).all<{
      provider: string;
      status: string;
      finished_at: string | null;
      message: string | null;
    }>();
    assert.equal(runs.results.length, 2);
    assert.deepEqual(
      runs.results.map(({ provider, status }) => ({ provider, status })),
      [
        { provider: "tourapi", status: "success" },
        { provider: "tourapi-detail", status: "success" },
      ],
    );
    const detailRun = runs.results.find(
      (row) => row.provider === "tourapi-detail",
    );
    assert.equal(JSON.parse(detailRun!.message!).trigger, "base_handoff");
    const baseRun = runs.results.find((row) => row.provider === "tourapi");
    assert.ok(baseRun?.finished_at);
    assert.equal(
      Object.hasOwn(JSON.parse(baseRun!.message!), "official_detail_recovery"),
      false,
    );
    assert.equal(
      Object.hasOwn(JSON.parse(baseRun!.message!), "municipal"),
      false,
    );
    assert.equal(
      Object.hasOwn(JSON.parse(baseRun!.message!), "private"),
      false,
    );
  } finally {
    await mf.dispose();
  }
});

test("10:00 base does not call official detail, even if that dependency throws", async () => {
  const { mf, DB, env } = await setup();
  const calls: string[] = [];
  try {
    const deps = dependencies(calls);
    deps.runOfficialDetailRecovery = async () => {
      calls.push("official-detail");
      throw new Error("must not run in base");
    };
    const result = await runScheduled(
      env as never,
      BASE_SYNC_CRON,
      baseTime,
      deps,
    );
    assert.equal((result as { status?: string }).status, "success");
    assert.deepEqual(calls, ["tourapi", "detail", "push"]);
    assert.deepEqual(
      await DB.prepare(
        "SELECT status FROM sync_runs WHERE provider='tourapi'",
      ).first(),
      { status: "success" },
    );
  } finally {
    await mf.dispose();
  }
});

test("base upstream failure finalizes failed without official-detail recovery", async () => {
  const { mf, DB, env } = await setup();
  const calls: string[] = [];
  try {
    const deps = dependencies(calls);
    deps.syncTourApi = async () => {
      calls.push("tourapi");
      throw new Error("TourAPI unavailable");
    };
    await assert.rejects(
      runScheduled(env as never, BASE_SYNC_CRON, baseTime, deps),
    );
    assert.deepEqual(calls, ["tourapi", "push"]);
    const row = await DB.prepare(
      "SELECT status,finished_at,message FROM sync_runs WHERE provider='tourapi'",
    ).first<{ status: string; finished_at: string | null; message: string }>();
    assert.equal(row?.status, "failed");
    assert.ok(row?.finished_at);
    assert.equal(
      Object.hasOwn(JSON.parse(row!.message), "official_detail_recovery"),
      false,
    );
  } finally {
    await mf.dispose();
  }
});

test("11:00 KST runs municipal shard then detail after the same KST date base succeeds", async () => {
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
    assert.deepEqual(calls, ["municipal:0", "official-detail", "detail"]);
    const row = await DB.prepare(
      "SELECT provider,status,message FROM sync_runs WHERE provider='tourapi-detail'",
    ).first<{ provider: string; status: string; message: string }>();
    assert.equal(row?.status, "success");
    const message = JSON.parse(row!.message);
    assert.equal(message.trigger, "watchdog");
    assert.equal(message.requested, 3);
    assert.equal(message.official_detail_recovery.recovered, 1);
  } finally {
    await mf.dispose();
  }
});

test("retry recovery Cron runs detail with retry-due scope only", async () => {
  const { mf, DB, env } = await setup();
  const calls: string[] = [];
  try {
    await DB.prepare(
      "INSERT INTO sync_runs(id,started_at,finished_at,status,provider) VALUES('base',?,?, 'success','tourapi')",
    )
      .bind("2026-09-21T01:00:00.000Z", "2026-09-21T01:10:00.000Z")
      .run();
    const deps = dependencies(calls);
    let scope: string | undefined;
    deps.enrichTourApiDetails = async (_env, _now, options) => {
      scope = options?.candidateScope;
      calls.push("detail-retry");
      return {
        candidates: 0,
        requested: 0,
        attempts: 0,
        retry_attempted: 0,
        retry_recovered: 0,
        retry_exhausted: 0,
        enriched: 0,
        empty: 0,
        failed: 0,
        failure_reasons: {},
        failure_endpoints: {},
        network_failure_subtypes: {},
        failure_latency: {},
        retry_rounds: {},
      };
    };
    await runScheduled(
      env as never,
      DETAIL_RETRY_RECOVERY_CRONS[0],
      new Date("2026-09-21T02:45:00.000Z"),
      deps,
    );
    assert.deepEqual(calls, ["municipal:1", "official-detail", "detail-retry"]);
    assert.equal(scope, "retry_due");
    const row = await DB.prepare(
      "SELECT message FROM sync_runs WHERE provider='tourapi-detail'",
    ).first<{ message: string }>();
    const retryMessage = JSON.parse(row!.message);
    assert.equal(retryMessage.trigger, "retry_recovery");
    assert.equal(retryMessage.official_detail_recovery.recovered, 1);
  } finally {
    await mf.dispose();
  }
});

for (const [cron, timestamp, expectedCalls] of [
  [
    DETAIL_RETRY_RECOVERY_CRONS[1],
    "2026-09-21T04:50:00.000Z",
    ["municipal:2", "official-detail", "detail-retry"],
  ],
  [
    DETAIL_RETRY_RECOVERY_CRONS[2],
    "2026-09-21T08:55:00.000Z",
    ["official-detail", "private", "detail-retry"],
  ],
] as const) {
  test(`${cron} runs its isolated subsystem with official-detail and retry-due detail`, async () => {
    const { mf, DB, env } = await setup();
    const calls: string[] = [];
    try {
      await DB.prepare(
        "INSERT INTO sync_runs(id,started_at,finished_at,status,provider) VALUES('base',?,?, 'success','tourapi')",
      )
        .bind("2026-09-21T01:00:00.000Z", "2026-09-21T01:10:00.000Z")
        .run();
      const deps = dependencies(calls);
      deps.enrichTourApiDetails = async (_env, _now, options) => {
        assert.equal(options?.candidateScope, "retry_due");
        calls.push("detail-retry");
        return {
          candidates: 0,
          requested: 0,
          attempts: 0,
          retry_attempted: 0,
          retry_recovered: 0,
          retry_exhausted: 0,
          enriched: 0,
          empty: 0,
          failed: 0,
          failure_reasons: {},
          failure_endpoints: {},
          network_failure_subtypes: {},
          failure_latency: {},
          retry_rounds: {},
        };
      };
      await runScheduled(env as never, cron, new Date(timestamp), deps);
      assert.deepEqual(calls, expectedCalls);
    } finally {
      await mf.dispose();
    }
  });
}

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
      assert.deepEqual(calls, ["municipal:0", "official-detail"]);
      const row = await DB.prepare(
        "SELECT status,finished_at,message FROM sync_runs WHERE provider='tourapi-detail' ORDER BY rowid LIMIT 1",
      ).first<{
        status: string;
        finished_at: string | null;
        message: string;
      }>();
      assert.equal(row?.status, "skipped");
      assert.ok(row?.finished_at);
      assert.match(row!.message, /base_run_(missing|not_successful|running)/);
      const message = JSON.parse(row!.message);
      assert.equal(message.municipal.imported, 0);
      assert.equal(message.official_detail_recovery.recovered, 1);
    } finally {
      await mf.dispose();
    }
  });
}

test("immediate detail failure stays isolated and the 11:00 watchdog can retry", async () => {
  const { mf, DB, env } = await setup();
  const calls: string[] = [];
  try {
    const failing = dependencies(calls);
    failing.enrichTourApiDetails = async () => {
      calls.push("detail-failed");
      throw new Error("detail down");
    };
    const baseResult = await runScheduled(
      env as never,
      BASE_SYNC_CRON,
      baseTime,
      failing,
    );
    assert.equal((baseResult as { status?: string }).status, "success");
    assert.deepEqual(
      await DB.prepare(
        "SELECT status FROM sync_runs WHERE provider='tourapi' ORDER BY started_at DESC LIMIT 1",
      ).first(),
      { status: "success" },
    );
    assert.deepEqual(
      await DB.prepare(
        "SELECT status FROM sync_runs WHERE provider='tourapi-detail' ORDER BY started_at DESC LIMIT 1",
      ).first(),
      { status: "failed" },
    );

    const watchdogCalls: string[] = [];
    await runScheduled(
      env as never,
      DETAIL_SYNC_CRON,
      detailTime,
      dependencies(watchdogCalls),
    );
    assert.deepEqual(watchdogCalls, [
      "municipal:0",
      "official-detail",
      "detail",
    ]);
    const latest = await DB.prepare(
      "SELECT status,message FROM sync_runs WHERE provider='tourapi-detail' ORDER BY rowid DESC LIMIT 1",
    ).first<{ status: string; message: string }>();
    assert.equal(latest?.status, "success");
    assert.equal(JSON.parse(latest!.message).trigger, "watchdog");
  } finally {
    await mf.dispose();
  }
});

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

for (const [cron, timestamp, expectedCalls] of [
  [
    DETAIL_RETRY_RECOVERY_CRONS[1],
    "2026-09-21T04:50:00.000Z",
    ["municipal:2", "official-detail"],
  ],
  [
    DETAIL_RETRY_RECOVERY_CRONS[2],
    "2026-09-21T08:55:00.000Z",
    ["official-detail", "private"],
  ],
] as const) {
  test(`${cron} recovery retries official detail even when TourAPI base is unavailable`, async () => {
    const { mf, DB, env } = await setup();
    const calls: string[] = [];
    try {
      await runScheduled(
        env as never,
        cron,
        new Date(timestamp),
        dependencies(calls),
      );
      assert.deepEqual(calls, expectedCalls);
      const row = await DB.prepare(
        "SELECT status,message FROM sync_runs WHERE provider='tourapi-detail'",
      ).first<{ status: string; message: string }>();
      assert.equal(row?.status, "skipped");
      const message = JSON.parse(row!.message);
      assert.equal(message.reason, "base_run_missing");
      assert.equal(message.official_detail_recovery.recovered, 1);
    } finally {
      await mf.dispose();
    }
  });
}

test("municipal shard failure remains isolated from official-detail and TourAPI detail", async () => {
  const { mf, DB, env } = await setup();
  const calls: string[] = [];
  try {
    await DB.prepare(
      "INSERT INTO sync_runs(id,started_at,finished_at,status,provider) VALUES('base',?,?, 'success','tourapi')",
    )
      .bind("2026-09-21T01:00:00.000Z", "2026-09-21T01:10:00.000Z")
      .run();
    const deps = dependencies(calls);
    deps.runMunicipalAutonomous = async (_env, plan) => {
      calls.push(`municipal:${plan!.shardIndex}`);
      throw new Error("municipal down");
    };
    await runScheduled(env as never, DETAIL_SYNC_CRON, detailTime, deps);
    assert.deepEqual(calls, ["municipal:0", "official-detail", "detail"]);
    const row = await DB.prepare(
      "SELECT finished_at,message FROM sync_runs WHERE provider='tourapi-detail' ORDER BY rowid LIMIT 1",
    ).first<{ finished_at: string | null; message: string }>();
    assert.ok(row?.finished_at);
    assert.equal(JSON.parse(row!.message).municipal.status, "failed");
  } finally {
    await mf.dispose();
  }
});

test("17:55 private official failure remains isolated from official-detail and TourAPI retry detail", async () => {
  const { mf, DB, env } = await setup();
  const calls: string[] = [];
  try {
    await DB.prepare(
      "INSERT INTO sync_runs(id,started_at,finished_at,status,provider) VALUES('base',?,?, 'success','tourapi')",
    )
      .bind("2026-09-21T01:00:00.000Z", "2026-09-21T01:10:00.000Z")
      .run();
    const deps = dependencies(calls);
    deps.runPrivateOfficialSources = async () => {
      calls.push("private");
      throw new Error("private down");
    };
    await runScheduled(
      env as never,
      DETAIL_RETRY_RECOVERY_CRONS[2],
      new Date("2026-09-21T08:55:00.000Z"),
      deps,
    );
    assert.deepEqual(calls, ["official-detail", "private", "detail"]);
    const row = await DB.prepare(
      "SELECT finished_at,message FROM sync_runs WHERE provider='tourapi-detail' ORDER BY rowid LIMIT 1",
    ).first<{ finished_at: string | null; message: string }>();
    assert.ok(row?.finished_at);
    assert.equal(JSON.parse(row!.message).private.status, "failed");
  } finally {
    await mf.dispose();
  }
});

test("watchdog creates its invocation ledger before municipal work completes", async () => {
  const { mf, DB, env } = await setup();
  const calls: string[] = [];
  let releaseMunicipal!: () => void;
  const municipalGate = new Promise<void>((resolve) => {
    releaseMunicipal = resolve;
  });
  let municipalStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    municipalStarted = resolve;
  });
  try {
    const deps = dependencies(calls);
    deps.runMunicipalAutonomous = async (_env, plan) => {
      calls.push(`municipal:${plan!.shardIndex}`);
      municipalStarted();
      await municipalGate;
      return { imported: 0 } as never;
    };
    const run = runScheduled(env as never, DETAIL_SYNC_CRON, detailTime, deps);
    await started;
    const row = await DB.prepare(
      "SELECT status,finished_at,message FROM sync_runs WHERE provider='tourapi-detail' ORDER BY rowid LIMIT 1",
    ).first<{ status: string; finished_at: string | null; message: string }>();
    assert.equal(row?.status, "running");
    assert.equal(row?.finished_at, null);
    assert.deepEqual(JSON.parse(row!.message), {
      trigger: "watchdog",
      ledger: "scheduled_window",
      phase: "municipal",
    });
    releaseMunicipal();
    await run;
  } finally {
    await mf.dispose();
  }
});

test("official-detail failure finalizes the watchdog ledger and keeps detail running", async () => {
  const { mf, DB, env } = await setup();
  const calls: string[] = [];
  try {
    await DB.prepare(
      "INSERT INTO sync_runs(id,started_at,finished_at,status,provider) VALUES('base',?,?, 'success','tourapi')",
    )
      .bind("2026-09-21T01:00:00.000Z", "2026-09-21T01:10:00.000Z")
      .run();
    const deps = dependencies(calls);
    deps.runOfficialDetailRecovery = async () => {
      calls.push("official-detail");
      throw new Error("official detail down");
    };
    await runScheduled(env as never, DETAIL_SYNC_CRON, detailTime, deps);
    assert.deepEqual(calls, ["municipal:0", "official-detail", "detail"]);
    const row = await DB.prepare(
      "SELECT status,finished_at,message FROM sync_runs WHERE provider='tourapi-detail' ORDER BY rowid LIMIT 1",
    ).first<{ status: string; finished_at: string | null; message: string }>();
    assert.equal(row?.status, "success");
    assert.ok(row?.finished_at);
    assert.equal(
      JSON.parse(row!.message).official_detail_recovery.status,
      "failed",
    );
  } finally {
    await mf.dispose();
  }
});

test("a stale scheduled-window ledger does not block the next retry window", async () => {
  const { mf, DB, env } = await setup();
  const calls: string[] = [];
  try {
    await DB.prepare(
      "INSERT INTO sync_runs(id,started_at,finished_at,status,provider) VALUES('base',?,?, 'success','tourapi')",
    )
      .bind("2026-09-21T01:00:00.000Z", "2026-09-21T01:10:00.000Z")
      .run();
    await DB.prepare(
      "INSERT INTO sync_runs(id,started_at,status,provider,message) VALUES('old-window',?,'running','tourapi-detail',?)",
    )
      .bind(
        "2026-09-21T02:00:00.000Z",
        JSON.stringify({ ledger: "scheduled_window", trigger: "watchdog" }),
      )
      .run();
    await runScheduled(
      env as never,
      DETAIL_RETRY_RECOVERY_CRONS[0],
      new Date("2026-09-21T02:45:00.000Z"),
      dependencies(calls),
    );
    assert.deepEqual(calls, ["municipal:1", "official-detail", "detail"]);
  } finally {
    await mf.dispose();
  }
});

test("a real in-flight TourAPI detail run still skips only detail, not scheduled subsystems", async () => {
  const { mf, DB, env } = await setup();
  const calls: string[] = [];
  try {
    await DB.prepare(
      "INSERT INTO sync_runs(id,started_at,finished_at,status,provider) VALUES('base',?,?, 'success','tourapi')",
    )
      .bind("2026-09-21T01:00:00.000Z", "2026-09-21T01:10:00.000Z")
      .run();
    await DB.prepare(
      "INSERT INTO sync_runs(id,started_at,status,provider) VALUES('detail-lock',?,'running','tourapi-detail')",
    )
      .bind("2026-09-21T01:55:00.000Z")
      .run();
    await runScheduled(
      env as never,
      DETAIL_SYNC_CRON,
      detailTime,
      dependencies(calls),
    );
    assert.deepEqual(calls, ["municipal:0", "official-detail"]);
    const row = await DB.prepare(
      "SELECT status,finished_at,message FROM sync_runs WHERE id!='detail-lock' AND provider='tourapi-detail' ORDER BY rowid LIMIT 1",
    ).first<{ status: string; finished_at: string | null; message: string }>();
    assert.equal(row?.status, "skipped");
    assert.ok(row?.finished_at);
    assert.equal(JSON.parse(row!.message).reason, "detail_already_running");
  } finally {
    await mf.dispose();
  }
});
