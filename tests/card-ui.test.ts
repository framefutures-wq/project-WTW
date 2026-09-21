import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const styles = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);
const cardFooterStart = source.indexOf("className={`card-bottom");
const cardFooter = source.slice(
  cardFooterStart,
  source.indexOf("</div>", cardFooterStart) + 6,
);

test("event cards do not render unknown cost or last-checked noise", () => {
  assert.doesNotMatch(source, /COST_STATUS_LABELS/);
  assert.doesNotMatch(cardFooter, /event\.checked_at/);
  assert.doesNotMatch(cardFooter, /취소 여부 미확인/);
});

test("event cards retain a dedicated path for confirmed status changes", () => {
  assert.match(source, /cardStatusLabel\(event\)/);
  assert.match(source, /<TrustInfo event=\{event\} card \/>/);
});

test("recommendation reason is a small card-only contextual label", () => {
  assert.match(source, /recommendationReasonLabel\(/);
  assert.match(source, /sort === "recommended" && !location/);
  assert.match(source, /className="recommendation-reason"/);
  assert.match(styles, /\.recommendation-reason\s*\{[^}]*white-space: nowrap/);
});

test("card footer is compact with conditional status separation and right arrow", () => {
  assert.match(source, /card-bottom-status/);
  assert.match(styles, /\.card-bottom-status\s*\{[^}]*border-top/);
  assert.match(styles, /\.card-bottom > svg\s*\{[^}]*margin-left: auto/);
  assert.match(styles, /\.event-grid\s*\{[^}]*align-items: start/);
  assert.doesNotMatch(styles, /\.card-tags\s*\{[^}]*min-height/);
});
