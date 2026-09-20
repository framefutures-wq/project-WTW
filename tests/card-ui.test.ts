import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const cardFooterStart = source.indexOf('<div className="card-bottom">');
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
