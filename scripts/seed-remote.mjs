import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse, printParseErrorCode } from "jsonc-parser";
const parseErrors = [];
const config = parse(
  readFileSync("wrangler.sample.jsonc", "utf8"),
  parseErrors,
  { allowTrailingComma: true },
);
if (parseErrors.length)
  throw new Error(
    `JSONC 설정 오류: ${printParseErrorCode(parseErrors[0].error)}`,
  );
if (
  config.vars.APP_MODE !== "sample" ||
  config.vars.TOUR_API_ENABLED !== "false" ||
  !/^[0-9a-f-]{36}$/.test(config.d1_databases[0].database_id) ||
  config.d1_databases[0].database_id.startsWith("00000000")
)
  throw new Error("샘플 배포용 실제 D1 설정이 필요합니다.");
const result = spawnSync(
  "npx",
  [
    "wrangler",
    "d1",
    "execute",
    "weekend-mwohae-production",
    "--remote",
    "--config",
    "wrangler.sample.jsonc",
    "--json",
    "--command",
    "SELECT count(*) AS count FROM events",
  ],
  { encoding: "utf8", timeout: 60000 },
);
if (result.status !== 0) throw new Error(result.stderr || "원격 D1 조회 실패");
if (JSON.parse(result.stdout)[0].results[0].count !== 0)
  throw new Error(
    "원격 DB에 행사가 있어 중단했습니다. 기존 데이터는 덮어쓰지 않습니다.",
  );
const imported = spawnSync(
  "npx",
  [
    "wrangler",
    "d1",
    "execute",
    "weekend-mwohae-production",
    "--remote",
    "--config",
    "wrangler.sample.jsonc",
    "--file",
    ".wrangler/deployment/sample-snapshot.sql",
    "--yes",
  ],
  { stdio: "inherit" },
);
process.exitCode = imported.status ?? 1;
