import { mkdirSync, writeFileSync } from "node:fs";
import { classifyFactTags } from "../shared/fact-tags.ts";
import {
  PRIVATE_SOURCE_REGISTRY,
  canonicalPrivateIdentity,
  classifyDuplicate,
  classifyPrivateEligibility,
  isAllowedPrivateOfficialUrl,
  normalizeTitle,
} from "../shared/private-official-sources.ts";

const AS_OF = process.env.EVERLAND_AS_OF ?? "2026-09-20";
const FETCHED_AT = new Date().toISOString();
const SEEDS = [
  "https://web.everland.com/pick/2026/water-festival/show.html?idx=2",
  "https://web.everland.com/pick/2026/blood-city-zero/map.html",
  "https://web.everland.com/pick/2026/tulip_festival/entertainment.html",
  "https://reservation.everland.com/web/el.do?index_id=7&menu_id=0113&method=productMain",
];
const DATE_RE =
  /(?:~\s*)?(\d{4})[./](\d{1,2})[./](\d{1,2})\s*~\s*(?:(\d{4})[./])?(\d{1,2})[./](\d{1,2})/g;

function clean(value) {
  return value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function parseDateRange(text) {
  const ranges = [];
  for (const match of text.matchAll(DATE_RE)) {
    const [, year, month, day, endYear, endMonth, endDay] = match;
    const start = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    const end = `${endYear ?? year}-${endMonth.padStart(2, "0")}-${endDay.padStart(2, "0")}`;
    ranges.push({ start, end });
  }
  if (!ranges.length) return { start: null, end: null };
  return {
    start: ranges.map((range) => range.start).sort()[0],
    end: ranges
      .map((range) => range.end)
      .sort()
      .at(-1),
  };
}

function lifecycle(start, end) {
  if (!start || !end) return "unknown";
  if (end < AS_OF) return "ended";
  if (start > AS_OF) return "upcoming";
  return "active";
}

function htmlBlocks(html) {
  const headings = [...html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)];
  return headings
    .map((heading, index) => {
      const title = clean(heading[1]);
      // Everland renders the date/location metadata immediately before the
      // program heading. Keep a bounded prefix so the adapter does not need
      // a page-wide scan or a second request.
      const from = Math.max(0, heading.index - 1800);
      const to = headings[index + 1]?.index ?? html.length;
      return { title, text: clean(html.slice(from, to)) };
    })
    .filter(
      ({ title }) =>
        title &&
        title !== "Image" &&
        title !== "공유하기" &&
        !/^(이전|다음|맨위로 가기|상단으로)$/.test(title) &&
        title.length > 1,
    );
}

function knownEverlandBlocks(sourceUrl, html) {
  const path = new URL(sourceUrl).pathname;
  const names = path.includes("water-festival/show.html")
    ? [
        "슈팅 워터펀 시즌 2 : 게임 속으로",
        "밤밤맨 키즈 워터파티",
        "밤밤 썸머 나이트",
      ]
    : path.includes("tulip_festival/entertainment.html")
      ? [
          "에버랜드 스페셜 불꽃쇼 : 빛의 수호자들",
          "에버랜드 서커스 : 윙즈 오브 메모리",
          "카니발 판타지 퍼레이드",
          "레니와 라라의 매지컬 스케치북",
          "문라이트 퍼레이드",
        ]
      : path.includes("blood-city-zero/map.html")
        ? ["BLOOD CITY ZERO"]
        : path.includes("/web/el.do")
          ? [
              "에버랜드 이용권 종일권(제휴카드 할인)",
              "야간권",
              "윙즈 오브 메모리",
            ]
          : [];
  const searchableHtml = html
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/\s+/g, " ");
  return names
    .map((title) => {
      const index = html.indexOf(title);
      const searchableIndex = searchableHtml.indexOf(title);
      const context =
        index >= 0
          ? clean(html.slice(index, index + 1400))
          : searchableIndex < 0
            ? ""
            : clean(
                searchableHtml.slice(searchableIndex, searchableIndex + 1400),
              );
      return { title, text: context };
    })
    .filter((block) => block.text);
}

function hasKnownEverlandStructure(sourceUrl) {
  const path = new URL(sourceUrl).pathname;
  return (
    path.includes("water-festival/show.html") ||
    path.includes("tulip_festival/entertainment.html") ||
    path.includes("blood-city-zero/map.html") ||
    path.includes("/web/el.do")
  );
}

function sourcePageType(sourceUrl) {
  const url = new URL(sourceUrl);
  if (url.hostname === "reservation.everland.com")
    return "official_reservation_product";
  if (url.pathname.includes("water-festival")) return "official_event_program";
  if (url.pathname.includes("tulip_festival")) return "official_season_program";
  return "official_event_landing";
}

function inferVenue() {
  // Page-wide cleaned text joins neighbouring program metadata. Do not turn a
  // following program's copy into a venue. A page-specific extraction is
  // required before venue data can be emitted.
  return null;
}

