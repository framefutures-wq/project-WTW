import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { runMunicipalCandidateOne } from "../worker/sources/municipal.ts";

const LIST_URL = "https://tour.paju.go.kr/user/link/cultural/BD_index.do";
const TODAY = new Date().toISOString().slice(0, 10);
const FUTURE = `${Number(TODAY.slice(0, 4)) + 1}-10-03`;
const envFor = (DB) => ({
  DB,
  APP_MODE: "production",
  TOUR_API_ENABLED: "false",
  ASSETS: {},
});

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
    const event = await DB.prepare(
      "SELECT id,title,region,venue,start_date,end_date,verification FROM events WHERE id=?",
    )
      .bind(result.candidate_id)
      .first();
    assert.equal(event.title, "2027 제1회 파주 시민문화축제 core-proof");
    assert.equal(event.verification, "verified");
    const source = await DB.prepare(
      "SELECT kind,priority,url FROM sources WHERE id=?",
    )
      .bind(`municipal-source-${result.candidate_id}`)
      .first();
    assert.deepEqual(source, {
      kind: "municipality",
      priority: 2,
      url: LIST_URL,
    });
    const evidence = await DB.prepare(
      "SELECT field,excerpt FROM event_evidence WHERE event_id=? ORDER BY field",
    )
      .bind(result.candidate_id)
      .all();
    assert.deepEqual(
      evidence.results.map((row) => row.field),
      ["schedule", "status", "venue"],
    );
    const state = await DB.prepare(
      "SELECT decision_state,source_key,source_candidate_id FROM municipal_candidate_state WHERE candidate_id=?",
    )
      .bind(result.candidate_id)
      .first();
    assert.deepEqual(state, {
      decision_state: "AUTO_PUBLISH",
      source_key: "paju",
      source_candidate_id: "core-proof",
    });
  } finally {
    await mf.dispose();
  }
});

test("existing identity is stable on rerun; changed core waits for a later observation", async () => {
  const { mf, DB } = await setup();
  try {
    const original = candidate("stable");
    const first = await run(DB, original);
    const repeated = await run(DB, original);
    assert.equal(repeated.candidate_id, first.candidate_id);
    assert.equal(repeated.decision, "AUTO_PUBLISH");
    assert.equal(
      (
        await DB.prepare("SELECT COUNT(*) AS count FROM events WHERE id=?")
          .bind(first.candidate_id)
          .first()
      ).count,
      1,
    );
    const changed = await run(
      DB,
      candidate("stable", { venue: "파주 임진각 평화누리" }),
    );
    assert.equal(changed.decision, "AUTO_RETRY");
    assert.equal(changed.reason, "core_conflict");
    assert.equal(
      (
        await DB.prepare("SELECT venue FROM events WHERE id=?")
          .bind(first.candidate_id)
          .first()
      ).venue,
      "임진각 평화누리",
    );
  } finally {
    await mf.dispose();
  }
});

