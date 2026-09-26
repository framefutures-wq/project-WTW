export type SeoLanding = {
  path: string;
  region: string;
  period: "weekend";
  title: string;
  description: string;
};

export const SEO_LANDINGS = [
  {
    path: "/weekend/seoul",
    region: "서울",
    period: "weekend",
    title: "서울 이번 주말 행사·축제 | 갈틈",
    description:
      "서울에서 이번 주말 열리는 축제·지역행사·체험을 한눈에 확인하세요. 날짜와 장소를 공식 확인 정보와 함께 보여드립니다.",
  },
] as const satisfies readonly SeoLanding[];

export function seoLandingForPath(pathname: string): SeoLanding | null {
  return SEO_LANDINGS.find((landing) => landing.path === pathname) ?? null;
}
