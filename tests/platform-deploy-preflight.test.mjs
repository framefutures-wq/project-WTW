import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";
import { DatabaseSync } from "node:sqlite";
import { assertPlatformConfig, PLATFORM_D1_PROBE, assertPlatformProbe } from "../scripts/platform-deploy-preflight.mjs";

const config = () => parse(readFileSync("wrangler.production.jsonc", "utf8"));
test("platform preflight accepts only the reviewed existing production scope without Cron", () => {
  assert.doesNotThrow(() => assertPlatformConfig(config()));
  for (const mutate of [
    x => { x.triggers.crons = ["* * * * *"]; },
    x => { delete x.triggers; },
    x => { x.name = "other"; },
    x => { x.vars.APP_MODE = "sample"; },
    x => { x.assets.directory = "./other"; },
    x => { x.d1_databases[0].database_name = "other"; },
    x => { x.d1_databases[0].database_id = "invalid"; },
    x => { x.d1_databases.push(x.d1_databases[0]); },
  ]) {
    const c = config(); mutate(c);
    assert.throws(() => assertPlatformConfig(c));
  }
});

test("bounded D1 schema probe works on empty or old data, fails if schema missing, never writes", () => {
  const db = new DatabaseSync(":memory:");
  try {
    assert.throws(() => db.prepare(PLATFORM_D1_PROBE).get());
    db.exec("CREATE TABLE events(id INTEGER); CREATE TABLE sources(id INTEGER);");
    for (const populated of [false, true]) {
      if (populated) db.exec("INSERT INTO events VALUES (1); INSERT INTO sources VALUES (1);");
      const before = db.prepare("SELECT total_changes() AS n").get().n;
      const row = db.prepare(PLATFORM_D1_PROBE).get();
      assert.deepEqual({...row}, {ok:1, has_events:Number(populated), has_sources:Number(populated)});
      assert.doesNotThrow(() => assertPlatformProbe(0, JSON.stringify([{success:true,results:[row],meta:{changes:0,changed_db:false}}])));
      assert.equal(db.prepare("SELECT total_changes() AS n").get().n, before);
    }
  } finally { db.close(); }
});

test("platform probe fails closed on transport, malformed, failed, or mutated results", () => {
  const row = {ok:1,has_events:0,has_sources:0};
  const valid = {success:true,results:[row],meta:{changes:0,changed_db:false}};
  assert.throws(() => assertPlatformProbe(1, JSON.stringify([valid])));
  for (const bad of ["", "{}", "[]", JSON.stringify([{...valid,success:false}]),
    JSON.stringify([{...valid,results:[]}]), JSON.stringify([{...valid,results:[{ok:1}]}]),
    JSON.stringify([{...valid,meta:{changes:1}}]), JSON.stringify([{...valid,meta:{changed_db:true}}])]) {
    assert.throws(() => assertPlatformProbe(0, bad));
  }
});

test("manual verified command explicitly selects platform preflight without changing owner SHA gate", () => {
  const pkg = JSON.parse(readFileSync("package.json","utf8"));
  assert.equal(pkg.scripts["deploy:verified"], "node scripts/deploy.mjs --verified --platform-home");
  const workflow = readFileSync(".github/workflows/deploy-production.yml","utf8");
  assert.match(workflow, /github\.actor == 'framefutures-wq'/);
  assert.match(workflow, /github\.triggering_actor == 'framefutures-wq'/);
  assert.match(workflow, /test "\$EXPECTED_SHA" = "\$GITHUB_SHA"/);
  assert.match(workflow, /npm run deploy:verified/);
});
