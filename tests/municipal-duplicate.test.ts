import assert from "node:assert/strict";
import test from "node:test";
import {
  canRegisterMunicipalEvent,
  decideMunicipalDuplicate,
  normalizeMunicipalTitle,
} from "../shared/municipal-duplicate";

const candidate = { id: "municipal-paju-test", title: "2026년 제18회 문산거리축제", region: "경기", start_date: "2026-09-19", end_date: "2026-09-20", venue: "문산천노을길", address: "파주시 문산읍 내포리 68-1" };

test("municipal duplicate policy keeps exact titles and close normalized titles conservative", () => {
  assert.equal(normalizeMunicipalTitle(candidate.title), "문산거리축제");
  assert.equal(decideMunicipalDuplicate(candidate, [{ ...candidate, id: "tourapi-x" }], []), "DUPLICATE");
  assert.equal(decideMunicipalDuplicate(candidate, [], [{ ...candidate, id: "tourapi-x", title: "문산 거리 축제" }]), "LIKELY_DUPLICATE");
});

test("same normalized title at a different place is review, not an automatic duplicate", () => {
  assert.equal(decideMunicipalDuplicate(candidate, [], [{ ...candidate, id: "tourapi-x", venue: "다른 공원", address: "다른 주소" }]), "REVIEW");
  assert.equal(decideMunicipalDuplicate(candidate, [], []), "NEW");
});

test("only NEW MAIN events with municipal IDs can register", () => {
  assert.equal(canRegisterMunicipalEvent("MAIN", "NEW", candidate.id), true);
  assert.equal(canRegisterMunicipalEvent("MAIN", "LIKELY_DUPLICATE", candidate.id), false);
  assert.equal(canRegisterMunicipalEvent("NEARBY_ONLY", "NEW", candidate.id), false);
  assert.equal(canRegisterMunicipalEvent("MAIN", "NEW", "tourapi-1"), false);
});
