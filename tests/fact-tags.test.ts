import test from "node:test";
import assert from "node:assert/strict";
import { classifyFactTags, FACT_TAGS } from "../shared/fact-tags";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { saveFestivalSnapshot } from "../worker/sources/tourapi";

const docs = (text: string, field = "program") => [{ text, field, source: "tourapi-source", scope: "program_level", strength: "direct_field" }];

test("fact rules keep positive, negative, conditional and conflict evidence deterministic", () => {
  const positive = classifyFactTags({ id: "e", title: "행사" }, docs("불꽃놀이 공연과 체험 프로그램"));
  assert.deepEqual([...positive.tags.keys()].sort(), ["experience", "fireworks", "performance"]);
  const negative = classifyFactTags({ id: "e", title: "행사" }, docs("푸드트럭은 운영하지 않습니다. 반려동물 동반 불가"));
  assert.equal(negative.tags.has("food"), false);
  assert.equal(negative.tags.has("pet_allowed"), false);
  const conditional = classifyFactTags({ id: "e", title: "행사" }, docs("불꽃놀이는 우천 시 취소될 수 있습니다"));
  assert.equal(conditional.tags.has("fireworks"), true);
  assert.equal(conditional.conditional.length, 1);
  const conflict = classifyFactTags({ id: "e", title: "행사" }, [...docs("공연"), ...docs("공연 취소")]);
  assert.equal(conflict.conflicts.length, 1);
  assert.equal(FACT_TAGS.includes("parking" as never), false);
  assert.equal(FACT_TAGS.includes("pet_not_allowed" as never), false);
});

async function setup() {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', compatibilityDate: "2026-09-18", d1Databases: ["DB"], cf: false }));
  const db = await mf.getD1Database("DB");
  for (const file of readdirSync("migrations").sort()) for (const sql of readFileSync(`migrations/${file}`, "utf8").split(";").map((x) => x.trim()).filter(Boolean)) await db.prepare(sql).run();
  return { mf, db };
}
const event = (title: string) => ({ id: "tourapi-fact-1", title, description: "TourAPI", region: "서울", venue: "공원", address: "서울 공원", start_date: "2026-10-01", end_date: "2026-10-02", lat: null, lng: null, cost: "unknown" as const, price_text: null, pet_policy: "unknown" as const, status: "unknown" as const, checked_at: "2026-09-19T00:00:00.000Z", progress: "" });
const snapshot = (e: ReturnType<typeof event>, raw: Record<string, unknown>, checkedAt: string) => ({ candidates: [{ event: e, raw }], rejected: 0, fetched: 1, today: "2026-10-01", until: "2026-10-31", checkedAt });

test("new and changed events are classified atomically; unchanged events are not rebuilt", async () => {
  const { mf, db } = await setup();
  try {
    const first = event("불꽃 행사 공연");
    const raw1 = { title: first.title, eventstartdate: "20261001", eventenddate: "20261002", addr1: "서울 공원", progresstype: "" };
    await saveFestivalSnapshot(db, snapshot(first, raw1, "2026-09-19T00:00:00.000Z") as never);
    let rows = (await db.prepare("SELECT tag,classifier_type,rule_version FROM event_tags WHERE event_id=?").bind(first.id).all()).results;
    assert.deepEqual(rows.map((r) => r.tag).sort(), ["fireworks", "performance"]);
    assert(rows.every((r) => r.classifier_type === "deterministic_rule" && r.rule_version === "fact_rules_v1"));
    let companions = (await db.prepare("SELECT companion_type,suitability_state FROM event_companion_suitability WHERE event_id=? ORDER BY companion_type").bind(first.id).all()).results;
    assert.deepEqual(companions, [
      { companion_type: "child", suitability_state: "unknown" },
      { companion_type: "couple", suitability_state: "unknown" },
      { companion_type: "parents", suitability_state: "unknown" },
      { companion_type: "pet", suitability_state: "unknown" },
    ]);
    await db.prepare("INSERT INTO event_tags(event_id,tag) VALUES(?,?)").bind(first.id, "food").run();
    const second = event("전시회");
    const raw2 = { ...raw1, title: second.title };
    await saveFestivalSnapshot(db, snapshot(second, raw2, "2026-09-19T00:01:00.000Z") as never);
    rows = (await db.prepare("SELECT tag,classifier_type FROM event_tags WHERE event_id=? ORDER BY classifier_type,tag").bind(first.id).all()).results;
    assert.deepEqual(rows, [{ tag: "exhibition", classifier_type: "deterministic_rule" }, { tag: "food", classifier_type: "legacy" }]);
    companions = (await db.prepare("SELECT companion_type,suitability_state FROM event_companion_suitability WHERE event_id=? ORDER BY companion_type").bind(first.id).all()).results;
    assert.equal(companions.find((row) => row.companion_type === "couple")?.suitability_state, "unknown");
    await db.prepare("UPDATE event_companion_suitability SET classifier_type='manual_override',suitability_state='fit' WHERE event_id=? AND companion_type='pet'").bind(first.id).run();
    await db.prepare("INSERT INTO event_tags(event_id,tag,classifier_type,rule_version) VALUES(?,?,?,?)").bind(first.id, "experience", "deterministic_rule", "fact_rules_v1").run();
    await saveFestivalSnapshot(db, snapshot(second, raw2, "2026-09-19T00:02:00.000Z") as never);
    rows = (await db.prepare("SELECT tag,classifier_type FROM event_tags WHERE event_id=? ORDER BY classifier_type,tag").bind(first.id).all()).results;
    assert.deepEqual(rows, [{ tag: "exhibition", classifier_type: "deterministic_rule" }, { tag: "experience", classifier_type: "deterministic_rule" }, { tag: "food", classifier_type: "legacy" }]);
    const pet = await db.prepare("SELECT classifier_type,suitability_state FROM event_companion_suitability WHERE event_id=? AND companion_type='pet'").bind(first.id).first();
    assert.deepEqual(pet, { classifier_type: "manual_override", suitability_state: "fit" });
    const third = event("공연 야경");
    await saveFestivalSnapshot(db, snapshot(third, { ...raw2, title: third.title }, "2026-09-19T00:03:00.000Z") as never);
    const couple = await db.prepare("SELECT suitability_state FROM event_companion_suitability WHERE event_id=? AND companion_type='couple'").bind(first.id).first();
    assert.deepEqual(couple, { suitability_state: "fit" });
    const manualPet = await db.prepare("SELECT classifier_type,suitability_state FROM event_companion_suitability WHERE event_id=? AND companion_type='pet'").bind(first.id).first();
    assert.deepEqual(manualPet, { classifier_type: "manual_override", suitability_state: "fit" });
  } finally { await mf.dispose(); }
});
