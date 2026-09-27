import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { parse } from "jsonc-parser";
import { parseVersionUrl } from "./tourapi-detail-once-url.mjs";

const name = "weekend-mwohae";
const nonce = randomUUID().replace(/-/g, "");
const manualRunId = randomUUID();
const tempDir = ".wrangler/deployment";
const config = parse(readFileSync("wrangler.production.jsonc", "utf8"));
const tempConfig = resolve(tempDir, `municipal-once-${manualRunId}.jsonc`);

const shardArg = process.argv.find((arg) => arg.startsWith("--shard="));
const requestedShards = shardArg
  ? [Number(shardArg.slice("--shard=".length))]
  : [0, 1, 2];

if (
  requestedShards.some(
    (shard) => !Number.isInteger(shard) || shard < 0 || shard > 2,
  )
)
  throw new Error("Use --shard=0, --shard=1, or --shard=2.");

const run = (args) => {
  const result = spawnSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(result.stderr || result.stdout || "wrangler command failed");
  return `${result.stdout}\n${result.stderr}`;
};

const d1Read = (sql) => {
  const output = run([
    "d1",
    "execute",
    "weekend-mwohae-production",
    "--remote",
    "--config",
    "wrangler.production.jsonc",
    "--json",
    "--command",
    sql,
  ]);
  return JSON.parse(output)[0]?.results ?? [];
};

const sqlQuote = (value) => `'${String(value).replaceAll("'", "''")}'`;

const stateSummarySql = (registryKeys, startedAt) => {
  const keyRows = registryKeys.map((key) => `(${sqlQuote(key)})`).join(",");
  return `
  WITH registry(source_key) AS (VALUES ${keyRows}), states AS (
    SELECT source_key,
      COUNT(*) AS candidates,
      SUM(CASE WHEN julianday(last_seen_at) >= julianday(${sqlQuote(startedAt)}) THEN 1 ELSE 0 END) AS observed,
      SUM(CASE WHEN decision_state='AUTO_PUBLISH' THEN 1 ELSE 0 END) AS AUTO_PUBLISH,
      SUM(CASE WHEN decision_state='AUTO_RETRY' THEN 1 ELSE 0 END) AS AUTO_RETRY,
      SUM(CASE WHEN decision_state='AUTO_EXCLUDE' THEN 1 ELSE 0 END) AS AUTO_EXCLUDE,
      SUM(CASE WHEN decision_state='POLICY_SKIP' THEN 1 ELSE 0 END) AS POLICY_SKIP,
      SUM(CASE WHEN decision_state='EXPIRED' THEN 1 ELSE 0 END) AS EXPIRED
    FROM municipal_candidate_state GROUP BY source_key
  )
  SELECT registry.source_key, COALESCE(states.candidates, 0) AS candidates,
    COALESCE(states.observed, 0) AS observed,
    COALESCE(states.AUTO_PUBLISH, 0) AS AUTO_PUBLISH,
    COALESCE(states.AUTO_RETRY, 0) AS AUTO_RETRY,
    COALESCE(states.AUTO_EXCLUDE, 0) AS AUTO_EXCLUDE,
    COALESCE(states.POLICY_SKIP, 0) AS POLICY_SKIP,
    COALESCE(states.EXPIRED, 0) AS EXPIRED
  FROM registry LEFT JOIN states USING(source_key)
  ORDER BY registry.source_key`;
};

const eventSummarySql = (registryKeys, startedAt) => {
  const keyRows = registryKeys.map((key) => `(${sqlQuote(key)})`).join(",");
  return `
  WITH registry(source_key) AS (VALUES ${keyRows})
  SELECT registry.source_key, COUNT(events.id) AS published_or_revalidated
  FROM registry LEFT JOIN events ON events.primary_source_id LIKE
    'municipal-source-municipal-' || registry.source_key || '-%'
    AND julianday(events.updated_at) >= julianday(${sqlQuote(startedAt)})
  GROUP BY registry.source_key ORDER BY registry.source_key`;
};

try {
  mkdirSync(tempDir, { recursive: true });
  writeFileSync(
    tempConfig,
    JSON.stringify({
      name,
      account_id: config.account_id,
      main: resolve("scripts/municipal-once-worker.ts"),
      compatibility_date: config.compatibility_date,
      ai: config.ai,
      d1_databases: config.d1_databases,
      vars: {
        ...config.vars,
        TOUR_API_ENABLED: "false",
        MANUAL_MUNICIPAL_NONCE: nonce,
      },
      secrets: config.secrets,
    }),
  );

  const alias = `municipal-once-${randomUUID()
    .replace(/-/g, "")
    .slice(0, 10)}`;
  const uploaded = run([
    "versions",
    "upload",
    "--config",
    tempConfig,
    "--keep-vars",
    "--preview-alias",
    alias,
    "--message",
    "municipal-only sharded one-shot",
  ]);
  const url = parseVersionUrl(uploaded);
  if (!url)
    throw new Error(
      "Version URL unavailable: CLI returned no workers.dev URL",
    );

  const shardResults = [];
  for (const shardIndex of requestedShards) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-manual-municipal-nonce": nonce,
        "x-manual-municipal-shard": String(shardIndex),
      },
      signal: AbortSignal.timeout(14 * 60_000),
    });
    if (!response.ok)
      throw new Error(
        `one-shot shard ${shardIndex} failed (${response.status})`,
      );
    const result = await response.json();
    if (result.shardIndex !== shardIndex)
      throw new Error(
        `one-shot shard mismatch: requested ${shardIndex}, got ${result.shardIndex}`,
      );
    shardResults.push(result);
  }

  const registrySourceCounts = new Set(
    shardResults.map((result) => Number(result.registrySourceCount)),
  );
  if (registrySourceCounts.size !== 1)
    throw new Error("manual shard registry source counts disagree");

  const registrySourceCount = [...registrySourceCounts][0];
  const registryKeys = shardResults.flatMap(
    (result) => result.plan?.sourceKeys ?? [],
  );
  const uniqueRegistryKeys = [...new Set(registryKeys)];

  if (
    !shardArg &&
    (uniqueRegistryKeys.length !== registrySourceCount ||
      registryKeys.length !== uniqueRegistryKeys.length)
  )
    throw new Error(
      `manual shard coverage mismatch: expected ${registrySourceCount}, got ${uniqueRegistryKeys.length} unique from ${registryKeys.length} reported`,
    );

  const startedAt = shardResults
    .map((result) => result.startedAt)
    .sort()[0];
  const stateBySource = d1Read(
    stateSummarySql(uniqueRegistryKeys, startedAt),
  );
  const publishedOrRevalidatedBySource = d1Read(
    eventSummarySql(uniqueRegistryKeys, startedAt),
  );

  console.log(
    JSON.stringify(
      {
        manualRunId,
        alias,
        url,
        requestedShards,
        registrySourceCount,
        registryExpectedSourceKeys: uniqueRegistryKeys,
        shardResults,
        stateBySource,
        missingObservedSourceKeys: stateBySource
          .filter((row) => !Number(row.observed))
          .map((row) => row.source_key),
        publishedOrRevalidatedBySource,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(tempConfig, { force: true });
}
