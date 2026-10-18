import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
// This script never accepts a remote target or a user-supplied configuration.
const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const day = new Date(today + "T00:00:00Z").getUTCDay();
const weekendOffset = day === 0 ? -1 : 6 - day;
const date = (offset) =>
  new Date(new Date(today + "T00:00:00Z").getTime() + offset * 86400_000)
    .toISOString()
    .slice(0, 10);
const rows = [
  [
    "가을빛 꽃 산책",
    "서울",
    "가상 꽃정원",
    37.5665,
    126.978,
    "free",
    "무료 입장 · 체험 비용 별도(샘플)",
    "allowed",
    ["couple", "parents", "pets", "flowers"],
    0,
    weekendOffset + 1,
    "꽃 사이를 천천히 걷고, 작은 쉼을 만나는 하루.",
  ],
  [
    "동네 미식 마켓",
    "경기",
    "가상 마켓 광장",
    37.2636,
    127.0286,
    "free",
    "입장 무료 · 음식 구매 별도(샘플)",
    "unknown",
    ["couple", "food"],
    0,
    weekendOffset + 1,
    "다양한 먹거리를 둘러보는 주말 시장.",
  ],
  [
    "별빛 불꽃 나들이",
    "부산",
    "가상 바다공원",
    35.1796,
    129.0756,
    "free",
    "무료 관람(샘플)",
    "prohibited",
    ["couple", "fireworks", "performance"],
    weekendOffset,
    weekendOffset + 1,
    "바다를 배경으로 즐기는 가상의 불꽃 행사.",
  ],
  [
    "작은 손, 큰 상상",
    "서울",
    "가상 상상센터",
    37.575,
    126.98,
    "paid",
    "체험권 5,000원(샘플)",
    "prohibited",
    ["kids", "experience"],
    0,
    weekendOffset + 1,
    "아이와 함께 만들고 탐험하는 체험 나들이.",
  ],
  [
    "정원에서 만나는 음악",
    "경기",
    "가상 숲정원",
    37.4138,
    127.5183,
    "paid",
    "입장권 8,000원(샘플)",
    "allowed",
    ["parents", "couple", "pets", "flowers", "performance"],
    weekendOffset,
    weekendOffset + 1,
    "산책과 작은 공연을 함께 즐기는 하루.",
  ],
  [
    "반려친구 피크닉",
    "인천",
    "가상 잔디공원",
    37.4563,
    126.7052,
    "free",
    "무료 입장(샘플)",
    "allowed",
    ["pets", "experience"],
    weekendOffset,
    weekendOffset + 1,
    "반려동물과 함께 쉬어가는 가상의 야외 행사.",
  ],
  [
    "골목의 작은 공연",
    "대전",
    "가상 문화거리",
    36.3504,
    127.3845,
    "unknown",
    null,
    "unknown",
    ["couple", "parents", "performance"],
    0,
    0,
    "잠시 걸음을 멈추고 공연을 만나는 시간. 비용은 미확인으로 표시합니다.",
  ],
  [
    "제주 가을 미식회",
    "제주",
    "가상 미식마당",
    33.4996,
    126.5312,
    "paid",
    "입장권 10,000원(샘플)",
    "unknown",
    ["food", "couple"],
    weekendOffset + 7,
    weekendOffset + 8,
    "다음 주말을 위한 가상의 먹거리 행사.",
  ],
  [
    "숲속 가족 놀이터",
    "강원",
    "가상 숲체험장",
    37.8813,
    127.73,
    "free",
    "무료 체험(샘플)",
    "prohibited",
    ["kids", "parents", "experience"],
    weekendOffset + 7,
    weekendOffset + 8,
    "가족과 함께 자연을 만나는 가상 체험 행사.",
  ],
  [
    "가을꽃 작은 축제",
    "전남",
    "가상 꽃마을",
    34.8118,
    126.3922,
    "free",
    "무료 입장(샘플)",
    "unknown",
    ["flowers", "parents"],
    weekendOffset + 7,
    weekendOffset + 8,
    "꽃을 주제로 한 다음 주말 샘플.",
  ],
  [
    "우리 동네 무대",
    "대구",
    "가상 시민마당",
    35.8714,
    128.6014,
    "free",
    "무료 관람(샘플)",
    "unknown",
    ["performance", "kids"],
    weekendOffset,
    weekendOffset + 1,
    "일상 가까이에서 만나는 가상 공연 행사.",
  ],
  [
    "위치 미확인 공방",
    "충북",
    "가상 공방",
    null,
    null,
    "paid",
    "체험비 3,000원(샘플)",
    "unknown",
    ["kids", "experience"],
    weekendOffset,
    weekendOffset + 1,
    "좌표 미확인 행사는 거리순에서 마지막에 표시합니다.",
  ],
];
const quote = (value) =>
  value === null
    ? "NULL"
    : typeof value === "number"
      ? String(value)
      : `'${String(value).replaceAll("'", "''")}'`;
