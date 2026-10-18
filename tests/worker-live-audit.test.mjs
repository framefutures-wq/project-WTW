import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  observeLive,
  LIVE_FILTER,
  diagnosticSummary,
} from "../scripts/worker-live-audit.mjs";

test("diagnostics expose fixed classes and API codes only, never raw details", () => {
  assert.deepEqual(diagnosticSummary("DO_NOT_OUTPUT [code: 10000]"), {
    kind: "CLOUDFLARE_API_ERROR",
    api_codes: [10000],
  });
  assert.equal(
    diagnosticSummary("DO_NOT_OUTPUT Proxy environment variables detected")
      .kind,
    "PROXY_ENVIRONMENT_WARNING",
  );
  assert.equal(
    diagnosticSummary("fetch failed DO_NOT_OUTPUT").kind,
    "TRANSPORT_ERROR",
  );
  assert.doesNotMatch(
    JSON.stringify(diagnosticSummary("[ERROR] DO_NOT_OUTPUT")),
    /DO_NOT_OUTPUT/,
  );
});

const scheduled = {
  event: {
    cron: "* * * * *",
    request: { headers: { authorization: "DO_NOT_OUTPUT" } },
  },
  outcome: "exceededCpu",
  eventTimestamp: 1792170000000,
  cpuTime: 51,
  wallTime: 150,
  logs: [
    {
      message: [
        "fair_micro_dispatcher_stage",
        { stage: "LANE_OFFICIAL_STARTED", secret: "DO_NOT_OUTPUT" },
      ],
    },
    { message: ["DO_NOT_OUTPUT"] },
  ],
  exceptions: [{ message: "DO_NOT_OUTPUT" }],
};

test("real jq strips request/exception/freeform data and retains official CPU failure evidence", () => {
  const p = spawnSync("jq", ["-c", LIVE_FILTER], {
    input: JSON.stringify(scheduled),
    encoding: "utf8",
  });
  assert.equal(p.status, 0);
  assert.doesNotMatch(p.stdout, /DO_NOT_OUTPUT|authorization/);
  assert.deepEqual(JSON.parse(p.stdout), {
    outcome: "exceededCpu",
    eventTimestamp: 1792170000000,
    cpuTime: 51,
    wallTime: 150,
    cron: "* * * * *",
    stages: ["LANE_OFFICIAL_STARTED"],
    exception_count: 1,
  });
});

test("HTTP events are excluded; unknown fields cannot become output strings", () => {
  const p = spawnSync("jq", ["-c", LIVE_FILTER], {
    input:
      JSON.stringify({ event: { request: { url: "DO_NOT_OUTPUT" } } }) +
      "\n" +
      JSON.stringify({
        event: { cron: "DO_NOT_OUTPUT" },
        outcome: "DO_NOT_OUTPUT",
        cpuTime: "DO_NOT_OUTPUT",
        logs: [
          {
            message: [
              "fair_micro_dispatcher_stage",
              { stage: "DO_NOT_OUTPUT" },
            ],
          },
        ],
      }),
    encoding: "utf8",
  });
  assert.equal(p.status, 0);
  assert.doesNotMatch(p.stdout, /DO_NOT_OUTPUT/);
  assert.equal(JSON.parse(p.stdout).cpuTime, null);
  assert.equal(JSON.parse(p.stdout).outcome, "unknown");
});

test("missing credentials cannot start a process", async () => {
  await assert.rejects(observeLive({ token: "" }), /Missing observation token/);
});

const command = (code) => [process.execPath, "--no-warnings", "-e", code];
const keepAlive =
  "process.on('SIGINT',()=>process.exit(0));setInterval(()=>{},1000);";

test("bounded sample stops CLI cleanly and records only sanitized scheduled events", async () => {
  const result = await observeLive({
    token: "synthetic",
    durationMs: 2000,
    graceMs: 1000,
    command: command(
      `console.log(${JSON.stringify(JSON.stringify(scheduled))});${keepAlive}`,
    ),
  });
  assert.equal(result.window_completed, true);
  assert.equal(result.exceeded_cpu_events, 1);
  assert.equal(result.events[0].stages[0], "LANE_OFFICIAL_STARTED");
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_OUTPUT|synthetic/);
});

test("empty window is explicitly empty and early process exit is not success", async () => {
  const empty = await observeLive({
    token: "synthetic",
    durationMs: 2000,
    command: command(keepAlive),
  });
  assert.equal(empty.scheduled_events, 0);
  const early = await observeLive({
    token: "synthetic",
    command: command("process.exit(1)"),
  });
  assert.equal(early.window_completed, false);
  assert.equal(early.stop_reason, "TAIL_ENDED_EARLY");
});

test("malformed JSON and raw output overflow stop observation without leaking bytes", async () => {
  for (const [code, maxBytes, reason] of [
    ["console.log('DO_NOT_OUTPUT');" + keepAlive, 1048576, "FILTER_FAILED"],
    [
      "console.log('DO_NOT_OUTPUT'.repeat(100));" + keepAlive,
      10,
      "STREAM_LIMIT",
    ],
    [
      "console.error('DO_NOT_OUTPUT');" + keepAlive,
      1048576,
      "TAIL_DIAGNOSTIC_REQUIRES_REVIEW",
    ],
  ]) {
    const result = await observeLive({
      token: "synthetic",
      maxBytes,
      command: command(code),
    });
    assert.equal(result.window_completed, false);
    assert.equal(result.stop_reason, reason);
    assert.doesNotMatch(JSON.stringify(result), /DO_NOT_OUTPUT/);
  }
});

test("unresponsive CLI is killed after grace period and cannot be reported as complete", async () => {
  const result = await observeLive({
    token: "synthetic",
    durationMs: 2000,
    graceMs: 100,
    command: command("process.on('SIGINT',()=>{});setInterval(()=>{},1000);"),
  });
  assert.equal(result.hard_kill, true);
  assert.equal(result.window_completed, false);
});
