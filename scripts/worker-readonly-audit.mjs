// Only deployment metadata and Cron definitions. No log, content, D1 or write API.
import { pathToFileURL } from "node:url";

const ROOT =
  "https://api.cloudflare.com/client/v4/accounts/a3ced956d23f59da4cfcf41377cf3ec6/workers/scripts/weekend-mwohae";
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const MAX_BYTES = 262144;
const invalid = () => {
  throw new Error("Invalid Cloudflare metadata response");
};
const uuid = (value) =>
  typeof value === "string" && UUID.test(value) ? value : invalid();
const date = (value) =>
  typeof value === "string" &&
  ISO.test(value) &&
  Number.isFinite(Date.parse(value))
    ? value
    : invalid();

async function get(path, token, fetcher) {
  let response;
  try {
    response = await fetcher(ROOT + path, {
      method: "GET",
      redirect: "error",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error(
      "Cloudflare metadata request failed; response details suppressed",
    );
  }
  // Never print an upstream body/error, request object, headers, or credentials.
  if (!response.ok)
    throw new Error(`Cloudflare metadata HTTP ${response.status}`);
  let body;
  try {
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) invalid();
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel();
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    invalid();
  }
  if (body?.success !== true || !body.result) invalid();
  return body.result;
}

export async function auditWorker({ token, fetcher = fetch } = {}) {
  if (typeof token !== "string" || !token || /[\r\n\s]/.test(token))
    throw new Error("Missing or invalid CLOUDFLARE_OBSERVE_TOKEN");
  const deploymentResult = await get("/deployments?per_page=5", token, fetcher);
  if (
    !Array.isArray(deploymentResult.deployments) ||
    deploymentResult.deployments.length > 5
  )
    invalid();
  const deployments = deploymentResult.deployments.map((item) => {
    if (!Array.isArray(item.versions) || item.versions.length > 100) invalid();
    return {
      id: uuid(item.id),
      created_on: date(item.created_on),
      versions: item.versions.map((version) => {
        if (
          typeof version.percentage !== "number" ||
          !Number.isFinite(version.percentage) ||
          version.percentage < 0 ||
          version.percentage > 100
        )
          invalid();
        return {
          version_id: uuid(version.version_id),
          percentage: version.percentage,
        };
      }),
    };
  });
  const scheduleResult = await get("/schedules", token, fetcher);
  if (
    !Array.isArray(scheduleResult.schedules) ||
    scheduleResult.schedules.length > 100
  )
    invalid();
  const crons = scheduleResult.schedules.map((item) => {
    if (
      typeof item.cron !== "string" ||
      item.cron.length > 100 ||
      !/^[0-9A-Z*,/\- ]+$/.test(item.cron) ||
      item.cron.trim().split(/ +/).length !== 5
    )
      invalid();
    return item.cron;
  });
  return {
    worker: "weekend-mwohae",
    observed_at: new Date().toISOString(),
    deployments,
    crons,
    git_commit_mapping: "UNVERIFIED",
    cpu_and_collection_outcome: "NOT_CHECKED",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(
      JSON.stringify(
        await auditWorker({ token: process.env.CLOUDFLARE_OBSERVE_TOKEN }),
        null,
        2,
      ),
    );
  } catch (error) {
    // Only the fixed messages above can reach stderr; never serialize an exception.
    const message =
      error instanceof Error &&
      /^(Missing or invalid CLOUDFLARE_OBSERVE_TOKEN|Invalid Cloudflare metadata response|Cloudflare metadata HTTP \d{3}|Cloudflare metadata request failed; response details suppressed)$/.test(
        error.message,
      )
        ? error.message
        : "Worker metadata audit failed; details suppressed";
    console.error(message);
    process.exitCode = 1;
  }
}
