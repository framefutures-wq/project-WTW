import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  hasActiveMunicipalMicroWork,
  municipalOperatingDate,
  runMunicipalContinuousCycleOne,
} from "../worker/sources/municipal-continuous-cycle";
import {
  cleanupExpiredMunicipalScanJobs,
  enqueueMunicipalListPage,
  seedMunicipalDailyScanOne,
} from "../worker/sources/municipal";
import { MUNICIPAL_SOURCE_REGISTRY } from "../shared/municipal-source-registry";
import { municipalSourcePageUrls } from "../shared/municipal-pagination";

const AT = "2026-10-11T01:01:00.000Z";
const later = "2026-10-11T01:02:00.000Z";
const noWork = async () => ({
  stage: "NO_OP" as const,
  status: "empty",
  job_id: null,
});
const dependencies = { runMicro: noWork, seedOne: seedMunicipalDailyScanOne };

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
      .map((value) => value.trim())
      .filter(Boolean))
      await DB.prepare(sql).run();
  const env = {
    DB,
    APP_MODE: "production",
    TOUR_API_ENABLED: "false",
    ASSETS: {},
  } as never;
  return { mf, DB, env };
}

test("KST operating day crosses at 15:00 UTC", () => {
  assert.equal(
    municipalOperatingDate("2026-10-11T14:59:59.000Z"),
    "2026-10-11",
  );
  assert.equal(
    municipalOperatingDate("2026-10-11T15:00:00.000Z"),
    "2026-10-12",
  );
});

test("the registry worst-case cycle is bounded by one non-overlapping cursor", () => {
  const sources = MUNICIPAL_SOURCE_REGISTRY.length;
  const pages = MUNICIPAL_SOURCE_REGISTRY.reduce(
    (count, source) => count + (municipalSourcePageUrls(source)?.length ?? 0),
    0,
  );
  const candidates = sources * 25;
  const detailStages = candidates * 3;
  const workUnits = sources + pages + sources + candidates + detailStages;
  assert.deepEqual(
    { sources, pages, candidates, detailStages, workUnits },
    {
      sources: 36,
      pages: 56,
      candidates: 900,
      detailStages: 2700,
      workUnits: 3728,
    },
  );
  assert.ok((workUnits + 1) / 1435 < 3);
});

test("continuous cycle seeds one source, waits for drain, and advances its durable cursor", async () => {
  const { mf, DB, env } = await setup();
  try {
    const first = await runMunicipalContinuousCycleOne(env, AT, dependencies);
    assert.deepEqual(first, {
      stage: "SOURCE_SEED",
      operating_date: "2026-10-11",
      source_key: "paju",
      source_cursor: 0,
    });
    assert.equal(
      (
        await DB.prepare(
          "SELECT source_cursor FROM municipal_scan_cycles",
        ).first<{ source_cursor: number }>()
      )?.source_cursor,
      1,
    );
    assert.equal(
      (await runMunicipalContinuousCycleOne(env, later, dependencies)).stage,
      "WAITING_RETRY",
    );
    assert.equal(
      (
        await DB.prepare(
          "SELECT COUNT(*) AS n FROM municipal_scan_jobs",
        ).first<{ n: number }>()
      )?.n,
      1,
    );

    await DB.prepare(
      "UPDATE municipal_scan_jobs SET stage='DONE',candidate_batch_json=NULL,source_finalized_at=?",
    )
      .bind(later)
      .run();
    assert.equal(
      (await runMunicipalContinuousCycleOne(env, later, dependencies)).stage,
      "SOURCE_SEED",
    );
    assert.equal(
      (
        await DB.prepare(
          "SELECT source_cursor FROM municipal_scan_cycles",
        ).first<{ source_cursor: number }>()
      )?.source_cursor,
      2,
    );
    assert.equal(
      (
        await DB.prepare(
          "SELECT COUNT(*) AS n FROM municipal_scan_jobs",
        ).first<{ n: number }>()
      )?.n,
      2,
    );
  } finally {
    await mf.dispose();
  }
});

