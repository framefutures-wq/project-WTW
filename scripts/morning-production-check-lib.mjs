const PROD_MUNICIPAL_KEYS = [
  "paju",
  "suwon",
  "goyang",
  "hwaseong",
  "bucheon",
  "taebaek",
  "seoul-hangang",
  "daejeon-fvu",
  "incheon-res",
  "gyeonggi-과천",
  "gyeonggi-하남",
  "gyeongbuk-상주",
  "gyeonggi-평택",
  "gyeonggi-여주",
  "gyeongbuk-경산",
  "incheon-서해",
  "jeonnam-gwangju-곡성",
  "gyeonggi-광주",
  "seoul-gangnam",
  "ulsan-북",
  "daegu-서",
  "gangwon-원주",
  "gyeonggi-용인",
  "gyeonggi-이천",
  "gyeonggi-의정부",
  "chungbuk-옥천",
  "gyeongbuk-안동",
  "busan-동",
  "gyeongbuk-영주",
  "busan-해운대",
  "gyeongbuk-경주",
  "ulsan-jung",
  "gyeongbuk-포항",
  "gyeonggi-포천",
  "gyeongnam-거제",
];

export function assertReadOnlySql(sql) {
  const normalized = String(sql ?? "").replace(/--.*$/gm, " ").trim();
  if (!/^(?:SELECT|WITH)\b/i.test(normalized))
    throw new Error("morning production check permits SELECT/WITH only");
  if (/\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|VACUUM|ATTACH|DETACH|PRAGMA)\b/i.test(normalized))
    throw new Error("morning production check rejected mutating SQL");
  return normalized;
}

export function parseWranglerD1Rows(output) {
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed) || !parsed[0] || !Array.isArray(parsed[0].results))
    throw new Error("unexpected wrangler D1 JSON");
  return parsed[0].results;
}

export function assertIsoTimestamp(value) {
  if (!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(String(value ?? "")))
    throw new Error("invalid sync run timestamp");
  return value;
}

const registryValues = () =>
  PROD_MUNICIPAL_KEYS.map((key) => `('${key.replaceAll("'", "''")}')`).join(",");

export function municipalStateSql(startedAt) {
  assertIsoTimestamp(startedAt);
  return assertReadOnlySql(`
    WITH registry(source_key) AS (VALUES ${registryValues()}), states AS (
      SELECT source_key,
        COUNT(*) AS candidates,
        SUM(CASE WHEN julianday(last_seen_at)>=julianday('${startedAt}') THEN 1 ELSE 0 END) AS observed,
        SUM(CASE WHEN decision_state='AUTO_PUBLISH' THEN 1 ELSE 0 END) AS AUTO_PUBLISH,
        SUM(CASE WHEN decision_state='AUTO_RETRY' THEN 1 ELSE 0 END) AS AUTO_RETRY,
        SUM(CASE WHEN decision_state='AUTO_EXCLUDE' THEN 1 ELSE 0 END) AS AUTO_EXCLUDE,
        SUM(CASE WHEN decision_state='POLICY_SKIP' THEN 1 ELSE 0 END) AS POLICY_SKIP,
        SUM(CASE WHEN decision_state='EXPIRED' THEN 1 ELSE 0 END) AS EXPIRED
      FROM municipal_candidate_state
      WHERE source_key IN (SELECT source_key FROM registry)
      GROUP BY source_key
    )
    SELECT registry.source_key,
      COALESCE(states.candidates,0) AS candidates,
      COALESCE(states.observed,0) AS observed,
      COALESCE(states.AUTO_PUBLISH,0) AS AUTO_PUBLISH,
      COALESCE(states.AUTO_RETRY,0) AS AUTO_RETRY,
      COALESCE(states.AUTO_EXCLUDE,0) AS AUTO_EXCLUDE,
      COALESCE(states.POLICY_SKIP,0) AS POLICY_SKIP,
      COALESCE(states.EXPIRED,0) AS EXPIRED
    FROM registry LEFT JOIN states USING(source_key)
    ORDER BY registry.source_key
  `);
}

export function municipalPublishedSql(startedAt) {
  assertIsoTimestamp(startedAt);
  return assertReadOnlySql(`
    WITH registry(source_key) AS (VALUES ${registryValues()})
    SELECT registry.source_key, COUNT(events.id) AS published_or_revalidated
    FROM registry
    LEFT JOIN events
      ON events.primary_source_id LIKE 'municipal-source-municipal-' || registry.source_key || '-%'
      AND julianday(events.updated_at)>=julianday('${startedAt}')
    GROUP BY registry.source_key
    ORDER BY registry.source_key
  `);
}

export function summarizeMunicipalSourceOutcomes(message) {
  const outcomes = Array.isArray(message?.municipal?.source_outcomes)
    ? message.municipal.source_outcomes
    : [];
  const expected = new Set(PROD_MUNICIPAL_KEYS);
  const bySource = new Map();
  for (const row of outcomes) {
    if (!row || typeof row.source !== "string" || !expected.has(row.source))
      continue;
    bySource.set(row.source, row);
  }
  const missing = PROD_MUNICIPAL_KEYS.filter((key) => !bySource.has(key));
  const errors = PROD_MUNICIPAL_KEYS
    .map((key) => bySource.get(key))
    .filter((row) => row?.status === "error")
    .map((row) => ({
      source: row.source,
      candidates: Number(row.candidates ?? 0),
      reason: typeof row.reason === "string" ? row.reason : "source_error",
    }));
  const ok = PROD_MUNICIPAL_KEYS.filter(
    (key) => bySource.get(key)?.status === "ok",
  ).length;
  return {
    expected: PROD_MUNICIPAL_KEYS.length,
    reported: bySource.size,
    ok,
    error: errors.length,
    missing,
    errors,
  };
}

export function detailBacklogSql() {
  return assertReadOnlySql(`
    WITH target AS (
      SELECT e.id
      FROM events e
      JOIN sources s ON s.id=e.primary_source_id
      WHERE e.is_sample=0
        AND e.verification='verified'
        AND s.kind='tourapi'
        AND e.end_date>=date('now','+9 hours')
        AND e.start_date<=date('now','+9 hours','+30 days')
    )
    SELECT
      COUNT(*) AS target,
      SUM(CASE WHEN ds.status='success' THEN 1 ELSE 0 END) AS success,
      SUM(CASE WHEN ds.status='empty' THEN 1 ELSE 0 END) AS empty,
      SUM(CASE WHEN ds.status='failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN ds.event_id IS NULL THEN 1 ELSE 0 END) AS never_processed,
      SUM(CASE WHEN ds.status='failed' AND ds.next_retry_at IS NOT NULL
        AND julianday(ds.next_retry_at)<=julianday('now') THEN 1 ELSE 0 END) AS retry_due,
      SUM(CASE WHEN ds.status='failed' AND ds.next_retry_at IS NOT NULL
        AND julianday(ds.next_retry_at)>julianday('now') THEN 1 ELSE 0 END) AS retry_waiting
    FROM target
    LEFT JOIN tourapi_detail_state ds ON ds.event_id=target.id
  `);
}

export const productionMunicipalKeys = PROD_MUNICIPAL_KEYS;