const now = new Date().toISOString();
const factTagMap = {
  food: "food",
  fireworks: "fireworks",
  flowers: "flower_garden",
  experience: "experience",
  performance: "performance",
};
const companionMap = {
  kids: ["child", "fit"],
  couple: ["couple", "fit"],
  parents: ["parents", "fit"],
  pets: ["pet", "allowed"],
};
let sql =
  "DELETE FROM events WHERE is_sample=1;\nINSERT OR REPLACE INTO sources(id,kind,priority,name,fetched_at) VALUES('sample-source','sample',5,'로컬 UI 검증용 가상 데이터'," +
  quote(now) +
  ");\n";
rows.forEach((r, i) => {
  const [
    title,
    region,
    venue,
    lat,
    lng,
    cost,
    price,
    pet,
    tags,
    start,
    end,
    description,
  ] = r;
  const id = `sample-${String(i + 1).padStart(2, "0")}`;
  const values = [
    id,
    title,
    description,
    region,
    venue,
    `${region} · 실제 방문지가 아닌 가상 장소`,
    date(start),
    date(end),
    lat,
    lng,
    cost,
    price,
    pet,
    "scheduled",
    "sample",
    1,
    "sample-source",
    now,
  ];
  sql +=
    "INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,lat,lng,cost,price_text,pet_policy,status,verification,is_sample,primary_source_id,checked_at) VALUES(" +
    values.map(quote).join(",") +
    ");\n";
  for (const tag of tags) {
    sql += `INSERT INTO event_tags(event_id,tag,classifier_type,rule_version) VALUES(${quote(id)},${quote(tag)},'legacy','legacy');\n`;
    const factTag = factTagMap[tag];
    if (factTag)
      sql += `INSERT INTO event_tags(event_id,tag,classifier_type,rule_version,rule_id,evidence_source_ref,evidence_field) VALUES(${quote(id)},${quote(factTag)},'deterministic_rule','fact_rules_v1','sample.seed.v1','sample-source','description');\n`;
    const companion = companionMap[tag];
    if (companion) {
      const [companionType, suitabilityState] = companion;
      sql += `INSERT INTO event_companion_suitability(event_id,companion_type,suitability_state,classifier_type,rule_version,rule_id,positive_reason_codes,caution_reason_codes,source_fact_tags) VALUES(${quote(id)},${quote(companionType)},${quote(suitabilityState)},'deterministic_rule','companion_rules_v1','sample.seed.v1','["sample_seed"]','[]','[]');\n`;
    }
  }
});
sql +=
  "INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,status,verification,is_sample,primary_source_id,checked_at) VALUES('sample-cancelled','취소된 샘플','추천에서 제외되어야 합니다.','서울','가상 장소','가상 주소'," +
  [
    today,
    date(weekendOffset + 8),
    "cancelled",
    "sample",
    1,
    "sample-source",
    now,
  ]
    .map(quote)
    .join(",") +
  ");\n";
const dir = mkdtempSync(join(tmpdir(), "weekend-seed-"));
try {
  const path = join(dir, "seed.sql");
  writeFileSync(path, sql);
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
      "--file",
      path,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else
    console.log(
      `가상 행사 ${rows.length}개 + 취소 샘플 1개 준비 완료 (${today} KST). 실제 행사 정보가 아닙니다.`,
    );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