function candidateFromBlock(sourceUrl, block) {
  const range = parseDateRange(block.text);
  const identity = canonicalPrivateIdentity({
    sourceKey: "everland",
    sourceUrl,
    title: block.title,
  });
  const canonicalSourceId = identity.canonicalSourceId;
  const eligibilityResult = classifyPrivateEligibility({
    title: block.title,
    startDate: range.start,
    endDate: range.end,
    description: block.text,
  });
  const facts = classifyFactTags(
    { id: canonicalSourceId, title: block.title },
    [
      {
        text: block.title,
        field: "title",
        source: sourceUrl,
        source_type: "organizer_official",
        checked_at: FETCHED_AT,
        scope: "event_level",
        strength: "direct_field",
      },
      {
        text: block.text,
        field: "overview",
        source: sourceUrl,
        source_type: "organizer_official",
        checked_at: FETCHED_AT,
        scope: "event_level",
        strength: "direct_field",
      },
    ],
  );
  return {
    sourceKey: "everland",
    sourceType: PRIVATE_SOURCE_REGISTRY.everland.sourceType,
    sourceUrl,
    sourcePageType: sourcePageType(sourceUrl),
    canonicalSourceId,
    canonicalIdentityStability: identity.stability,
    title: block.title,
    startDate: range.start,
    endDate: range.end,
    venueName: inferVenue(block.text),
    venueType: "theme_park",
    address: null,
    latitude: null,
    longitude: null,
    description: block.text || null,
    imageUrl: null,
    contactName: null,
    contactPhone: null,
    priceText: null,
    reservationUrl: null,
    fetchedAt: FETCHED_AT,
    evidence: [
      { field: "official_page", excerpt: block.text.slice(0, 500), sourceUrl },
    ],
    eligibility: eligibilityResult.eligibility,
    eligibilityReason: eligibilityResult.reason,
    factTags: facts.candidates,
    duplicateStatus: "ambiguous_duplicate",
    parentCandidateId: null,
    subEventCandidate: Boolean(range.start && range.end),
    lifecycle: lifecycle(range.start, range.end),
  };
}

async function fetchPage(url) {
  if (!isAllowedPrivateOfficialUrl("everland", url))
    throw new Error(`disallowed official host: ${url}`);
  const response = await fetch(url, { redirect: "manual" });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.text();
}

const pages = [];
const candidates = [];
for (const url of SEEDS) {
  const html = await fetchPage(url);
  const knownBlocks = knownEverlandBlocks(url, html);
  if (hasKnownEverlandStructure(url) && !knownBlocks.length) {
    throw new Error(
      `parser structure failure: no expected content blocks at ${url}`,
    );
  }
  const blocks = knownBlocks.length ? knownBlocks : htmlBlocks(html);
  const pageCandidates = blocks.map((block) => candidateFromBlock(url, block));
  pages.push({ url, status: "fetched", candidates: pageCandidates.length });
  candidates.push(...pageCandidates);
}

const existing = [];
const hasTourApiSnapshot = false;
for (const candidate of candidates) {
  candidate.duplicateStatus = hasTourApiSnapshot
    ? classifyDuplicate(candidate, existing)
    : "ambiguous_duplicate";
}

const report = {
  generatedAt: FETCHED_AT,
  asOf: AS_OF,
  source: PRIVATE_SOURCE_REGISTRY.everland,
  policy: {
    productionWrite: 0,
    d1Read: 0,
    tourApiSnapshot: "not provided; duplicate results remain ambiguous",
    parentChild:
      "independent title + complete period is a sub-event candidate; page-only context remains parent tag/evidence",
  },
  pagesFetched: pages.length,
  requests: pages.length,
  pages,
  candidates,
  counts: {
    candidates: candidates.length,
    eligible: candidates.filter((item) => item.eligibility === "eligible")
      .length,
    notEligible: candidates.filter(
      (item) => item.eligibility === "not_eligible",
    ).length,
    needsReview: candidates.filter(
      (item) => item.eligibility === "needs_review",
    ).length,
    active: candidates.filter((item) => item.lifecycle === "active").length,
    upcoming: candidates.filter((item) => item.lifecycle === "upcoming").length,
    ended: candidates.filter((item) => item.lifecycle === "ended").length,
    fireworks: candidates.filter((item) =>
      item.factTags.some((tag) => tag.tag === "fireworks"),
    ).length,
    performance: candidates.filter((item) =>
      item.factTags.some((tag) => tag.tag === "performance"),
    ).length,
    experience: candidates.filter((item) =>
      item.factTags.some((tag) => tag.tag === "experience"),
    ).length,
    flowerGarden: candidates.filter((item) =>
      item.factTags.some((tag) => tag.tag === "flower_garden"),
    ).length,
    probableDuplicate: candidates.filter(
      (item) => item.duplicateStatus === "probable_duplicate",
    ).length,
    newCandidate: candidates.filter(
      (item) => item.duplicateStatus === "new_candidate",
    ).length,
    ambiguousDuplicate: candidates.filter(
      (item) => item.duplicateStatus === "ambiguous_duplicate",
    ).length,
    parentCandidates: candidates.filter(
      (item) => item.parentCandidateId === null && !item.subEventCandidate,
    ).length,
    subEventCandidates: candidates.filter((item) => item.subEventCandidate)
      .length,
    dateExtracted: candidates.filter((item) => item.startDate && item.endDate)
      .length,
    venueExtracted: candidates.filter((item) => item.venueName).length,
    contactExtracted: candidates.filter((item) => item.contactPhone).length,
    priceExtracted: candidates.filter((item) => item.priceText).length,
    imageDiscovered: candidates.filter((item) => item.imageUrl).length,
  },
};
mkdirSync(".wrangler", { recursive: true });
writeFileSync(
  ".wrangler/everland-dry-run.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    { ...report.counts, report: ".wrangler/everland-dry-run.json" },
    null,
    2,
  ),
);
