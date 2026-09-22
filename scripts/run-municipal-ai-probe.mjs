import { spawn } from "node:child_process";

const port = 8791;
const url = `http://127.0.0.1:${port}/`;
const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  [
    "wrangler",
    "dev",
    "--config",
    "wrangler.ai-probe.jsonc",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
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
    if (child.exitCode !== null)
      throw new Error(`wrangler exited early (${child.exitCode})\n${logs}`);
    try {
      response = await fetch(url);
      break;
    } catch {
      await sleep(500);
    }
  }
  if (!response) throw new Error(`probe server did not start\n${logs}`);
  const body = await response.text();
  console.log(body);
  if (!response.ok) process.exitCode = 1;
} finally {
  child.kill("SIGINT");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(3000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
