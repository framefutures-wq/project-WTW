import test from "node:test";
import assert from "node:assert/strict";
import { auditWorker } from "../scripts/worker-readonly-audit.mjs";

const id = "5738282d-70ec-45c9-bb73-829b2b1834e2";
const deployment = {
  id,
  created_on: "2026-10-15T17:00:00.000Z",
  versions: [{ version_id: id, percentage: 100 }],
};
const reply = (result) => Response.json({ success: true, result });

test("uses exactly two fixed GETs, strips unapproved fields and preserves unknown outcomes", async () => {
  const calls = [];
  const report = await auditWorker({
    token: "synthetic-test-token",
    fetcher: async (url, options) => {
      calls.push([url, options]);
      return url.includes("/deployments?")
        ? reply({
            deployments: [
              {
                ...deployment,
                annotations: { secret: "DO_NOT_OUTPUT" },
                author_email: "DO_NOT_OUTPUT",
              },
            ],
          })
        : reply({
            schedules: [{ cron: "* * * * *", secret: "DO_NOT_OUTPUT" }],
          });
    },
  });
  assert.equal(calls.length, 2);
  for (const [url, options] of calls) {
    assert.match(
      url,
      /^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/a3ced956d23f59da4cfcf41377cf3ec6\/workers\/scripts\/weekend-mwohae\/(deployments\?per_page=5|schedules)$/,
    );
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.body, undefined);
    assert.equal(options.headers.Authorization, "Bearer synthetic-test-token");
  }
  assert.deepEqual(report.deployments, [deployment]);
  assert.deepEqual(report.crons, ["* * * * *"]);
  assert.equal(report.git_commit_mapping, "UNVERIFIED");
  assert.equal(report.cpu_and_collection_outcome, "NOT_CHECKED");
  assert.doesNotMatch(
    JSON.stringify(report),
    /DO_NOT_OUTPUT|synthetic-test-token/,
  );
});

test("missing credentials stop before network", async () => {
  await assert.rejects(
    auditWorker({ token: "", fetcher: () => assert.fail("network") }),
    /Missing or invalid/,
  );
});

test("authorization failure stops without retry or upstream error leakage", async () => {
  let calls = 0;
  await assert.rejects(
    auditWorker({
      token: "synthetic",
      fetcher: async () => {
        calls++;
        return new Response("DO_NOT_OUTPUT", { status: 403 });
      },
    }),
    { message: "Cloudflare metadata HTTP 403" },
  );
  assert.equal(calls, 1);
});

test("transport exceptions cannot expose headers or secrets", async () => {
  await assert.rejects(
    auditWorker({
      token: "synthetic",
      fetcher: async () => {
        throw new Error("DO_NOT_OUTPUT");
      },
    }),
    {
      message:
        "Cloudflare metadata request failed; response details suppressed",
    },
  );
});

test("oversized bodies and API failure envelopes are rejected", async () => {
  for (const response of [
    new Response("x".repeat(262145)),
    Response.json({ success: false, errors: ["DO_NOT_OUTPUT"] }),
  ]) {
    await assert.rejects(
      auditWorker({ token: "synthetic", fetcher: async () => response }),
      /Invalid Cloudflare metadata response/,
    );
  }
});

test("malformed metadata and output injection are rejected", async () => {
  for (const bad of [
    { ...deployment, id: "::warning::injection" },
    { ...deployment, versions: [{ version_id: id, percentage: 101 }] },
  ]) {
    await assert.rejects(
      auditWorker({
        token: "synthetic",
        fetcher: async () => reply({ deployments: [bad] }),
      }),
      /Invalid Cloudflare metadata response/,
    );
  }
  await assert.rejects(
    auditWorker({
      token: "synthetic",
      fetcher: async (url) =>
        url.includes("/deployments?")
          ? reply({ deployments: [deployment] })
          : reply({ schedules: [{ cron: "::warning::injection" }] }),
    }),
    /Invalid Cloudflare metadata response/,
  );
});