test("generic candidate bridges to one existing municipal identity before state/detail handoff", async () => {
  const { mf, DB } = await setup();
  try {
    const value = candidate("new-normalized-id", {
      title: "2027 제1회 파주 시민문화축제 identity-bridge",
      official_url:
        "https://tour.paju.go.kr/user/link/cultural/BD_view.do?idx=999002",
    });
    const legacyId = "municipal-paju-legacy-stable-id";
    await DB.prepare(
      "INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES('legacy-source','municipality',2,'legacy',?,?)",
    )
      .bind(LIST_URL, `${TODAY}T00:00:00Z`)
      .run();
    await DB.prepare(
      "INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,cost,pet_policy,status,verification,is_sample,primary_source_id,checked_at) VALUES(?,?,'legacy','경기','임진각 평화누리','임진각 평화누리',?,?, 'unknown','unknown','scheduled','verified',0,'legacy-source',?)",
    )
      .bind(legacyId, value.title, FUTURE, FUTURE, `${TODAY}T00:00:00Z`)
      .run();
    const result = await run(DB, value, { mode: "generic_html" });
    assert.equal(result.candidate_id, legacyId);
    assert.equal(result.detail_required, true);
    assert.equal(
      (
        await DB.prepare(
          "SELECT candidate_id,event_id FROM municipal_detail_jobs WHERE candidate_id=?",
        )
          .bind("new-normalized-id")
          .first()
      ).event_id,
      legacyId,
    );
    assert.equal(
      (
        await DB.prepare(
          "SELECT candidate_id,decision_state FROM municipal_candidate_state WHERE candidate_id=?",
        )
          .bind(legacyId)
          .first()
      ).decision_state,
      "AUTO_RETRY",
    );
    assert.equal(
      (
        await DB.prepare(
          "SELECT COUNT(*) AS count FROM events WHERE id LIKE 'municipal-paju-%'",
        ).first()
      ).count,
      1,
    );
  } finally {
    await mf.dispose();
  }
});

test("external duplicate, invalid core, expired candidate and publish cap fail closed", async () => {
  const { mf, DB } = await setup();
  try {
    const duplicateCandidate = candidate("dupe");
    await DB.prepare(
      "INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES('existing-source','municipality',2,'existing',?,?)",
    )
      .bind(LIST_URL, `${TODAY}T00:00:00Z`)
      .run();
    await DB.prepare(
      "INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,cost,pet_policy,status,verification,is_sample,primary_source_id,checked_at) VALUES('existing-event',?,'x','경기','임진각 평화누리','임진각 평화누리',?,?, 'unknown','unknown','scheduled','verified',0,'existing-source',?)",
    )
      .bind(duplicateCandidate.title, FUTURE, FUTURE, `${TODAY}T00:00:00Z`)
      .run();
    assert.equal((await run(DB, duplicateCandidate)).decision, "AUTO_EXCLUDE");
    assert.equal(
      (await run(DB, candidate("invalid", { venue: null }))).decision,
      "AUTO_RETRY",
    );
    assert.equal(
      (
        await run(
          DB,
          candidate("expired", {
            start_date: "2020-01-01",
            end_date: "2020-01-01",
          }),
        )
      ).decision,
      "EXPIRED",
    );
    assert.equal(
      (
        await run(DB, candidate("capped"), {
          publishMutations: 10,
          maxPublishMutations: 10,
        })
      ).reason,
      "daily_publish_circuit_breaker",
    );
    assert.equal(
      (
        await DB.prepare(
          "SELECT COUNT(*) AS count FROM events WHERE title LIKE '%capped'",
        ).first()
      ).count,
      0,
    );
  } finally {
    await mf.dispose();
  }
});

test("new generic candidate checkpoints official detail without creating an event", async () => {
  const { mf, DB } = await setup();
  const priorFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error("unexpected_network");
  };
  try {
    const value = candidate("detail-required", {
      official_url:
        "https://tour.paju.go.kr/user/link/cultural/BD_view.do?idx=987654",
    });
    const first = await run(DB, value, { mode: "generic_html" });
    assert.equal(first.decision, "AUTO_RETRY");
    assert.equal(first.detail_required, true);
    assert.equal(fetches, 0);
    const jobs = await DB.prepare(
      "SELECT candidate_id,stage FROM municipal_detail_jobs WHERE candidate_id=?",
    )
      .bind("detail-required")
      .all();
    assert.deepEqual(
      jobs.results.map((job) => ({
        candidate_id: job.candidate_id,
        stage: job.stage,
      })),
      [{ candidate_id: "detail-required", stage: "FETCH_PENDING" }],
    );
  } finally {
    globalThis.fetch = priorFetch;
    await mf.dispose();
  }
});

