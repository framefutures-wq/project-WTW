import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { requireRemoteReadApproval } from "./remote-read-guard.mjs";

requireRemoteReadApproval(
  [...process.argv.slice(2), "--remote"],
  "real-snapshot",
);
console.warn(
  "real-snapshot: remote production D1 snapshot을 1회 생성합니다. 이후 분석은 생성된 local artifact만 사용하세요.",
);

function remote(sql) {
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
      "--command",
      sql,
      "--json",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error("원격 D1 조회 실패");
  return JSON.parse(result.stdout)[0].results;
}
const sources = remote("SELECT * FROM sources WHERE kind='tourapi'");
const events = remote(
  "SELECT e.* FROM events e JOIN sources s ON s.id=e.primary_source_id WHERE e.is_sample=0 AND s.kind='tourapi'",
);
const evidence = remote(
  "SELECT ev.event_id,ev.source_id,ev.field,ev.excerpt,ev.checked_at FROM event_evidence ev JOIN sources s ON s.id=ev.source_id WHERE s.kind='tourapi'",
);
if (!events.some((e) => e.verification === "verified"))
  throw new Error(
    "실제 TourAPI 수집 결과가 없습니다. 로컬 데이터는 변경하지 않았습니다.",
  );
const quote = (value) =>
  value == null
    ? "NULL"
    : typeof value === "number"
      ? String(value)
      : "'" + String(value).replaceAll("'", "''") + "'";
const statements = [];
for (const [table, rows, conflict] of [
  ["sources", sources, "id"],
  ["events", events, "id"],
  ["event_evidence", evidence, "event_id,source_id,field"],
]) {
  for (const row of rows) {
    const columns = Object.keys(row);
    statements.push(
      `INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map((c) => quote(row[c])).join(",")}) ON CONFLICT(${conflict}) DO UPDATE SET ${columns.map((c) => `${c}=excluded.${c}`).join(",")};`,
    );
  }
}
mkdirSync(".wrangler/deployment", { recursive: true });
writeFileSync(
  ".wrangler/deployment/tourapi-real.json",
  JSON.stringify({ sources, events, evidence }, null, 2),
);
writeFileSync(".wrangler/deployment/tourapi-real.sql", statements.join("\n"));
const imported = spawnSync(
  "npx",
  [
    "wrangler",
    "d1",
    "execute",
    "weekend-mwohae",
    "--local",
    "--config",
    "wrangler.jsonc",
    "--file",
    ".wrangler/deployment/tourapi-real.sql",
  ],
  { encoding: "utf8" },
);
if (imported.status !== 0) {
  console.error(imported.stderr);
  process.exit(imported.status ?? 1);
}
console.log(
  `TourAPI 실제 행사 ${events.length}건을 기존 로컬 D1에 복사했습니다. Secret은 복사하지 않았습니다.`,
);
