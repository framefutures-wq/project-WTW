// Bounded use of the installed Wrangler CLI; no deploy or collection invocation.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

export const LIVE_FILTER = `
def number_or_null: if type == "number" and . >= 0 and . <= 253402300799999 then . else null end;
def stage_allowed: IN("LEASE_CLAIMED", "READINESS_STARTED", "READINESS_DUE_JOBS_STARTED", "READINESS_CANDIDATES_STARTED", "READINESS_MUNICIPAL_ACTIVE_STARTED", "READINESS_MUNICIPAL_CYCLE_STARTED", "READINESS_COMPLETED", "LANE_MUNICIPAL_SELECTED", "LANE_OFFICIAL_SELECTED", "LANE_TOURAPI_SELECTED", "LANE_MUNICIPAL_STARTED", "LANE_OFFICIAL_STARTED", "LANE_TOURAPI_STARTED", "LANE_MUNICIPAL_FINISHED", "LANE_OFFICIAL_FINISHED", "LANE_TOURAPI_FINISHED", "MUNICIPAL_MICRO_STARTED");
select(type == "object" and (.event.cron? | type == "string")) |
{
  outcome: (if (.outcome | IN("ok", "canceled", "exceededCpu", "exceededMemory", "exception")) then .outcome else "unknown" end),
  eventTimestamp: (.eventTimestamp | number_or_null),
  cpuTime: (.cpuTime | number_or_null),
  wallTime: (.wallTime | number_or_null),
  cron: (if (.event.cron | IN("* * * * *", "0 1 * * *", "55 8 * * *")) then .event.cron else "OTHER" end),
  stages: ([.logs[]? | select(.message? | type == "array") | select(.message[0] == "fair_micro_dispatcher_stage") | .message[1] | (if type == "string" then fromjson? else . end) | .stage? | select(stage_allowed)] | .[:40]),
  exception_count: ([.exceptions[]?] | length)
}`;

export function diagnosticSummary(raw) {
  const text = raw.replace(/\x1b\[[0-9;]*m/g, "");
  const codes = [...text.matchAll(/\[code:\s*(\d{1,6})\]/g)].map((match) =>
    Number(match[1]),
  );
  let kind = "UNCLASSIFIED";
  if (codes.length) kind = "CLOUDFLARE_API_ERROR";
  else if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(text))
    kind = "TRANSPORT_ERROR";
  else if (/Proxy environment variables detected/.test(text))
    kind = "PROXY_ENVIRONMENT_WARNING";
  else if (/\[ERROR\]/.test(text)) kind = "CLI_ERROR";
  else if (/\[WARNING\]/.test(text)) kind = "CLI_WARNING";
  return { kind, api_codes: [...new Set(codes)].slice(0, 5) };
}

