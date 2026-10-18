export type OwnershipType = "private" | "public" | "mixed_or_unclear";
export type Priority = "priority_high" | "priority_medium" | "priority_low";

export const normalizeRegistryText = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^0-9a-z가-힣]/g, "");

export const normalizeHomepageUrl = (value: string) => {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
};

const excludedDomain = /(^|\.)(data\.go\.kr|visitkorea\.or\.kr|api\.visitkorea\.or\.kr|tourapi|google\.com|kakao\.com|naver\.com|daum\.net)(\.|$)|cdn|image|map/i;
export const officialCandidateDomain = (value: string) => {
  const normalized = normalizeHomepageUrl(value);
  if (!normalized) return null;
  const host = new URL(normalized).hostname.toLowerCase().replace(/^www\./, "");
  return excludedDomain.test(host) ? null : host;
};

export const extractHomepageUrls = (value: unknown) => {
  const raw = String(value ?? "").replace(/&amp;/gi, "&");
  const text = raw.replace(/<[^>]*>/g, " ");
  const matches = (`${raw} ${text}`).match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  const urls = matches.map((url) => url.replace(/[),.;]+$/, "")).map(normalizeHomepageUrl).filter((url): url is string => Boolean(url));
  return [...new Set(urls)];
};

export const classifyOwnership = (name: string, seedOwnership?: OwnershipType): OwnershipType => seedOwnership ?? (/(시청|군청|구청|도청|문화재단|관광공사|공단|공사|국립|시립|도립|재단법인)/.test(name) ? "public" : "mixed_or_unclear");

export const priorityFor = ({ eventCount, seed, sponsor, domain, dedicatedVenue }: { eventCount: number; seed: boolean; sponsor: boolean; domain: boolean; dedicatedVenue: boolean; }) => {
  const score = Math.min(eventCount * 10, 40) + (seed ? 20 : 0) + (sponsor ? 15 : 0) + (domain ? 10 : 0) + (dedicatedVenue ? 5 : 0);
  const priority: Priority = score >= 45 ? "priority_high" : score >= 25 ? "priority_medium" : "priority_low";
  return { score, priority };
};
