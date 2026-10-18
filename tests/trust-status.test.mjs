import test from "node:test";
import assert from "node:assert/strict";
import {
  assessTrust,
  CORE,
  trustInsert,
} from "../scripts/trust-status-lib.mjs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
const event = {
  id: "synthetic",
  title: "행사",
  venue: "공원",
  address: "주소",
  start_date: "2026-10-01",
  end_date: "2026-10-02",
  primary_source_id: "s",
};
const audit = {
  id: "a",
  event_id: event.id,
  baseline_json: JSON.stringify({ event }),
  checked_at: "2026-09-19T00:00:00Z",
};
const link = {
  id: "l",
  audit_id: "a",
  official: 1,
  access_status: "ok",
  url: "https://example.org",
  excerpt: "합성 공식 근거",
  content_hash: "synthetic",
  checked_at: audit.checked_at,
};
const comparisons = CORE.map((field) => ({
  id: field,
  audit_id: "a",
  link_id: "l",
  field,
  result: "match",
  tourapi_value: event[field],
  official_value: event[field],
  excerpt: "합성 비교 근거",
  evidence_url: link.url,
  reason: "synthetic reviewed evidence",
  checked_at: audit.checked_at,
}));
const assess = (cs = comparisons, ls = [link], e = event, rs = {}) =>
  assessTrust(e, audit, ls, cs, rs);
test("TourAPI registration alone never confirms, payment flags are irrelevant", () => {
  assert.equal(assess([], []).trust_status, "needs_review");
  assert.equal(assess().trust_status, "confirmed");
  assert.equal(
    assess(comparisons, [link], {
      ...event,
      sponsored: true,
      cost: "paid",
      verification: "verified",
    }).trust_status,
    "confirmed",
  );
  assert(assess().unconfirmed_fields.includes("price"));
});
test("every core field required; noncomparable explicit value may establish missing field", () => {
  for (const f of CORE)
    assert.equal(
      assess(comparisons.filter((c) => c.field !== f)).trust_status,
      "needs_review",
    );
  assert.equal(
    assess(
      comparisons.map((c) =>
        c.field === "venue"
          ? { ...c, result: "not_comparable", tourapi_value: null }
          : c,
      ),
    ).trust_status,
    "confirmed",
  );
});
test("all access errors and uncertain officialness need review, never change", () => {
  for (const access_status of [
    "http_error",
    "network_error",
    "unsupported_content",
    "blocked_url",
    "too_large",
  ])
    assert.equal(
      assess(comparisons, [{ ...link, access_status }]).status_reason,
      "source_access_failed",
    );
  assert.equal(
    assess(comparisons, [{ ...link, official: null }]).status_reason,
    "officialness_unconfirmed",
  );
  assert.equal(
    assess(comparisons, [{ ...link, access_status: "ok", official: 0 }])
      .trust_status,
    "needs_review",
  );
});
test("formatting differences match, semantic venue differences require review", () => {
  const cs = comparisons.map((c) =>
    c.field === "venue"
      ? { ...c, result: "mismatch", official_value: "공 원" }
      : c,
  );
  assert.equal(assess(cs).trust_status, "confirmed");
  cs[3].official_value = "다른 구역 일원";
  assert.equal(assess(cs).status_reason, "semantic_review_required");
  const review = {
    ...cs[3],
    resolution: "material_change",
    reason: "합성 장소 이전 공지 검토",
  };
  assert.equal(
    assess(cs, [link], event, { venue: review }).trust_status,
    "changed",
  );
  assert.equal(
    assess(cs, [link], event, { venue: { ...review, excerpt: "stale" } })
      .trust_status,
    "needs_review",
  );
});
test("explicit date mismatch changes, stale baseline and conflicts block automatic conclusions", () => {
  const cs = comparisons.map((c) =>
    c.field === "start_date"
      ? { ...c, result: "mismatch", official_value: "2026-10-03" }
      : c,
  );
  assert.deepEqual(assess(cs).changed_fields, ["start_date"]);
  assert.equal(assess(cs).trust_status, "changed");
  assert.equal(
    assess(cs, [link], { ...event, start_date: "2026-10-04" }).status_reason,
    "baseline_changed",
  );
  assert.equal(
    assess([...cs, comparisons[1]]).status_reason,
    "semantic_review_required",
  );
  assert.equal(
    assess(cs.map((c) => ({ ...c, evidence_url: "https://unrelated.example" })))
      .trust_status,
    "needs_review",
  );
});
test("operational change requires semantic evidence review, absence is not cancellation", () => {
  const c = {
    ...comparisons[0],
    id: "cancel",
    field: "cancelled",
    result: "not_comparable",
    tourapi_value: null,
    official_value: "취소",
  };
  assert.equal(assess([...comparisons, c]).trust_status, "needs_review");
  assert.equal(
    assess([...comparisons, c], [link], event, {
      cancel: {
        ...c,
        resolution: "material_change",
        reason: "합성 해당 회차 취소 공지",
      },
    }).trust_status,
    "changed",
  );
});
test("D1 migrations and decisions persist independently without altering source records", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      compatibilityDate: "2026-09-18",
      d1Databases: ["DB"],
      cf: false,
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    for (const f of readdirSync("migrations").sort())
      for (const sql of readFileSync(`migrations/${f}`, "utf8")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean))
        await db.prepare(sql).run();
    await db
      .prepare(
        "INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES('s','tourapi',3,'synthetic','https://example.org','2026-09-19')",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,primary_source_id) VALUES('synthetic','행사','','서울','공원','주소','2026-10-01','2026-10-02','s')",
      )
      .run();
    const before = await db.prepare("SELECT * FROM events").all();
    await db
      .prepare(
        "INSERT INTO official_source_audits(id,run_id,event_id,origin_source_id,checked_at,baseline_json,detail_json,url_inventory_json,candidate_status) VALUES('a','run','synthetic','s',?,?, '{}','[]','candidates_found')",
      )
      .bind(audit.checked_at, audit.baseline_json)
      .run();
    await db
      .prepare(
        "INSERT INTO official_source_links(id,audit_id,url,source_types,checked_at,access_status,official,reason,excerpt,content_hash,provenance_json) VALUES('l','a','https://example.org','[\"event_official\"]',?,'ok',1,'synthetic','synthetic','synthetic','{}')",
      )
      .bind(audit.checked_at)
      .run();
    for (const decision of [assess(), assess([], []), assess()])
      await db.prepare(trustInsert(decision)).run();
    assert.equal(
      (await db.prepare("SELECT * FROM event_trust_status").all()).results
        .length,
      1,
    );
    assert.deepEqual(
      (await db.prepare("SELECT * FROM events").all()).results,
      before.results,
    );
    assert.deepEqual(
      (await db.prepare("PRAGMA foreign_key_check").all()).results,
      [],
    );
  } finally {
    await mf.dispose();
  }
});