export async function observeLive({
  token,
  durationMs = 180000,
  graceMs = 5000,
  maxBytes = 1048576,
  command = [
    process.execPath,
    "node_modules/wrangler/bin/wrangler.js",
    "tail",
    "weekend-mwohae",
    "--config",
    "wrangler.production.jsonc",
    "--format",
    "json",
  ],
} = {}) {
  if (typeof token !== "string" || !token || /\s/.test(token))
    throw new Error("Missing observation token");
  const startedAt = new Date().toISOString();
  const tail = spawn(command[0], command.slice(1), {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      CLOUDFLARE_API_TOKEN: token,
      CLOUDFLARE_ACCOUNT_ID: "a3ced956d23f59da4cfcf41377cf3ec6",
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_WRITE_LOGS: "false",
      WRANGLER_LOG_SANITIZE: "true",
      CI: "true",
    },
  });
  const jq = spawn("jq", ["-c", LIVE_FILTER], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const events = [];
  let eventCount = 0,
    failedCount = 0,
    cpuExceeded = 0,
    bytes = 0;
  let diagnostic = "";
  let stopReason = null,
    hardKill = false,
    deadline,
    killer,
    tailClosed = false;
  const signalTail = (signal) => {
    if (!tailClosed) {
      try {
        process.kill(-tail.pid, signal);
      } catch {}
    }
  };
  const stop = (reason) => {
    if (stopReason) return;
    stopReason = reason;
    signalTail("SIGINT");
    killer = setTimeout(() => {
      if (!tailClosed) {
        hardKill = true;
        signalTail("SIGKILL");
      }
    }, graceMs);
  };
  const onSignal = () => stop("INTERRUPTED");
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  deadline = setTimeout(() => stop("WINDOW_COMPLETE"), durationMs);
  const tailDone = new Promise((resolve) => {
    tail.once("error", () => {
      stop("TAIL_START_FAILED");
      resolve(-1);
    });
    tail.once("close", (code) => {
      tailClosed = true;
      if (!stopReason) stop("TAIL_ENDED_EARLY");
      resolve(code);
    });
  });
  const jqDone = new Promise((resolve) => {
    jq.once("error", () => {
      stop("FILTER_FAILED");
      resolve(-1);
    });
    jq.once("close", (code) => {
      if (code !== 0) stop("FILTER_FAILED");
      resolve(code);
    });
  });
  // Raw streams remain in pipes only. Never forward stderr or persist CLI logs.
  tail.stderr.on("data", (chunk) => {
    diagnostic = (diagnostic + chunk.toString("utf8")).slice(0, 16384);
    stop("TAIL_DIAGNOSTIC_REQUIRES_REVIEW");
  });
  jq.stderr.on("data", () => stop("FILTER_FAILED"));
  jq.stdin.on("error", () => stop("FILTER_FAILED"));
  tail.stdout.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      stop("STREAM_LIMIT");
      return;
    }
    // Stop before Wrangler's built-in reconnect loop proceeds; no wrapper retry.
    if (chunk.includes("Reconnecting")) {
      stop("TAIL_DISCONNECTED");
      return;
    }
    if (!jq.stdin.destroyed) jq.stdin.write(chunk);
  });
  tail.stdout.on("end", () => jq.stdin.end());
  const lines = createInterface({ input: jq.stdout });
  lines.on("line", (line) => {
    if (line.length > 32768) {
      stop("FILTER_LIMIT");
      return;
    }
    try {
      const event = JSON.parse(line);
      eventCount++;
      if (event.outcome !== "ok") failedCount++;
      if (event.outcome === "exceededCpu") cpuExceeded++;
      if (events.length < 20) events.push(event);
    } catch {
      stop("FILTER_FAILED");
    }
  });
  const [tailCode, filterCode] = await Promise.all([tailDone, jqDone]);
  clearTimeout(deadline);
  clearTimeout(killer);
  process.removeListener("SIGINT", onSignal);
  process.removeListener("SIGTERM", onSignal);
  lines.close();
  return {
    worker: "weekend-mwohae",
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    stop_reason: stopReason,
    diagnostic: diagnosticSummary(diagnostic),
    hard_kill: hardKill,
    window_completed:
      stopReason === "WINDOW_COMPLETE" &&
      !hardKill &&
      tailCode === 0 &&
      filterCode === 0,
    scheduled_events: eventCount,
    failed_events: failedCount,
    exceeded_cpu_events: cpuExceeded,
    events,
    events_truncated: eventCount > events.length,
    limitations:
      "Short live sample only; absent CPU values are unknown. No historical-log, D1 progress, publication or deployed Git mapping verification.",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const report = await observeLive({
      token: process.env.CLOUDFLARE_OBSERVE_TOKEN,
    });
    console.log(JSON.stringify(report, null, 2));
    if (
      !report.window_completed ||
      !report.scheduled_events ||
      report.failed_events
    )
      process.exitCode = 1;
  } catch {
    console.error("Live observation unavailable; raw details suppressed");
    process.exitCode = 1;
  }
}