test("pending, finalize, and due retry stages block a new source", async () => {
  for (const stage of [
    "LIST_PENDING",
    "CANDIDATE_PENDING",
    "RETRY",
    "SOURCE_FINALIZE_PENDING",
    "FETCH_PENDING",
    "PARSE_PENDING",
    "PERSIST_PENDING",
    "DETAIL_RETRY",
  ]) {
    const { mf, DB, env } = await setup();
    try {
      await runMunicipalContinuousCycleOne(env, AT, dependencies);
      await DB.prepare(
        "UPDATE municipal_scan_jobs SET stage='DONE',source_finalized_at=?",
      )
        .bind(AT)
        .run();
      if (stage === "SOURCE_FINALIZE_PENDING")
        await DB.prepare(
          "UPDATE municipal_scan_jobs SET source_finalized_at=NULL,candidate_batch_json='[]'",
        ).run();
      else if (["LIST_PENDING", "CANDIDATE_PENDING"].includes(stage))
        await DB.prepare(
          "UPDATE municipal_scan_jobs SET stage=?,available_at='2099-01-01T00:00:00.000Z'",
        )
          .bind(stage)
          .run();
      else if (stage === "RETRY")
        await DB.prepare(
          "UPDATE municipal_scan_jobs SET stage='RETRY',available_at=?",
        )
          .bind(AT)
          .run();
      else {
        await DB.prepare(
          `INSERT INTO municipal_detail_jobs
           (id,source_key,candidate_id,event_id,official_url,candidate_json,stage,available_at,created_at,updated_at,expires_at)
           VALUES('detail-1','paju','candidate-1','event-1','https://tour.paju.go.kr/','{}',?,?,?,?,?)`,
        )
          .bind(
            stage === "DETAIL_RETRY" ? "RETRY" : stage,
            stage === "DETAIL_RETRY" ? AT : "2099-01-01T00:00:00.000Z",
            AT,
            AT,
            "2099-01-02T00:00:00.000Z",
          )
          .run();
      }
      assert.equal(await hasActiveMunicipalMicroWork(DB, AT), true, stage);
      assert.equal(
        (await runMunicipalContinuousCycleOne(env, later, dependencies)).stage,
        "WAITING_RETRY",
        stage,
      );
      assert.equal(
        (
          await DB.prepare(
            "SELECT source_cursor FROM municipal_scan_cycles",
          ).first<{ source_cursor: number }>()
        )?.source_cursor,
        1,
        stage,
      );
    } finally {
      await mf.dispose();
    }
  }
});

test("future retries do not block the next source, but become active when due", async () => {
  const { mf, DB, env } = await setup();
  try {
    await runMunicipalContinuousCycleOne(env, AT, dependencies);
    await DB.prepare(
      "UPDATE municipal_scan_jobs SET stage='RETRY',available_at=?,retry_at=?",
    )
      .bind("2026-10-11T02:00:00.000Z", "2026-10-11T02:00:00.000Z")
      .run();

    assert.equal(await hasActiveMunicipalMicroWork(DB, later), false);
    assert.equal(
      (await runMunicipalContinuousCycleOne(env, later, dependencies)).stage,
      "SOURCE_SEED",
    );
    assert.equal(
      (
        await DB.prepare(
          "SELECT source_cursor FROM municipal_scan_cycles",
        ).first<{ source_cursor: number }>()
      )?.source_cursor,
      2,
    );

    assert.equal(
      await hasActiveMunicipalMicroWork(DB, "2026-10-11T02:00:00.000Z"),
      true,
    );
    assert.equal(
      (
        await runMunicipalContinuousCycleOne(
          env,
          "2026-10-11T02:00:00.000Z",
          dependencies,
        )
      ).stage,
      "WAITING_RETRY",
    );
  } finally {
    await mf.dispose();
  }
});

test("one due micro unit returns before seed, and a leased duplicate invocation cannot seed", async () => {
  const { mf, DB, env } = await setup();
  try {
    const micro = {
      ...dependencies,
      runMicro: async () => ({
        stage: "LIST_PENDING" as const,
        status: "DONE",
        job_id: "job-1",
      }),
    };
    assert.deepEqual(await runMunicipalContinuousCycleOne(env, AT, micro), {
      stage: "MICRO",
      unit: "LIST_PENDING",
      status: "DONE",
      job_id: "job-1",
    });
    assert.equal(
      (
        await DB.prepare(
          "SELECT COUNT(*) AS n FROM municipal_scan_cycles",
        ).first<{ n: number }>()
      )?.n,
      0,
    );
    await runMunicipalContinuousCycleOne(env, AT, dependencies);
    await DB.prepare(
      "UPDATE municipal_scan_jobs SET stage='DONE',source_finalized_at=?",
    )
      .bind(AT)
      .run();
    await DB.prepare(
      "UPDATE municipal_scan_cycles SET lease_until='2099-01-01T00:00:00.000Z'",
    ).run();
    assert.equal(
      (await runMunicipalContinuousCycleOne(env, later, dependencies)).stage,
      "WAITING_CYCLE",
    );
    assert.equal(
      (
        await DB.prepare(
          "SELECT COUNT(*) AS n FROM municipal_scan_jobs",
        ).first<{ n: number }>()
      )?.n,
      1,
    );
  } finally {
    await mf.dispose();
  }
});

