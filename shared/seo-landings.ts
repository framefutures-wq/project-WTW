export type SeoLanding = {
  path: string;
  region: string;
  period: "weekend";
  title: string;
  description: string;
};

const WEEKEND_REGION_LANDINGS = [
  ["seoul", "서울"],
  ["busan", "부산"],
  ["daegu", "대구"],
  ["incheon", "인천"],
  ["gwangju", "광주"],
  ["daejeon", "대전"],
  ["ulsan", "울산"],
  ["sejong", "세종"],
  ["gyeonggi", "경기"],
  ["gangwon", "강원"],
  ["chungbuk", "충북"],
  ["chungnam", "충남"],
  ["jeonbuk", "전북"],
  ["jeonnam", "전남"],
  ["gyeongbuk", "경북"],
  ["gyeongnam", "경남"],
  ["jeju", "제주"],
] as const;

export const SEO_LANDINGS = WEEKEND_REGION_LANDINGS.map(
  ([slug, region]): SeoLanding => ({
    path: `/weekend/${slug}`,
    region,
    period: "weekend",
    title: `${region} 이번 주말 행사·축제 | 갈틈`,
    description: `${region}에서 이번 주말 열리는 축제·지역행사·체험을 한눈에 확인하세요. 날짜와 장소를 공식 확인 정보와 함께 보여드립니다.`,
  }),
);

export function seoLandingForPath(pathname: string): SeoLanding | null {
  return SEO_LANDINGS.find((landing) => landing.path === pathname) ?? null;
}
