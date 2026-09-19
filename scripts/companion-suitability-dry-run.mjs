import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const DB = "weekend-mwohae-production";
const CONFIG = "wrangler.production.jsonc";
const CLASSIFIER = "deterministic_rule";
const VERSION = "fact_rules_v1";
const SUITABILITY_VERSION = "companion_rules_v1";
const snapshotArg = process.argv[2] === "--snapshot" ? process.argv[3] : null;
const quote = (value) => `'${String(value ?? "").replaceAll("'", "''")}'`;

function query(sql) {
  const result = spawnSync("npx", ["wrangler", "d1", "execute", DB, "--remote", "--config", CONFIG, "--command", sql, "--json"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `원격 D1 읽기 실패: ${sql}`);
  return JSON.parse(result.stdout)[0]?.results ?? [];
}
function queryPaged(sql, size = 100) {
  const rows = [];
  for (let offset = 0; ; offset += size) {
    const page = query(`${sql} LIMIT ${size} OFFSET ${offset}`);
    rows.push(...page);
    if (page.length < size) return rows;
  }
}
function parse(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }

let events;
let tags;
let snapshotSource = "remote_d1_read";
if (snapshotArg) {
  const stored = JSON.parse(readFileSync(snapshotArg, "utf8"));
  const report = JSON.parse(readFileSync(".wrangler/fact-tag-dry-run.json", "utf8"));
  events = stored.events.filter((event) => !event.is_sample).map((event) => ({ id: event.id, title: event.title }));
  tags = report.candidates.map((candidate) => ({ event_id: candidate.event_id, tag: candidate.tag, rule_id: candidate.rule_id, evidence_source_ref: candidate.evidence_source, evidence_field: candidate.field, evidence_excerpt: candidate.evidence_text }));
  snapshotSource = snapshotArg;
} else {
  events = query("SELECT id,title FROM events WHERE is_sample=0 ORDER BY id");
  tags = queryPaged(`SELECT event_id,tag,rule_id,evidence_source_ref,evidence_field,evidence_excerpt FROM event_tags WHERE classifier_type=${quote(CLASSIFIER)} AND rule_version=${quote(VERSION)} ORDER BY event_id,tag`);
}
const byEvent = new Map(events.map((event) => [event.id, new Map()]));
for (const row of tags) if (byEvent.has(row.event_id)) byEvent.get(row.event_id).set(row.tag, row);

const childCombo = [
  [["experience", "education"], "child.experience_education_combo"],
  [["experience", "nature_scenery"], "child.experience_nature_combo"],
  [["exhibition", "education"], "child.exhibition_education_combo"],
  [["traditional_history", "experience"], "child.traditional_experience_combo"],
  [["sports", "experience"], "child.sports_experience_combo"],
];
const couplePairs = [
  [["flower_garden", "photo_spot"], "couple.flower_photo"],
  [["night_light", "photo_spot"], "couple.night_photo"],
  [["fireworks", "night_light"], "couple.fireworks_night"],
  [["nature_scenery", "photo_spot"], "couple.nature_photo"],
  [["performance", "night_light"], "couple.performance_night"],
  [["exhibition", "photo_spot"], "couple.exhibition_photo"],
  [["food", "local_specialty"], "couple.food_local"],
];
const parentContent = new Set(["traditional_history", "nature_scenery", "performance", "exhibition", "local_specialty", "food", "flower_garden"]);
const parentComfort = new Set(["seated_viewing", "accessibility", "shuttle", "indoor"]);

function has(map, tag) { return map.has(tag); }
function firstCombo(map, combos) { return combos.find(([pair]) => pair.every((tag) => has(map, tag))); }
function sourceFacts(map, selected) {
  return selected.map((tag) => {
    const row = map.get(tag);
    return { tag, rule_id: row?.rule_id ?? null, evidence_source: row?.evidence_source_ref ?? null, evidence_field: row?.evidence_field ?? null, evidence_excerpt: row?.evidence_excerpt ?? null };
  });
}
function result(companion_type, state, reason, caution, map, selected, rule_id) {
  return { companion_type, suitability_state: state, positive_reason_codes: reason ? [reason] : [], caution_reason_codes: caution ? [caution] : [], source_fact_tags: sourceFacts(map, selected), rule_id, rule_version: SUITABILITY_VERSION };
}
function classify(map) {
  const childStrong = has(map, "children_program");
  const childFamily = has(map, "family_program");
  const childCombo = firstCombo(map, childComboRules);
  let child;
  if (childStrong) child = result("child", "fit", "child.direct_children_program", null, map, ["children_program"], "companion.child.strong_children_program.v1");
  else if (childFamily && ["experience", "education", "sports", "exhibition", "nature_scenery"].some((tag) => has(map, tag))) child = result("child", "fit", "child.family_activity_combo", null, map, ["family_program", ...["experience", "education", "sports", "exhibition", "nature_scenery"].filter((tag) => has(map, tag)).slice(0, 1)], "companion.child.family_activity.v1");
  else if (childFamily) child = result("child", "unknown", null, "child.activity_specificity_missing", map, ["family_program"], "companion.child.unknown_family_only.v1");
  else if (childCombo) child = result("child", "unknown", null, "child.direct_audience_missing", map, childCombo[0], "companion.child.unknown_combo_without_audience.v1");
  else child = result("child", "unknown", null, "child.insufficient_audience_evidence", map, [], "companion.child.unknown.v1");

  const couplePair = firstCombo(map, couplePairs);
  const coupleAxes = ["flower_garden", "night_light", "fireworks", "photo_spot", "nature_scenery", "performance", "exhibition", "food", "local_specialty"].filter((tag) => has(map, tag));
  const couple = couplePair && couplePair[1] === "couple.food_local"
    ? result("couple", "unknown", null, "couple.couple_specificity_missing", map, couplePair[0], "companion.couple.unknown_weak_combination.v1")
    : couplePair
    ? result("couple", "fit", couplePair[1], null, map, couplePair[0], "companion.couple.combination.v1")
    : coupleAxes.length === 1
      ? result("couple", "unknown", null, "couple.multi_axis_evidence_missing", map, coupleAxes, "companion.couple.unknown_single_axis.v1")
      : result("couple", "unknown", null, "couple.insufficient_complementary_evidence", map, [], "companion.couple.unknown.v1");

  const content = [...parentContent].filter((tag) => has(map, tag));
  const comfort = [...parentComfort].filter((tag) => has(map, tag));
  const parents = content.length && comfort.length
    ? result("parents", "fit", "parents.content_plus_comfort", null, map, [content[0], comfort[0]], "companion.parents.content_comfort.v1")
    : content.length
      ? result("parents", "unknown", null, "parents.comfort_evidence_missing", map, [content[0]], "companion.parents.unknown_content_without_comfort.v1")
      : result("parents", "unknown", null, "parents.insufficient_content_evidence", map, [], "companion.parents.unknown.v1");

  const pet = has(map, "pet_allowed")
    ? result("pet", "allowed", "pet.explicit_pet_allowed", null, map, ["pet_allowed"], "companion.pet.explicit_allowed.v1")
    : result("pet", "unknown", null, "pet.explicit_permission_missing", map, [], "companion.pet.unknown.v1");
  return [child, couple, parents, pet];
}

const childComboRules = childCombo;
const rows = [];
for (const event of events) for (const row of classify(byEvent.get(event.id))) rows.push({ event_id: event.id, title: event.title, ...row });
const companions = ["child", "couple", "parents", "pet"];
const states = { child: ["fit", "conditional", "unknown"], couple: ["fit", "conditional", "unknown"], parents: ["fit", "conditional", "unknown"], pet: ["allowed", "unknown"] };
const distribution = Object.fromEntries(companions.map((companion) => [companion, Object.fromEntries(states[companion].map((state) => [state, rows.filter((row) => row.companion_type === companion && row.suitability_state === state).length]))]));
const fitByEvent = new Map(events.map((event) => [event.id, 0]));
for (const row of rows) if ((row.companion_type !== "pet" && row.suitability_state === "fit") || (row.companion_type === "pet" && row.suitability_state === "allowed")) fitByEvent.set(row.event_id, fitByEvent.get(row.event_id) + 1);
const multiCompanion = Object.fromEntries([0, 1, 2, 3, 4].map((n) => [String(n), [...fitByEvent.values()].filter((value) => value === n).length]));
const rulePathCounts = Object.fromEntries([...new Set(rows.map((row) => `${row.companion_type}|${row.rule_id}`))].sort().map((key) => [key, rows.filter((row) => `${row.companion_type}|${row.rule_id}` === key).length]));
const qa = {};
for (const companion of companions) {
  qa[companion] = {};
  for (const state of states[companion]) {
    const limit = companion === "parents" && state === "unknown" ? 30 : companion === "parents" && state === "fit" ? 99 : 12;
    qa[companion][state] = rows.filter((row) => row.companion_type === companion && row.suitability_state === state).slice(0, limit).map((row) => ({ event_id: row.event_id, title: row.title, source_fact_tags: row.source_fact_tags.map((fact) => fact.tag), reason: row.positive_reason_codes, caution: row.caution_reason_codes, rule_id: row.rule_id }));
  }
}
const qaEventIds = new Set(Object.values(qa).flatMap((byState) => Object.values(byState).flatMap((sample) => sample.map((row) => row.event_id))));
const report = { generated_at: new Date().toISOString(), snapshot: { event_count: events.length, tagged_event_count: byEvent.size ? [...byEvent.values()].filter((map) => map.size).length : 0, event_tag_rows: tags.length, classifier_type: CLASSIFIER, fact_rule_version: VERSION, source: snapshotSource }, rule_version: SUITABILITY_VERSION, rules: { child: { strong: ["children_program"], combinations: childCombo.map(([pair, rule]) => ({ tags: pair, rule })) }, couple: { combinations: couplePairs.map(([pair, rule]) => ({ tags: pair, rule })) }, parents: { content: [...parentContent], comfort: [...parentComfort] }, pet: { allowed_tag: "pet_allowed", no_inference: true } }, distribution, rule_path_counts: rulePathCounts, multi_companion_fit: multiCompanion, qa_event_count: qaEventIds.size, rows, qa_samples: qa, qa_findings: { resolved_weak_combination: { pattern: "food+local_specialty", affected_events: rows.filter((row) => row.companion_type === "couple" && row.caution_reason_codes.includes("couple.couple_specificity_missing")).length, action: "fit/conditional에서 unknown으로 유지" }, remaining_false_positive_candidates: [], false_negative_candidates: [] }, unknown_rows: rows.filter((row) => row.suitability_state === "unknown") };
mkdirSync("/tmp/wtw-companion", { recursive: true });
writeFileSync("/tmp/wtw-companion/report.json", JSON.stringify(report, null, 2));
writeFileSync(".wrangler/companion-suitability-dry-run.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ snapshot: report.snapshot, distribution, multi_companion_fit: multiCompanion }, null, 2));
