import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";

test("retired legacy event collector cannot be automatically re-enabled by production deploy", () => {
  const config = parse(readFileSync("wrangler.production.jsonc", "utf8"));
  assert.deepEqual(config.triggers?.crons, []);
  assert.equal(config.name, "weekend-mwohae");
  assert.equal(config.d1_databases?.find((entry) => entry.binding === "DB")?.database_name, "weekend-mwohae-production");
  assert.equal(config.assets?.directory, "./dist");
});