test("generic list-page fallback does not enter the detail checkpoint", async () => {
  const { mf, DB } = await setup();
  try {
    const result = await run(DB, candidate("list-page-only"), {
      mode: "generic_html",
    });
    assert.equal(result.decision, "AUTO_RETRY");
    assert.equal(result.detail_required, false);
    assert.equal(
      (
        await DB.prepare(
          "SELECT COUNT(*) AS count FROM municipal_detail_jobs",
        ).first()
      ).count,
      0,
    );
  } finally {
    await mf.dispose();
  }
});

test("Taebaek self-contained exhibition core publishes without inventing a detail job", async () => {
  const { mf, DB } = await setup();
  try {
    const value = candidate("schedule-5460", {
      source: "taebaek",
      title: "권중모 개인전시회",
      region: "강원",
      locality: "태백",
      venue: "태백문화예술회관 전시컨벤션홀",
      official_url:
        "https://www.taebaek.go.kr/www/selectWebScheduleUserList.do?key=1502",
      category: "공식 일정표 행사",
      self_contained_core_evidence: "taebaek_schedule_block",
    });
    const result = await run(DB, value, { mode: "generic_html" });
    assert.equal(result.decision, "AUTO_PUBLISH");
    assert.equal(result.inserted, 1);
    assert.equal(result.detail_required, false);
    assert.equal(
      (
        await DB.prepare(
          "SELECT COUNT(*) AS count FROM municipal_detail_jobs",
        ).first()
      ).count,
      0,
    );
  } finally {
    await mf.dispose();
  }
});

test("Taebaek verified schedule corrects one contact-contaminated legacy public event after a later KST observation", async () => {
  const { mf, DB } = await setup();
  try {
    const url =
      "https://www.taebaek.go.kr/www/selectWebScheduleUserList.do?key=1502";
    const legacyId = "municipal-taebaek-legacy-very-long-public-identity";
    const value = candidate("schedule-5460", {
      source: "taebaek",
      title: "권중모 개인전시회",
      region: "강원",
      locality: "태백",
      venue: "전시컨벤션홀",
      official_url: url,
      category: "공식 일정표 행사",
      self_contained_core_evidence: "taebaek_schedule_block",
    });
    await DB.prepare(
      "INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES('legacy-taebaek-source','municipality',2,'태백시',?,?)",
    )
      .bind(url, "2026-09-19T00:00:00.000Z")
      .run();
    await DB.prepare(
      "INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,cost,pet_policy,status,verification,is_sample,primary_source_id,checked_at) VALUES(?,?,'legacy','강원','전시컨벤션홀 문 의: 01052892663','전시컨벤션홀 문 의: 01052892663',?,?, 'unknown','unknown','scheduled','verified',0,'legacy-taebaek-source',?)",
    )
      .bind(legacyId, value.title, FUTURE, FUTURE, "2026-09-19T00:00:00.000Z")
      .run();
    await DB.prepare(
      "INSERT INTO event_evidence(event_id,source_id,field,excerpt,checked_at) VALUES(?,?,?,?,?)",
    )
      .bind(
        legacyId,
        "legacy-taebaek-source",
        "venue",
        "legacy evidence",
        "2026-09-19T00:00:00.000Z",
      )
      .run();
    await DB.prepare(
      "INSERT INTO alert_events(id,event_id,alert_type,dedupe_key,created_at,effective_at,source_id) VALUES('legacy-alert',?,'NEW_EVENT','legacy-alert',?,?,?)",
    )
      .bind(
        legacyId,
        "2026-09-19T00:00:00.000Z",
        "2026-09-19T00:00:00.000Z",
        "legacy-taebaek-source",
      )
      .run();

    const first = await run(DB, value, {
      mode: "generic_html",
      now: "2026-09-20T03:00:00.000Z",
      koreaToday: "2026-09-20",
    });
    assert.deepEqual(
      [first.candidate_id, first.decision, first.reason, first.updated],
      [legacyId, "AUTO_RETRY", "core_conflict", 0],
    );
    assert.equal(
      (
        await DB.prepare("SELECT venue FROM events WHERE id=?")
          .bind(legacyId)
          .first()
      ).venue,
      "전시컨벤션홀 문 의: 01052892663",
    );

    const second = await run(DB, value, {
      mode: "generic_html",
      now: "2026-09-21T03:00:00.000Z",
      koreaToday: "2026-09-21",
    });
    assert.deepEqual(
      [second.candidate_id, second.decision, second.updated],
      [legacyId, "AUTO_PUBLISH", 1],
    );
    assert.deepEqual(
      await DB.prepare("SELECT venue FROM events WHERE id=?")
        .bind(legacyId)
        .first(),
      { venue: "전시컨벤션홀" },
    );
    assert.equal(
      (
        await DB.prepare("SELECT COUNT(*) AS count FROM events WHERE title=?")
          .bind(value.title)
          .first()
      ).count,
      1,
    );
    assert.equal(
      (
        await DB.prepare(
          "SELECT COUNT(*) AS count FROM event_evidence WHERE event_id=? AND source_id='legacy-taebaek-source'",
        )
          .bind(legacyId)
          .first()
      ).count,
      1,
    );
    assert.equal(
      (
        await DB.prepare(
          "SELECT COUNT(*) AS count FROM alert_events WHERE event_id=?",
        )
          .bind(legacyId)
          .first()
      ).count,
      1,
    );
  } finally {
    await mf.dispose();
  }
});

