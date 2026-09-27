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

const postShard = (url, shardIndex) => {
  const result = spawnSync(
    "curl",
    [
      "--silent",
      "--show-error",
      "--fail-with-body",
      "--connect-timeout",
      "30",
      "--max-time",
      String(14 * 60),
      "--request",
      "POST",
      "--header",
      `x-manual-municipal-nonce: ${nonce}`,
      "--header",
      `x-manual-municipal-shard: ${shardIndex}`,
      url,
    ],
    {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  if (result.status !== 0)
    throw new Error(
      `one-shot shard ${shardIndex} transport failed: ${(
        result.stderr ||
        result.stdout ||
        "curl command failed"
      ).trim()}`,
    );
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `one-shot shard ${shardIndex} returned invalid JSON`,
    );
  }
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

const richDetailVerificationSql = (startedAt) => `
  SELECT
    e.id,
    e.title,
    e.region,
    e.start_date,
    e.end_date,
    e.cost,
    e.price_text,
    s.url AS source_url,
    CASE WHEN en.summary IS NOT NULL AND length(trim(en.summary)) > 0
      THEN 1 ELSE 0 END AS has_summary,
    CASE WHEN img.image_status='ok' AND img.image_url IS NOT NULL
      THEN 1 ELSE 0 END AS has_image,
    (SELECT COUNT(*) FROM event_operating_hours oh
      WHERE oh.event_id=e.id) AS hours_count,
    (SELECT COUNT(*) FROM event_programs p
      WHERE p.event_id=e.id) AS programs_count,
    json_extract(
      s.raw_payload,
      '$.municipal_rich_detail.contact_phone'
    ) AS contact_phone
  FROM sources s
  JOIN events e ON e.primary_source_id=s.id
  LEFT JOIN event_enrichments en ON en.event_id=e.id
  LEFT JOIN event_images img ON img.event_id=e.id
  WHERE s.kind='municipality'
    AND s.raw_payload IS NOT NULL
    AND julianday(s.fetched_at) >= julianday(${sqlQuote(startedAt)})
  ORDER BY e.region,e.start_date,e.title
`;

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
  console.error(
    `[municipal:once] manualRunId=${manualRunId} shards=${requestedShards.join(",")}`,
  );
  for (const shardIndex of requestedShards) {
    console.error(`[municipal:once] shard ${shardIndex} start`);
    const result = postShard(url, shardIndex);
    if (result.shardIndex !== shardIndex)
      throw new Error(
        `one-shot shard mismatch: requested ${shardIndex}, got ${result.shardIndex}`,
      );
    shardResults.push(result);
    console.error(
      `[municipal:once] shard ${shardIndex} success sources=${result.plan?.sourceKeys?.length ?? 0} rich=${result.summary?.rich_detail_persisted ?? 0} errors=${result.summary?.source_errors ?? 0}`,
    );
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
  const richDetailBackfilledEvents = d1Read(
    richDetailVerificationSql(startedAt),
  );

  const aggregate = shardResults.reduce(
    (total, shard) => {
      const summary = shard.summary ?? {};
      for (const key of [
        "discovered",
        "inserted",
        "updated",
        "source_errors",
        "detail_fetches",
        "identity_bridges",
        "rich_detail_attempted",
        "rich_detail_candidates",
        "rich_detail_persisted",
        "rich_detail_errors",
      ])
        total[key] += Number(summary[key] ?? 0);
      for (const [source, count] of Object.entries(
        summary.rich_detail_by_source ?? {},
      ))
        total.rich_detail_by_source[source] =
          (total.rich_detail_by_source[source] ?? 0) + Number(count ?? 0);
      return total;
    },
    {
      discovered: 0,
      inserted: 0,
      updated: 0,
      source_errors: 0,
      detail_fetches: 0,
      identity_bridges: 0,
      rich_detail_attempted: 0,
      rich_detail_candidates: 0,
      rich_detail_persisted: 0,
      rich_detail_errors: 0,
      rich_detail_by_source: {},
    },
  );

  console.log(
    JSON.stringify(
      {
        manualRunId,
        requestedShards,
        registrySourceCount,
        registryExpectedSourceKeys: uniqueRegistryKeys,
        shardResults: shardResults.map((shard) => ({
          shardIndex: shard.shardIndex,
          plan: shard.plan,
          summary: shard.summary,
        })),
        aggregate,
        stateBySource,
        missingObservedSourceKeys: stateBySource
          .filter((row) => !Number(row.observed))
          .map((row) => row.source_key),
        publishedOrRevalidatedBySource,
        richDetailBackfilledEvents,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(tempConfig, { force: true });
}
