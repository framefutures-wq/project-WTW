import test from "node:test";
import assert from "node:assert/strict";
import { alertDedupeKey, cancellationConfirmed, scheduleChanged } from "../shared/alert-engine";

test("alert engine uses deterministic factual change rules", () => {
  assert.equal(alertDedupeKey("NEW_EVENT", "e1", {}), "new:e1");
  assert.equal(alertDedupeKey("SCHEDULE_CHANGED", "e1", { start_date: "2026-10-10", end_date: "2026-10-11" }), "schedule:e1:2026-10-10:2026-10-11");
  assert.equal(alertDedupeKey("CANCELLED_OR_POSTPONED", "e1", { status: "cancelled" }), "status:e1:cancelled");
  assert.equal(scheduleChanged({ start_date: "2026-10-03", end_date: "2026-10-04" }, { start_date: "2026-10-10", end_date: "2026-10-11" }), true);
  assert.equal(scheduleChanged({ start_date: "2026-10-03", end_date: "2026-10-04" }, { start_date: "2026-10-03", end_date: "2026-10-04" }), false);
  assert.equal(cancellationConfirmed({ status: "scheduled" }, { status: "cancelled" }), true);
  assert.equal(cancellationConfirmed({ status: "scheduled" }, { status: "unknown" }), false);
  assert.equal(cancellationConfirmed(null, { status: "cancelled" }), false);
});