test("Taebaek legacy correction holds when the match is ambiguous or schedule evidence is missing", async () => {
  const { mf, DB } = await setup();
  try {
    const url =
      "https://www.taebaek.go.kr/www/selectWebScheduleUserList.do?key=1502";
    const value = candidate("schedule-5460", {
      source: "taebaek",
      title: "권중모 개인전시회",
      region: "강원",
      locality: "태백",
      venue: "전시컨벤션홀",
      official_url: url,
      category: "공식 일정표 행사",
      self_contained_core_evidence: "taebaek_schedule_block",
    });
    await DB.prepare(
      "INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES('legacy-taebaek-source','municipality',2,'태백시',?,?)",
    )
      .bind(url, "2026-09-19T00:00:00.000Z")
      .run();
    for (const id of ["taebaek-legacy-a", "taebaek-legacy-b"])
      await DB.prepare(
        "INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,cost,pet_policy,status,verification,is_sample,primary_source_id,checked_at) VALUES(?,?,'legacy','강원','전시컨벤션홀 문 의: 01052892663','전시컨벤션홀 문 의: 01052892663',?,?, 'unknown','unknown','scheduled','verified',0,'legacy-taebaek-source',?)",
      )
        .bind(id, value.title, FUTURE, FUTURE, "2026-09-19T00:00:00.000Z")
        .run();
    const ambiguous = await run(DB, value, { mode: "generic_html" });
    assert.deepEqual(
      [
        ambiguous.decision,
        ambiguous.reason,
        ambiguous.inserted,
        ambiguous.updated,
      ],
      ["AUTO_RETRY", "taebaek_legacy_identity_ambiguous", 0, 0],
    );
    assert.equal(
      (
        await DB.prepare(
          "SELECT COUNT(*) AS count FROM events WHERE id LIKE 'municipal-taebaek-schedule-5460%'",
        ).first()
      ).count,
      0,
    );

    const missingEvidence = await run(
      DB,
      {
        ...value,
        source_candidate_id: "schedule-without-proof",
        self_contained_core_evidence: undefined,
      },
      { mode: "generic_html" },
    );
    assert.deepEqual(
      [
        missingEvidence.decision,
        missingEvidence.reason,
        missingEvidence.inserted,
        missingEvidence.updated,
      ],
      ["AUTO_RETRY", "taebaek_schedule_core_unverified", 0, 0],
    );
  } finally {
    await mf.dispose();
  }
});
