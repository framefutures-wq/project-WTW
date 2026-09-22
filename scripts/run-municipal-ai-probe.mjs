import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const port = 8791;
const url = `http://127.0.0.1:${port}/`;
const child = spawn(
  process.execPath,
  [
    fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)),
    "dev",
    "--config",
    "wrangler.ai-probe.jsonc",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" },
);

let logs = "";
child.stdout.on("data", (chunk) => {
  logs += chunk;
});
child.stderr.on("data", (chunk) => {
  logs += chunk;
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let response = null;
try {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`wrangler exited early (${child.exitCode})\n${logs}`);
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      break;
    } catch (error) {
      if (error?.name === "TimeoutError") throw error;
      await sleep(500);
    }
  }
  if (!response) throw new Error(`probe server did not start\n${logs}`);
  const body = await response.text();
  console.log(body);
  if (!response.ok) process.exitCode = 1;
} finally {
  const stop = (signal) => {
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {
        // The process group may already have exited.
      }
    }
    child.kill(signal);
  };
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  const waitForExit = () =>
    exited() ? Promise.resolve() : new Promise((resolve) => child.once("exit", resolve));
  stop("SIGINT");
  await Promise.race([
    waitForExit(),
    sleep(3000),
  ]);
  if (!exited()) stop("SIGKILL");
  child.stdout.destroy();
  child.stderr.destroy();
}
