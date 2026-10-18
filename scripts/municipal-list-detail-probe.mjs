import {
  extractMunicipalCandidates,
  selectMunicipalGate,
} from "../shared/municipal-discovery.ts";
import { followUpMunicipalListDetails } from "../shared/municipal-list-detail-followup.ts";

const sources = [
  {
    key: "seoul-mapo",
    region: "서울",
    locality: "마포구",
    url: "https://www.mfac.or.kr/performance/whole_list2.jsp",
    allowedHosts: ["mfac.or.kr", "www.mfac.or.kr"],
    healthMarkers: ["공연"],
    expectedSignals: ["html_list", "html_cards"],
    ingestion: "generic_fallback",
    listDetailFollowup: { maxDetails: 10 },
  },
  {
    key: "seoul-songpa",
    region: "서울",
    locality: "송파구",
    url: "https://www.songpa.go.kr/culture/index.do",
    allowedHosts: ["songpa.go.kr", "www.songpa.go.kr"],
    healthMarkers: ["문화"],
    expectedSignals: ["html_list", "html_cards"],
    ingestion: "generic_fallback",
    listDetailFollowup: { maxDetails: 10 },
  },
  {
    key: "busan",
    region: "부산",
    locality: "부산광역시",
    url: "https://www.visitbusan.net/schedule/list.do?boardId=BBS_0000009&menuCd=DOM_000000204012000000&month=0",
    allowedHosts: ["visitbusan.net", "www.visitbusan.net"],
    healthMarkers: ["축제"],
    expectedSignals: ["html_list", "html_cards"],
    ingestion: "generic_fallback",
    listDetailFollowup: { maxDetails: 10 },
  },
  {
    key: "sejong",
    region: "세종",
    locality: "세종특별자치시",
    url: "https://www.sjcf.or.kr/hangeul/www/prfr/list.do?key=2504150023",
    allowedHosts: ["sjcf.or.kr", "www.sjcf.or.kr"],
    healthMarkers: ["공연"],
    expectedSignals: ["html_list", "html_cards"],
    ingestion: "generic_fallback",
    listDetailFollowup: { maxDetails: 10 },
  },
];

const read = async (url) => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: { "user-agent": "WeekendMwohaeMunicipalProbe/1.0 read-only" },
  });
  if (!response.ok) throw new Error(`official_http_${response.status}`);
  return { html: await response.text(), finalUrl: response.url };
};

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const reports = [];
for (const source of sources) {
  try {
    const list = await read(source.url);
    const extraction = extractMunicipalCandidates(source, list.html);
    const followup = await followUpMunicipalListDetails(
      source,
      extraction.partialCandidates ?? [],
      today,
      read,
    );
    reports.push({
      source: source.key,
      list_partial_candidates: extraction.partialCandidates?.length ?? 0,
      partial_examples: (extraction.partialCandidates ?? [])
        .slice(0, 3)
        .map((item) => ({
          title: item.title,
          url: item.official_url,
        })),
      list_complete_candidates: extraction.candidates.length,
      detail_fetch_attempted: followup.attempted,
      detail_complete: followup.candidates.length,
      detail_rejected: followup.rejected.length,
      reject_reasons: [
        ...new Set(followup.rejected.map((item) => item.reason)),
      ],
      rejected_examples: followup.rejected.slice(0, 3),
      final_complete_candidates: followup.candidates.length,
      gates: followup.candidates.map(({ candidate }) =>
        selectMunicipalGate(candidate),
      ),
    });
  } catch (error) {
    reports.push({
      source: source.key,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
console.log(
  JSON.stringify(
    { mode: "read-only", production_write: false, today, reports },
    null,
    2,
  ),
);
