export type CachedUrlEvidence = {
  url: string;
  path: string;
  asset?: boolean;
};

export type OtherHttpsCandidate = {
  url: string;
  path: string;
  host: string;
  category: "SOCIAL" | "TICKETING" | "MAP_OR_SHORTENER" | "GENERAL_WEB";
};

const PROVIDER_HOSTS = [
  "data.go.kr",
  "apis.data.go.kr",
  "api.visitkorea.or.kr",
  "apis.visitkorea.or.kr",
  "korean.visitkorea.or.kr",
  "english.visitkorea.or.kr",
  "tong.visitkorea.or.kr",
] as const;

const SOCIAL_HOSTS = [
  "instagram.com",
  "www.instagram.com",
  "facebook.com",
  "www.facebook.com",
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "blog.naver.com",
  "m.blog.naver.com",
] as const;

const TICKETING_HOSTS = [
  "ticketlink.co.kr",
  "www.ticketlink.co.kr",
  "tickets.interpark.com",
  "nol.interpark.com",
  "booking.naver.com",
  "m.booking.naver.com",
] as const;

const MAP_OR_SHORTENER_HOSTS = [
  "map.naver.com",
  "naver.me",
  "kko.kakao.com",
  "place.map.kakao.com",
] as const;

function hostMatches(host: string, candidates: readonly string[]) {
  return candidates.some(
    (candidate) => host === candidate || host.endsWith(`.${candidate}`),
  );
}

export function titleTokens(title: string) {
  return [
    ...new Set(
      title
        .normalize("NFKC")
        .replace(/20\d{2}/g, " ")
        .replace(/[()\[\]{}:·,.'"“”‘’!?/\\|_+=~`@#$%^&*<>-]/g, " ")
        .split(/\s+/)
        .map((token) => token.trim().toLowerCase())
        .filter((token) => token.length >= 2)
        .filter(
          (token) =>
            !["축제", "행사", "공연", "페스티벌", "festival"].includes(token),
        ),
    ),
  ].slice(0, 8);
}

export function pageMentionsEventTitle(input: {
  title: string;
  pageTitle?: string | null;
  pageText?: string | null;
}) {
  const tokens = titleTokens(input.title);
  if (!tokens.length) return false;
  const haystack = `${input.pageTitle ?? ""} ${input.pageText ?? ""}`
    .normalize("NFKC")
    .toLowerCase();
  const matches = tokens.filter((token) => haystack.includes(token)).length;
  return matches >= Math.min(2, tokens.length);
}

export function selectOtherHttpsCandidates(
  urls: CachedUrlEvidence[],
): OtherHttpsCandidate[] {
  const seen = new Set<string>();
  const result: OtherHttpsCandidate[] = [];

  for (const item of urls) {
    if (item.asset) continue;
    let parsed: URL;
    try {
      parsed = new URL(item.url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:") continue;
    const host = parsed.hostname.toLowerCase();
    if (hostMatches(host, PROVIDER_HOSTS)) continue;
    if (/homepage$/i.test(item.path)) continue;

    const key = parsed.href;
    if (seen.has(key)) continue;
    seen.add(key);

    let category: OtherHttpsCandidate["category"] = "GENERAL_WEB";
    if (hostMatches(host, SOCIAL_HOSTS)) category = "SOCIAL";
    else if (hostMatches(host, TICKETING_HOSTS)) category = "TICKETING";
    else if (hostMatches(host, MAP_OR_SHORTENER_HOSTS))
      category = "MAP_OR_SHORTENER";

    result.push({ url: key, path: item.path, host, category });
  }

  return result;
}