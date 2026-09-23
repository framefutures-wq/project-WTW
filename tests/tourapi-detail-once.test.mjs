import test from "node:test";
import assert from "node:assert/strict";
import { parseVersionUrl } from "../scripts/tourapi-detail-once-url.mjs";

test("parseVersionUrl accepts only a returned workers.dev URL", () => {
  assert.equal(parseVersionUrl("Version ID: abc\nhttps://detail-once-123-weekend-mwohae.workers.dev"), "https://detail-once-123-weekend-mwohae.workers.dev");
  assert.equal(parseVersionUrl("https://developers.cloudflare.com/docs\nVersion ID: abc"), null);
});
