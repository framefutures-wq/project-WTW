import { spawnSync } from "node:child_process";
import { tourApiPrimaryImage } from "../shared/tourapi-images";

const args = process.argv.slice(2);
if (!args.includes("--remote") || !args.includes("--apply"))
  throw new Error("usage: npm run images:backfill:tourapi-primary -- --remote --apply");

const DB = "weekend-mwohae-production";
const CONFIG = "wrangler.production.jsonc";
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

function execute(sql: string) {
  const result = spawnSync("npx", [
    "wrangler","d1","execute",DB,"--remote","--config",CONFIG,"--command",sql,"--json",
  ], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) {
    const diagnostic = (result.stderr || result.stdout).trim().slice(0, 3000);
    throw new Error(`TourAPI primary-image backfill failed${diagnostic ? `: ${diagnostic}` : ""}`);
  }
  return JSON.parse(result.stdout)[0]?.results ?? [];
}

function sqlString(value: string) { return "'" + value.replaceAll("'", "''") + "'"; }
function parse(raw: string | null) {
  if (!raw) return null;
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
}

type Row = {
  id: string;
  checked_at: string;
  source_url: string;
  raw_payload: string | null;
};

const rows = execute(`
  SELECT e.id,e.checked_at,s.url AS source_url,s.raw_payload
  FROM events e
  JOIN sources s ON s.id=e.primary_source_id
  LEFT JOIN event_images ei ON ei.event_id=e.id
  WHERE e.is_sample=0
    AND e.verification='verified'
    AND e.publish_quality_state='PUBLIC'
    AND s.kind='tourapi'
    AND e.end_date>='${today}'
    AND (ei.event_id IS NULL OR ei.image_url IS NULL OR ei.image_status<>'ok')
  ORDER BY e.start_date,e.id
  LIMIT 1001
`) as Row[];

if (rows.length > 1000) throw new Error("TourAPI missing-primary-image set exceeds 1000");

const candidates = rows.flatMap((row) => {
  const raw = parse(row.raw_payload);
  const image = raw ? tourApiPrimaryImage(raw) : null;
  return image ? [{ ...row, image }] : [];
});

const batchSize = 50;
for (let index = 0; index < candidates.length; index += batchSize) {
  const batch = candidates.slice(index, index + batchSize);
  const values = batch.map((row) => `(
    ${sqlString(row.id)},${sqlString(row.image)},'tourapi',${sqlString(row.source_url)},1,'ok',NULL,NULL,NULL,${sqlString(row.checked_at)},'sources.raw_payload.firstimage_or_firstimage2'
  )`.replace(/\n\s*/g, "")).join(",");
  execute(`
    INSERT INTO event_images(
      event_id,image_url,source_type,source_page_url,is_primary,image_status,
      width,height,mime_type,last_checked_at,evidence_note
    ) VALUES ${values}
    ON CONFLICT(event_id) DO UPDATE SET
      image_url=excluded.image_url,
      source_type=excluded.source_type,
      source_page_url=excluded.source_page_url,
      image_status='ok',
      last_checked_at=excluded.last_checked_at,
      evidence_note=excluded.evidence_note
    WHERE event_images.image_status<>'ok' OR event_images.source_type='tourapi';
  `);
}

const remaining = execute(`
  SELECT COUNT(*) AS n
  FROM events e
  JOIN sources s ON s.id=e.primary_source_id
  LEFT JOIN event_images ei ON ei.event_id=e.id
  WHERE e.is_sample=0
    AND e.verification='verified'
    AND e.publish_quality_state='PUBLIC'
    AND s.kind='tourapi'
    AND e.end_date>='${today}'
    AND (ei.event_id IS NULL OR ei.image_url IS NULL OR ei.image_status<>'ok')
`)[0]?.n ?? null;

console.log(JSON.stringify({
  scanned_missing_tourapi_primary_images: rows.length,
  recoverable_from_raw_payload: candidates.length,
  inserted_or_refreshed_primary_images: candidates.length,
  remaining_missing_tourapi_primary_images: Number(remaining),
  write_batches: Math.ceil(candidates.length / batchSize),
}, null, 2));