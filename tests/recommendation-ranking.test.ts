import assert from "node:assert/strict";
import test from "node:test";
import {
  compareRecommended,
  recommendationBucket,
  recommendationReasonCodes,
} from "../shared/recommendation-ranking";

const range = { start: "2026-10-03", end: "2026-10-04" };
const event = (id: string, start_date: string, end_date: string) => ({
  id,
  start_date,
  end_date,
});

test("recommended uses only the selected-range temporal buckets", () => {
  const ordered = [
    event("ongoing", "2026-09-01", "2026-12-31"),
    event("ends", "2026-09-20", "2026-10-04"),
    event("starts", "2026-10-03", "2026-10-20"),
    event("within", "2026-10-03", "2026-10-04"),
  ].sort((a, b) => compareRecommended(a, b, range));
  assert.deepEqual(ordered.map((row) => row.id), ["within", "starts", "ends", "ongoing"]);
  assert.equal(recommendationBucket(event("day", "2026-10-03", "2026-10-03"), range), 0);
  assert.deepEqual(recommendationReasonCodes(event("day", "2026-10-03", "2026-10-03"), range), ["within_selected_range", "single_day"]);
});

test("recommended tie-breaks single day, duration, dates, then id deterministically", () => {
  const ordered = [
    event("z", "2026-10-03", "2026-10-03"),
    event("a", "2026-10-03", "2026-10-03"),
    event("two-day", "2026-10-03", "2026-10-04"),
    event("later", "2026-10-04", "2026-10-04"),
  ].sort((a, b) => compareRecommended(a, b, range));
  assert.deepEqual(ordered.map((row) => row.id), ["a", "z", "later", "two-day"]);
});

test("custom single-date ranking keeps the same factual ordering", () => {
  const day = { start: "2026-10-03", end: "2026-10-03" };
  const ordered = [
    event("ongoing", "2026-09-01", "2026-12-31"),
    event("ends", "2026-09-20", "2026-10-03"),
    event("starts", "2026-10-03", "2026-10-20"),
    event("single", "2026-10-03", "2026-10-03"),
  ].sort((a, b) => compareRecommended(a, b, day));
  assert.deepEqual(ordered.map((row) => row.id), ["single", "starts", "ends", "ongoing"]);
});

test("images, source, and detail volume cannot affect recommended order", () => {
  const lowSignal = { ...event("high-temporal", "2026-10-03", "2026-10-03"), image_url: null, source_kind: "municipality", description: "" };
  const highSignal = { ...event("long-running", "2026-09-01", "2026-12-31"), image_url: "https://example.test/image.jpg", source_kind: "tourapi", description: "very detailed".repeat(100) };
  assert.equal(compareRecommended(lowSignal, highSignal, range) < 0, true);
});
