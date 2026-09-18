import { AUDIENCES, THEMES, REGIONS, type Period } from "../shared/domain";
export class InputError extends Error {}
function one(
  value: string | null,
  allowed: readonly string[],
  fallback: string,
) {
  if (value === null) return fallback;
  if (!allowed.includes(value))
    throw new InputError("지원하지 않는 필터 값입니다.");
  return value;
}
export function parseFilters(params: URLSearchParams) {
  const period = one(
    params.get("period"),
    ["today", "weekend", "next-weekend"],
    "weekend",
  ) as Period;
  const region = one(params.get("region"), [...REGIONS], "");
  const audience = one(params.get("audience"), Object.keys(AUDIENCES), "");
  const theme = one(params.get("theme"), Object.keys(THEMES), "");
  const cost = one(params.get("cost"), ["free", "paid", "unknown"], "");
  const sort = one(params.get("sort"), ["date", "distance"], "date");
  const integer = (name: string, fallback: number, max: number) => {
    const raw = params.get(name);
    if (raw === null) return fallback;
    if (!/^\d+$/.test(raw))
      throw new InputError("페이지 값이 올바르지 않습니다.");
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > max)
      throw new InputError("페이지 범위를 확인해 주세요.");
    return value;
  };
  const coordinate = (name: string, min: number, max: number) => {
    const raw = params.get(name);
    if (raw === null) return null;
    if (!raw.trim()) throw new InputError("좌표가 비어 있습니다.");
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max)
      throw new InputError("좌표 범위를 확인해 주세요.");
    return value;
  };
  const lat = coordinate("lat", -90, 90),
    lng = coordinate("lng", -180, 180);
  if (
    (lat === null) !== (lng === null) ||
    (sort === "distance" && lat === null)
  )
    throw new InputError("거리순에는 위도와 경도가 필요합니다.");
  const q = (params.get("q") ?? "").trim();
  if (q.length > 80)
    throw new InputError("검색어는 80자 이내로 입력해 주세요.");
  return {
    period,
    region,
    audience,
    theme,
    cost,
    sort,
    lat,
    lng,
    q,
    page: integer("page", 1, 10000),
    limit: integer("limit", 12, 50),
  };
}
