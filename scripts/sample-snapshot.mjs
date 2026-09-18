import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const queries = [
  "SELECT * FROM sources WHERE kind='sample' AND id IN (SELECT primary_source_id FROM events WHERE is_sample=1) ORDER BY id",
  "SELECT * FROM events WHERE is_sample=1 ORDER BY id",
  "SELECT t.* FROM event_tags t JOIN events e ON e.id=t.event_id WHERE e.is_sample=1 ORDER BY t.event_id,t.tag",
];
const rows = queries.map((command) => {
  const result = spawnSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "weekend-mwohae",
      "--local",
      "--config",
      "wrangler.jsonc",
      "--json",
      "--command",
      command,
    ],
    { encoding: "utf8", timeout: 30000 },
  );
  if (result.status !== 0)
    throw new Error(result.stderr || "로컬 D1 스냅샷 조회 실패");
  const data = JSON.parse(result.stdout);
  if (!data[0]?.success) throw new Error("로컬 D1 조회 실패");
  return data[0].results;
});
if (
  !rows[1].length ||
  rows[1].some((e) => e.is_sample !== 1 || e.verification !== "sample")
)
  throw new Error("샘플 스냅샷만 원격으로 옮길 수 있습니다.");
const quote = (value) =>
  value === null
    ? "NULL"
    : typeof value === "number"
      ? String(value)
      : `'${String(value).replaceAll("'", "''")}'`;
let sql =
  "-- 기존 로컬 D1의 가상 샘플 스냅샷. 신규 또는 빈 원격 DB에만 적용합니다.\n";
for (const [index, table] of ["sources", "events", "event_tags"].entries())
  for (const row of rows[index]) {
    const columns = Object.keys(row);
    if (columns.some((c) => !/^\w+$/.test(c)))
      throw new Error("지원하지 않는 열 이름");
    sql += `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map((c) => quote(row[c])).join(",")});\n`;
  }
mkdirSync(".wrangler/deployment", { recursive: true });
writeFileSync(".wrangler/deployment/sample-snapshot.sql", sql);
writeFileSync(
  ".wrangler/deployment/sample-snapshot.json",
  JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      sources: rows[0],
      events: rows[1],
      tags: rows[2],
    },
    null,
    2,
  ),
);
console.log(
  `로컬 가상 행사 ${rows[1].length}개와 태그 ${rows[2].length}개를 보존했습니다. .wrangler/deployment/sample-snapshot.sql`,
);
