import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const configPath =
  process.argv[2] === "--sample"
    ? "wrangler.sample.jsonc"
    : "wrangler.production.jsonc";
const config = readFileSync(configPath, "utf8");
if (config.includes("REPLACE_WITH_PRODUCTION_D1_ID")) {
  console.error(
    "배포 중단: 운영 D1을 생성하고 wrangler.production.jsonc의 database_id를 입력하세요. README를 참고하세요.",
  );
  process.exit(1);
}
for (const [command, args] of [
  ["npm", ["run", "check"]],
  ["npx", ["wrangler", "deploy", "--config", configPath]],
]) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
