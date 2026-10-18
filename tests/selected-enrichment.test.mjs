import assert from "node:assert/strict";
import test from "node:test";
import { SELECTED_EVENTS, buildSql } from "../scripts/enrich-selected-events.mjs";

test("Phase 8A enrichment is a closed five-event, idempotent upsert", () => {
  assert.equal(SELECTED_EVENTS.length, 5);
  assert.ok(SELECTED_EVENTS.some((event) => event.id === "tourapi-2786391"));
  assert.ok(SELECTED_EVENTS.every((event) => event.source.url.startsWith("https://")));
  assert.doesNotMatch(buildSql(), /DELETE FROM|DROP TABLE|UPDATE events SET/i);
  assert.match(buildSql(), /event_program_occurrences/);
  assert.match(buildSql(), /event_operating_hours/);
});

test("program times never become event operating hours", () => {
  const drone = SELECTED_EVENTS.find((event) => event.id === "tourapi-2786391");
  assert.equal(drone.hours, undefined);
  assert.ok(drone.programs[0].occurrences.some((occurrence) => occurrence[1] === "20:00"));
  const hwaseong = SELECTED_EVENTS.find((event) => event.id === "tourapi-2657619");
  assert.ok(hwaseong.hours.every((hour) => hour[1] === "18:00" && hour[2] === "21:30"));
});
