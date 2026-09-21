import { test } from "node:test";
import assert from "node:assert/strict";
import { legacyHostRedirect } from "../worker/host";

test("legacy workers.dev host redirects to canonical host", async () => {
  const response = legacyHostRedirect(
    new URL("https://weekend-mwohae.framefutures.workers.dev/?event=abc"),
  );
  assert.ok(response);
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), "https://galteum.com/?event=abc");
});

test("legacy redirect preserves path and query", () => {
  const response = legacyHostRedirect(
    new URL("https://weekend-mwohae.framefutures.workers.dev/api/events?id=abc&x=1"),
  );
  assert.equal(response?.headers.get("location"), "https://galteum.com/api/events?id=abc&x=1");
});

test("canonical and unknown hosts are not redirected", () => {
  assert.equal(legacyHostRedirect(new URL("https://galteum.com/")), null);
  assert.equal(legacyHostRedirect(new URL("https://unknown.example/")), null);
});
