import { spawnSync } from "node:child_process";
import {
  assertReadOnlySql,
  parseWranglerD1Rows,
  municipalStateSql,
  municipalPublishedSql,
  detailBacklogSql,
} from "./morning-production-check-lib.mjs";

if (!process.argv.includes("--remote"))
  throw new Error("usage: npm run verify:morning:prod -- --remote");

const query = (sql) => {
  const safe = assertReadOnlySql(sql);
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
      safe,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.status !== 0)
    throw new Error(result.stderr || result.stdout || "remote D1 read failed");
  return parseWranglerD1Rows(result.stdout);
};

const safeJson = (value) => {
  try {
    return typeof value === "string" ? JSON.parse(value) : value ?? null;
  } catch {
    return null;
  }
};

const base = query(`
  SELECT id,started_at,finished_at,status,message,stale_count
  FROM sync_runs
  WHERE provider='tourapi'
  ORDER BY started_at DESC
  LIMIT 1
`)[0] ?? null;

if (!base) {
  console.log(JSON.stringify({
    mode: "read-only",
    production_write: false,
    verdict: "NO_BASE_RUN",
    base: null,
  }, null, 2));
  process.exit(0);
}

const detailRuns = query(`
  SELECT id,started_at,finished_at,status,message
  FROM sync_runs
  WHERE provider='tourapi-detail'
    AND julianday(started_at)>=julianday('${base.started_at}')
  ORDER BY started_at ASC
  LIMIT 10
`);

const municipalState = query(municipalStateSql(base.started_at));
const municipalPublished = query(municipalPublishedSql(base.started_at));
const backlog = query(detailBacklogSql())[0] ?? null;
const baseMessage = safeJson(base.message);
const details = detailRuns.map((row) => ({
  ...row,
  message: safeJson(row.message),
}));

const verdict =
  base.status !== "success"
    ? "BASE_NEEDS_ATTENTION"
    : municipalState.some((row) => Number(row.observed) === 0)
      ? "BASE_OK_MUNICIPAL_SOURCE_NOT_OBSERVED"
      : "BASE_OK";

console.log(JSON.stringify({
  mode: "read-only",
  production_write: false,
  checked_at: new Date().toISOString(),
  verdict,
  base: {
    id: base.id,
    started_at: base.started_at,
    finished_at: base.finished_at,
    status: base.status,
    stale_count: base.stale_count,
    message: baseMessage,
  },
  deployed_municipal_batch: {
    state: municipalState,
    published_or_revalidated: municipalPublished,
  },
  detail_runs_since_base: details,
  tourapi_detail_backlog: backlog,
}, null, 2));
