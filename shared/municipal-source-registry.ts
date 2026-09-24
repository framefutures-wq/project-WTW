export type MunicipalDocumentSignal =
  | "html_list"
  | "html_table"
  | "html_cards"
  | "structured_event"
  | "pdf_attachment"
  | "image_attachment";

export type MunicipalSourceDefinition = {
  /** A durable source slug. New generic sources do not require a code change here. */
  key: string;
  region: string;
  locality: string;
  url: string;
  allowedHosts: readonly string[];
  healthMarkers: readonly string[];
  expectedSignals: readonly MunicipalDocumentSignal[];
  ingestion: "registered_parser" | "generic_fallback";
  /** Generic sources may require an explicit first-party category on every card. */
  genericAllowedCategories?: readonly string[];
  /** A bounded, query-parameter-only page sequence for canonical official lists. */
  pagination?: {
    queryParam: string;
    maxPages: number;
  };
  /**
   * Opt in to bounded first-party detail reads when a canonical list has a
   * title/link but deliberately omits part of the event core.  Omitted means
   * the legacy single-page extraction path remains unchanged.
   */
  listDetailFollowup?: {
    maxDetails: number;
  };
  /** Opt in to bounded extraction of events nested in explicitly dated calendar cells. */
  calendarContext?: true;
};

export const MUNICIPAL_SOURCE_REGISTRY: readonly MunicipalSourceDefinition[] = [
  {
    key: "paju",
    region: "경기",
    locality: "파주",
    url: "https://tour.paju.go.kr/user/link/cultural/BD_index.do",
    allowedHosts: ["tour.paju.go.kr"],
    healthMarkers: ["list-info"],
    expectedSignals: ["html_list"],
    ingestion: "registered_parser",
  },
  {
    key: "suwon",
    region: "경기",
    locality: "수원",
    url: "https://www.swcf.or.kr/?p=29",
    allowedHosts: ["swcf.or.kr", "www.swcf.or.kr"],
    healthMarkers: ["<table"],
    expectedSignals: ["html_table"],
    ingestion: "registered_parser",
  },
  {
    key: "goyang",
    region: "경기",
    locality: "고양",
    url: "https://goyang.go.kr/visitgoyang/www/contents.do?key=595&searchCtgry=1674023925303",
    allowedHosts: ["goyang.go.kr", "www.goyang.go.kr"],
    healthMarkers: ["con_item"],
    expectedSignals: ["html_cards"],
    ingestion: "registered_parser",
  },
  {
    key: "hwaseong",
    region: "경기",
    locality: "화성",
    url: "https://tour.hscity.go.kr/NEW/6festival/festival5.jsp",
    allowedHosts: ["tour.hscity.go.kr"],
    healthMarkers: ["listBoard"],
    expectedSignals: ["html_table"],
    ingestion: "registered_parser",
  },
  {
    key: "bucheon",
    region: "경기",
    locality: "부천",
    url: "https://www.bucheon.go.kr/site/homepage/menu/viewMenu?menuid=145007003",
    allowedHosts: ["bucheon.go.kr", "www.bucheon.go.kr"],
    healthMarkers: ["9월~10월 기타 축제 및 행사"],
    expectedSignals: ["html_list"],
    ingestion: "registered_parser",
  },
  {
    key: "taebaek",
    region: "강원",
    locality: "태백",
    url: "https://www.taebaek.go.kr/www/selectWebScheduleUserList.do?key=1502",
    allowedHosts: ["taebaek.go.kr", "www.taebaek.go.kr"],
    healthMarkers: ['id="scheduler"'],
    expectedSignals: ["html_table"],
    ingestion: "generic_fallback",
  },
  {
    key: "seoul-hangang",
    region: "서울",
    locality: "한강",
    url: "https://hangang.seoul.go.kr/www/eventMng/list.do?mid=538",
    allowedHosts: ["hangang.seoul.go.kr"],
    healthMarkers: ["board-list type-event"],
    expectedSignals: ["html_list"],
    ingestion: "generic_fallback",
    genericAllowedCategories: ["축제", "문화예술", "공연"],
  },
  {
    key: "daejeon-fvu",
    region: "대전",
    locality: "대전",
    url: "https://daejeon.go.kr/fvu/FvuEventList.do?menuSeq=504",
    allowedHosts: ["daejeon.go.kr", "www.daejeon.go.kr"],
    healthMarkers: ["board_table_list"],
    expectedSignals: ["html_table"],
    ingestion: "generic_fallback",
    genericAllowedCategories: ["공연", "전시", "축제/이벤트/행사", "체육"],
  },
  {
    key: "incheon-res",
    region: "인천",
    locality: "인천",
    url: "https://www.incheon.go.kr/res/RE050101/",
    allowedHosts: ["incheon.go.kr", "www.incheon.go.kr"],
    healthMarkers: ["search-reservation-wrap"],
    expectedSignals: ["html_list"],
    ingestion: "generic_fallback",
    pagination: { queryParam: "curPage", maxPages: 3 },
  },
  {
    key: "gyeonggi-과천",
    region: "경기",
    locality: "과천",
    url: "https://www.gcart.or.kr/kr/concert/concertList.do",
    allowedHosts: ["gcart.or.kr", "www.gcart.or.kr"],
    healthMarkers: ['class="concert_list"'],
    expectedSignals: ["html_list"],
    ingestion: "generic_fallback",
    pagination: { queryParam: "pageIndex", maxPages: 2 },
  },
  {
    key: "gyeonggi-하남",
    region: "경기",
    locality: "하남",
    url: "https://www.hanam.go.kr/www/selectClturEventWebList.do?key=12376",
    allowedHosts: ["hanam.go.kr", "www.hanam.go.kr"],
    healthMarkers: ["p-media__heading-date_sbox"],
    expectedSignals: ["html_list"],
    ingestion: "generic_fallback",
    pagination: { queryParam: "pageIndex", maxPages: 3 },
  },
  {
    key: "gyeongbuk-상주",
    region: "경북",
    locality: "상주",
    url: "https://www.sangju.go.kr/life/page/10452/10182.tc?pageDtlOrdrNo=1&fstvlNo=0&searchFstvlNm=&recordCountPerPage=12",
    allowedHosts: ["sangju.go.kr", "www.sangju.go.kr"],
    healthMarkers: ['id="festivalListForm"'],
    expectedSignals: ["html_list"],
    ingestion: "generic_fallback",
    pagination: { queryParam: "pageIndex", maxPages: 2 },
  },
];

