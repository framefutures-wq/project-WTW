import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const arg = process.argv.find((value) => value.startsWith("--minutes="));
const minutes = arg ? Number(arg.slice("--minutes=".length)) : 30;
if (!Number.isFinite(minutes) || minutes <= 0)
  throw new Error("Use --minutes=<positive number>.");

const registrySource = readFileSync(
  "shared/municipal-source-registry.ts",
  "utf8",
);
const registryKeys = [
  ...registrySource.matchAll(/\bkey:\s*"([^"]+)"/g),
].map((match) => match[1]);
if (!registryKeys.length)
  throw new Error("municipal registry keys unavailable");

const since = new Date(Date.now() - minutes * 60_000).toISOString();
const sqlQuote = (value) =>
  "'" + String(value).replaceAll("'", "''") + "'";

const runD1 = (sql) => {
  const result = spawnSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "weekend-mwohae-production",
      "--remote",
      "--config",
      "wrangler.production.jsonc",
      "--json",
      "--command",
      sql,
    ],
    {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  if (result.status !== 0)
    throw new Error(
      result.stderr || result.stdout || "wrangler D1 read failed",
    );
  return JSON.parse(result.stdout)[0]?.results ?? [];
};

const keyRows = registryKeys
  .map((key) => "(" + sqlQuote(key) + ")")
  .join(",");

const stateBySource = runD1(`
  WITH registry(source_key) AS (VALUES ${keyRows}), states AS (
    SELECT
      source_key,
      COUNT(*) AS candidates,
      MAX(last_seen_at) AS latest_seen_at,
      SUM(
        CASE
          WHEN julianday(last_seen_at) >= julianday(${sqlQuote(since)})
          THEN 1 ELSE 0
        END
      ) AS observed,
      SUM(CASE WHEN decision_state='AUTO_PUBLISH' THEN 1 ELSE 0 END)
        AS AUTO_PUBLISH,
      SUM(CASE WHEN decision_state='AUTO_RETRY' THEN 1 ELSE 0 END)
        AS AUTO_RETRY,
      SUM(CASE WHEN decision_state='AUTO_EXCLUDE' THEN 1 ELSE 0 END)
        AS AUTO_EXCLUDE,
      SUM(CASE WHEN decision_state='POLICY_SKIP' THEN 1 ELSE 0 END)
        AS POLICY_SKIP,
      SUM(CASE WHEN decision_state='EXPIRED' THEN 1 ELSE 0 END)
        AS EXPIRED
    FROM municipal_candidate_state
    GROUP BY source_key
  )
  SELECT
    registry.source_key,
    COALESCE(states.candidates, 0) AS candidates,
    COALESCE(states.observed, 0) AS observed,
    states.latest_seen_at,
    COALESCE(states.AUTO_PUBLISH, 0) AS AUTO_PUBLISH,
    COALESCE(states.AUTO_RETRY, 0) AS AUTO_RETRY,
    COALESCE(states.AUTO_EXCLUDE, 0) AS AUTO_EXCLUDE,
    COALESCE(states.POLICY_SKIP, 0) AS POLICY_SKIP,
    COALESCE(states.EXPIRED, 0) AS EXPIRED
  FROM registry
  LEFT JOIN states USING(source_key)
  ORDER BY registry.source_key
`);

const publishedOrRevalidatedBySource = runD1(`
  WITH registry(source_key) AS (VALUES ${keyRows})
  SELECT
    registry.source_key,
    COUNT(events.id) AS published_or_revalidated
  FROM registry
  LEFT JOIN events ON
    instr(
      events.primary_source_id,
      'municipal-source-municipal-' || registry.source_key || '-'
    ) = 1
    AND julianday(events.updated_at) >= julianday(${sqlQuote(since)})
  GROUP BY registry.source_key
  ORDER BY registry.source_key
`);

const richDetailBackfilledEvents = runD1(`
  SELECT
    e.id,
    e.title,
    e.region,
    e.start_date,
    e.end_date,
    e.cost,
    e.price_text,
    s.url AS source_url,
    CASE
      WHEN en.summary IS NOT NULL AND length(trim(en.summary)) > 0
      THEN 1 ELSE 0
    END AS has_summary,
    CASE
      WHEN img.image_status='ok' AND img.image_url IS NOT NULL
      THEN 1 ELSE 0
    END AS has_image,
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
    AND julianday(s.fetched_at) >= julianday(${sqlQuote(since)})
  ORDER BY e.region,e.start_date,e.title
`);

const seoulHangang = runD1(`
  SELECT
    e.id,
    e.title,
    e.description,
    e.venue,
    e.start_date,
    e.end_date,
    e.cost,
    e.price_text,
    s.url AS source_url,
    en.summary,
    img.image_url,
    (SELECT COUNT(*) FROM event_operating_hours oh
      WHERE oh.event_id=e.id) AS hours_count,
    (SELECT COUNT(*) FROM event_programs p
      WHERE p.event_id=e.id) AS programs_count,
    json_extract(
      s.raw_payload,
      '$.municipal_rich_detail.contact_phone'
    ) AS contact_phone
  FROM events e
  LEFT JOIN sources s ON s.id=e.primary_source_id
  LEFT JOIN event_enrichments en ON en.event_id=e.id
  LEFT JOIN event_images img ON img.event_id=e.id
  WHERE instr(e.title, '달빛 한가위 마당') > 0
  ORDER BY e.updated_at DESC
`);

const missingObservedSourceKeys = stateBySource
  .filter((row) => !Number(row.observed))
  .map((row) => row.source_key);

console.log(
  JSON.stringify(
    {
      mode: "read-only",
      since,
      minutes,
      registrySourceCount: registryKeys.length,
      observedSourceCount:
        registryKeys.length - missingObservedSourceKeys.length,
      missingObservedSourceKeys,
      stateBySource,
      publishedOrRevalidatedBySource,
      richDetailBackfilledEvents,
      seoulHangang,
    },
    null,
    2,
  ),
);
