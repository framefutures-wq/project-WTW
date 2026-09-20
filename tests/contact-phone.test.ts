import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOfficialPhone } from "../shared/contact-phone";

test("normalizes a single official Korean contact into display and tel href", () => {
  assert.deepEqual(normalizeOfficialPhone("031-123-4567"), {
    display: "031-123-4567",
    href: "tel:0311234567",
  });
  assert.deepEqual(normalizeOfficialPhone("1577-7766"), {
    display: "1577-7766",
    href: "tel:15777766",
  });
});

test("does not make an action for ambiguous or malformed TourAPI phone values", () => {
  assert.equal(normalizeOfficialPhone("문의: 031-123-4567"), null);
  assert.equal(normalizeOfficialPhone("031-123-4567 / 031-765-4321"), null);
  assert.equal(normalizeOfficialPhone("063-290-3976~8"), null);
  assert.equal(normalizeOfficialPhone("02-522-882"), null);
});
