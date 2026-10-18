export const KOREAN_FOLK_DISCOVERY_URL = "https://www.koreanfolk.co.kr/";
export const KOREAN_FOLK_VENUE_URL = "https://www.koreanfolk.co.kr/about";
export const KOREAN_FOLK_VENUE = "한국민속촌";
export const KOREAN_FOLK_ADDRESS = "경기도 용인시 기흥구 민속촌로 90";

export type KoreanFolkListingItem = { officialItemId: string; officialUrl: string; listingTitle: string; startDate: string; endDate: string };
export type KoreanFolkDetail = { title: string; startDate: string; endDate: string; description: string | null };

const date = (value: string) => {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  return match ? `20${match[1]}-${match[2]}-${match[3]}` : null;
};
const decode = (value: string) => value.replace(/\\n/g, " ").replace(/\\\"/g, '"').trim();

/** Homepage banners are the source's official, current promotion listing. */
export function parseKoreanFolkListing(html: string): KoreanFolkListingItem[] {
  const marker = /href="\/home\/promotion\/event\/\d+/;
  if (!marker.test(html)) throw new Error("source_parse_health_failed");
  const rows = new Map<string, KoreanFolkListingItem>();
  const pattern = /href="\/home\/promotion\/event\/(\d+)[^"]*"[\s\S]{0,5000}?alt="([^"]+)"[\s\S]{0,2500}?(\d{2}\.\d{2}\.\d{2})\([^)]*\)\s*-\s*(\d{2}\.\d{2}\.\d{2})\(/g;
  for (const match of html.matchAll(pattern)) {
    const startDate = date(match[3]), endDate = date(match[4]);
    if (!startDate || !endDate) continue;
    rows.set(match[1], { officialItemId: match[1], officialUrl: `https://www.koreanfolk.co.kr/home/promotion/event/${match[1]}`, listingTitle: decode(match[2]), startDate, endDate });
  }
  if (!rows.size) throw new Error("source_parse_zero_candidates");
  return [...rows.values()];
}

export function parseKoreanFolkDetail(html: string): KoreanFolkDetail {
  const title = html.match(/\\?"title\\?",\\?(?:\d+,)?\\?"([^"\\]+)\\?"/);
  const startsAt = html.match(/\\?"startsAt\\?",\\?"(\d{2}\.\d{2}\.\d{2})\\?"/);
  const endsAt = html.match(/\\?"endsAt\\?",\\?"(\d{2}\.\d{2}\.\d{2})\\?"/);
  const startDate = startsAt?.[1] && date(startsAt[1]);
  const endDate = endsAt?.[1] && date(endsAt[1]);
  if (!title?.[1] || !startDate || !endDate) throw new Error("detail_core_parse_failed");
  // The official page's streamed record omits this optional value by placing
  // the next field name after `description`; it is not safe to infer prose
  // from that serialization. Keep it null until an explicit text field exists.
  return { title: decode(title[1]), startDate, endDate, description: null };
}

export function koreanFolkSelection(title: string, description: string | null) {
  const text = `${title} ${description ?? ""}`;
  if (/(이용권|입장권|할인|쿠폰|상품|패키지|스토어|선물)/.test(text)) return "EXCLUDE" as const;
  // This dedicated official promotion channel also contains commercial banners;
  // only explicit seasonal/special-event vocabulary is allowed through.
  if (/(축제|행사|공연|퍼레이드|체험|추석|귀신|심야|야간|공포)/.test(text)) return "MAIN" as const;
  return "RETRY" as const;
}