export function municipalSourceByKey(key: string) {
  return MUNICIPAL_SOURCE_REGISTRY.find((source) => source.key === key) ?? null;
}

export function municipalSourceAllowsUrl(
  source: MunicipalSourceDefinition,
  value: string,
) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      source.allowedHosts.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
}

export function detectMunicipalDocumentSignals(
  html: string,
): MunicipalDocumentSignal[] {
  const signals = new Set<MunicipalDocumentSignal>();
  if (/<table\b[\s\S]*?<tr\b/i.test(html)) signals.add("html_table");
  if (/<(?:ul|ol)\b[\s\S]*?<li\b/i.test(html)) signals.add("html_list");
  if (
    /class=["'][^"']*(?:con_item|card|event[_-]?item|festival[_-]?item)[^"']*["']/i.test(
      html,
    )
  )
    signals.add("html_cards");
  if (
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?["']@type["']\s*:\s*["']Event\b/i.test(
      html,
    )
  )
    signals.add("structured_event");
  if (/href=["'][^"']+\.pdf(?:[?#][^"']*)?["']/i.test(html))
    signals.add("pdf_attachment");
  if (
    /(?:href|src)=["'][^"']+\.(?:png|jpe?g|webp)(?:[?#][^"']*)?["']/i.test(html)
  )
    signals.add("image_attachment");
  return [...signals];
}

export function assessMunicipalSourceDocument(
  source: MunicipalSourceDefinition,
  html: string,
): {
  status: "healthy" | "format_changed" | "unparseable";
  observedSignals: MunicipalDocumentSignal[];
  reason: string;
} {
  const observedSignals = detectMunicipalDocumentSignals(html);
  const markersPresent = source.healthMarkers.every((marker) =>
    html.includes(marker),
  );
  const expectedShapePresent = source.expectedSignals.some((signal) =>
    observedSignals.includes(signal),
  );
  if (markersPresent && expectedShapePresent)
    return {
      status: "healthy",
      observedSignals,
      reason:
        source.ingestion === "registered_parser"
          ? "registered_parser_contract_present"
          : "generic_fallback_contract_present",
    };
  if (observedSignals.length)
    return {
      status: "format_changed",
      observedSignals,
      reason: markersPresent
        ? "registered_shape_changed"
        : "registered_marker_missing",
    };
  return {
    status: "unparseable",
    observedSignals,
    reason: "no_supported_document_signal",
  };
}
