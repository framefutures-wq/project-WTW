import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { chooseTourApiImage } from "./event-image-lib.mjs";

const DB = "weekend-mwohae-production";
const CONFIG = "wrangler.production.jsonc";
const now = new Date().toISOString();

function query(sql) {
  const result = spawnSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      DB,
      "--remote",
      "--config",
      CONFIG,
      "--command",
      sql,
      "--json",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error(result.stderr || "원격 D1 조회 실패");
  return JSON.parse(result.stdout)[0]?.results ?? [];
}
function paged(sql, size = 50) {
  const rows = [];
  for (let offset = 0; ; offset += size) {
    const page = query(`${sql} LIMIT ${size} OFFSET ${offset}`);
    rows.push(...page);
    if (page.length < size) return rows;
  }
}
const parse = (value, fallback) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};
const quote = (value) =>
  value == null
    ? "NULL"
    : typeof value === "number"
      ? String(value)
      : `'${String(value).replaceAll("'", "''")}'`;

const events = paged(
  "SELECT e.id,e.title,s.fetched_at AS fetched_at,s.raw_payload FROM events e JOIN sources s ON s.id=e.primary_source_id WHERE e.is_sample=0 AND s.kind='tourapi' ORDER BY e.id",
  50,
);
const audits = paged(
  "SELECT event_id,url_inventory_json FROM official_source_audits WHERE event_id IN (SELECT id FROM events WHERE is_sample=0) ORDER BY event_id",
  50,
);
const auditByEvent = new Map(audits.map((row) => [row.event_id, row]));
const rows = [];
for (const event of events) {
  const raw = parse(event.raw_payload, {}) || {};
  const inventory =
    parse(auditByEvent.get(event.id)?.url_inventory_json, []) || [];
  const candidate = chooseTourApiImage(raw, inventory);
  const chosen = candidate?.url ?? null;
  rows.push({
    event_id: event.id,
    image_url: chosen,
    source_type: chosen ? "tourapi" : null,
    source_page_url: chosen ? "https://korean.visitkorea.or.kr" : null,
    is_primary: 1,
    image_status: chosen ? "ok" : "missing",
    width: null,
    height: null,
    mime_type: null,
    last_checked_at: now,
    evidence_note:
      candidate?.evidence ??
      "저장된 공식 TourAPI 및 공식 출처 감사 데이터에 이미지 후보 없음",
  });
}
const counts = rows.reduce((acc, row) => {
  acc[row.image_status] = (acc[row.image_status] || 0) + 1;
  return acc;
}, {});
const sql = rows
  .map(
    (row) =>
      `INSERT INTO event_images(event_id,image_url,source_type,source_page_url,is_primary,image_status,width,height,mime_type,last_checked_at,evidence_note) VALUES(${Object.values(row).map(quote).join(",")}) ON CONFLICT(event_id) DO UPDATE SET image_url=excluded.image_url,source_type=excluded.source_type,source_page_url=excluded.source_page_url,is_primary=excluded.is_primary,image_status=excluded.image_status,width=excluded.width,height=excluded.height,mime_type=excluded.mime_type,last_checked_at=excluded.last_checked_at,evidence_note=excluded.evidence_note;`,
  )
  .join("\n");
mkdirSync(".wrangler/deployment", { recursive: true });
writeFileSync(
  ".wrangler/deployment/event-images.json",
  JSON.stringify(
    { generated_at: now, total: rows.length, counts, rows },
    null,
    2,
  ),
);
writeFileSync(".wrangler/deployment/event-images.sql", sql);
if (process.argv.includes("--write")) {
  const result = spawnSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      DB,
      "--remote",
      "--config",
      CONFIG,
      "--file",
      ".wrangler/deployment/event-images.sql",
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(
  JSON.stringify(
    {
      total: rows.length,
      image_ok: counts.ok || 0,
      missing: counts.missing || 0,
      source_types: { tourapi: counts.ok || 0 },
      generated_at: now,
      wrote: process.argv.includes("--write"),
    },
    null,
    2,
  ),
);
