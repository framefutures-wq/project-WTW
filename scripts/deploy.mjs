import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse } from "jsonc-parser";
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
if (configPath === "wrangler.production.jsonc") {
  const settings = parse(config);
  if (settings.vars.TOUR_API_ENABLED !== "true")
    throw new Error("운영 TourAPI 수집 설정이 비활성입니다.");
  const secrets = spawnSync(
    "npx",
    ["wrangler", "secret", "list", "--config", configPath],
    { encoding: "utf8" },
  );
  if (secrets.status !== 0)
    throw new Error("Cloudflare Secret 조회 실패: 로그인을 확인하세요.");
  const secretNames = JSON.parse(secrets.stdout).map((s) => s.name);
  if (!secretNames.includes("TOUR_API_KEY"))
    throw new Error(
      "배포 중단: TOUR_API_KEY를 먼저 Cloudflare Secret으로 등록하세요.",
    );
  if (settings.vars.WEB_PUSH_ENABLED === "true" && (!settings.vars.WEB_PUSH_VAPID_PUBLIC_KEY || !settings.vars.WEB_PUSH_VAPID_SUBJECT || !secretNames.includes("WEB_PUSH_VAPID_PRIVATE_KEY")))
    throw new Error("배포 중단: Web Push VAPID public/subject/private 설정을 먼저 완료하세요.");
  const cutoff = new Date(Date.now() - 72 * 3600_000).toISOString();
  const result = spawnSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      settings.d1_databases[0].database_name,
      "--remote",
      "--config",
      configPath,
      "--json",
      "--command",
      `SELECT count(*) AS n FROM events e JOIN sources s ON s.id=e.primary_source_id WHERE e.is_sample=0 AND e.verification='verified' AND s.kind='tourapi' AND e.status IN ('unknown','scheduled') AND e.checked_at >= '${cutoff}'`,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || !JSON.parse(result.stdout)[0]?.results[0]?.n)
    throw new Error(
      "배포 중단: 원격 D1에 최근 실제 TourAPI 데이터가 없습니다. tourapi:sync를 먼저 실행하세요.",
    );
}
for (const [command, args] of [
  ["npm", ["run", "check"]],
  ["npx", ["wrangler", "deploy", "--config", configPath]],
]) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