test("interrupted seed retries idempotently without advancing the cursor early", async () => {
  const { mf, DB, env } = await setup();
  try {
    let interrupted = false;
    const seedOne: typeof seedMunicipalDailyScanOne = async (db, input) => {
      if (!interrupted) {
        interrupted = true;
        await enqueueMunicipalListPage(db, {
          operatingDate: input.operatingDate,
          sourceKey: "paju",
          pageIndex: 1,
          now: input.now,
        });
        throw new Error("interrupted_seed");
      }
      return seedMunicipalDailyScanOne(db, input);
    };
    await assert.rejects(
      runMunicipalContinuousCycleOne(env, AT, { ...dependencies, seedOne }),
      /interrupted_seed/,
    );
    assert.equal(
      (
        await DB.prepare(
          "SELECT source_cursor FROM municipal_scan_cycles",
        ).first<{ source_cursor: number }>()
      )?.source_cursor,
      0,
    );
    assert.equal(
      (
        await DB.prepare(
          "SELECT COUNT(*) AS n FROM municipal_scan_jobs",
        ).first<{ n: number }>()
      )?.n,
      1,
    );
    await DB.prepare(
      "UPDATE municipal_scan_jobs SET stage='DONE',source_finalized_at=?",
    )
      .bind(AT)
      .run();
    assert.equal(
      (
        await runMunicipalContinuousCycleOne(env, later, {
          ...dependencies,
          seedOne,
        })
      ).stage,
      "SOURCE_SEED",
    );
    assert.equal(
      (
        await DB.prepare(
          "SELECT source_cursor FROM municipal_scan_cycles",
        ).first<{ source_cursor: number }>()
      )?.source_cursor,
      1,
    );
    assert.equal(
      (
        await DB.prepare(
          "SELECT COUNT(*) AS n FROM municipal_scan_jobs",
        ).first<{ n: number }>()
      )?.n,
      1,
    );
  } finally {
    await mf.dispose();
  }
});

test("three bounded seed failures record a skipped source and permit the next cursor", async () => {
  const { mf, DB, env } = await setup();
  try {
    const failing = {
      ...dependencies,
      seedOne: async () => {
        throw new Error("seed_unavailable");
      },
    } as typeof dependencies;
    await assert.rejects(
      runMunicipalContinuousCycleOne(env, AT, failing),
      /seed_unavailable/,
    );
    await assert.rejects(
      runMunicipalContinuousCycleOne(env, later, failing),
      /seed_unavailable/,
    );
    assert.equal(
      (
        await runMunicipalContinuousCycleOne(
          env,
          "2026-10-11T01:03:00.000Z",
          failing,
        )
      ).stage,
      "SOURCE_SKIPPED",
    );
    assert.deepEqual(
      await DB.prepare(
        "SELECT source_cursor,last_error_category FROM municipal_scan_cycles",
      ).first(),
      { source_cursor: 1, last_error_category: "source_seed_failed" },
    );
    assert.equal(
      (
        await runMunicipalContinuousCycleOne(
          env,
          "2026-10-11T01:04:00.000Z",
          dependencies,
        )
      ).stage,
      "SOURCE_SEED",
    );
  } finally {
    await mf.dispose();
  }
});

test("expired retry becomes terminal with safe error and the cycle proceeds", async () => {
  const { mf, DB, env } = await setup();
  try {
    await runMunicipalContinuousCycleOne(env, AT, dependencies);
    await DB.prepare(
      "UPDATE municipal_scan_jobs SET stage='RETRY',safe_error_category='list_page_failed',expires_at='2000-01-01T00:00:00.000Z'",
    ).run();
    assert.equal(
      (await cleanupExpiredMunicipalScanJobs(DB, later)).meta.changes,
      1,
    );
    assert.deepEqual(
      await DB.prepare(
        "SELECT stage,safe_error_category FROM municipal_scan_jobs WHERE source_key='paju'",
      ).first(),
      { stage: "DONE", safe_error_category: "terminal_list_page_failed" },
    );
    assert.equal(
      (await runMunicipalContinuousCycleOne(env, later, dependencies)).stage,
      "SOURCE_SEED",
    );
  } finally {
    await mf.dispose();
  }
});

test("last source finishes one cycle, same KST day stays done, next day starts source zero", async () => {
  const { mf, DB, env } = await setup();
  try {
    await runMunicipalContinuousCycleOne(env, AT, dependencies);
    await DB.prepare(
      "UPDATE municipal_scan_jobs SET stage='DONE',source_finalized_at=?",
    )
      .bind(AT)
      .run();
    await DB.prepare("UPDATE municipal_scan_cycles SET source_cursor=?")
      .bind(MUNICIPAL_SOURCE_REGISTRY.length)
      .run();
    assert.equal(
      (await runMunicipalContinuousCycleOne(env, later, dependencies)).stage,
      "CYCLE_DONE",
    );
    assert.equal(
      (await runMunicipalContinuousCycleOne(env, later, dependencies)).stage,
      "NO_OP",
    );
    const next = await runMunicipalContinuousCycleOne(
      env,
      "2026-10-11T15:01:00.000Z",
      dependencies,
    );
    assert.deepEqual(next, {
      stage: "SOURCE_SEED",
      operating_date: "2026-10-12",
      source_key: "paju",
      source_cursor: 0,
    });
    assert.equal(
      (
        await DB.prepare(
          "SELECT COUNT(*) AS n FROM municipal_scan_cycles",
        ).first<{ n: number }>()
      )?.n,
      2,
    );
  } finally {
    await mf.dispose();
  }
});
