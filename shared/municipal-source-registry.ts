export type MunicipalDocumentSignal =
  | "html_list"
  | "html_table"
  | "html_cards"
  | "structured_event"
  | "pdf_attachment"
  | "image_attachment"
  | "json_payload";

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
  {
    key: "gyeonggi-평택",
    region: "경기",
    locality: "평택",
    url: "https://www.pccf.or.kr/pfmc/pfmcAllList.do",
    allowedHosts: ["pccf.or.kr", "www.pccf.or.kr"],
    healthMarkers: ["ds-poster-list"],
    expectedSignals: ["html_list"],
    ingestion: "generic_fallback",
  },
  {
    key: "gyeonggi-여주",
    region: "경기",
    locality: "여주",
    url: "https://www.yjcf.or.kr/reserve/board/1/M/L/menu/401",
    allowedHosts: ["yjcf.or.kr", "www.yjcf.or.kr"],
    healthMarkers: ["공연일정"],
    expectedSignals: ["html_list"],
    ingestion: "generic_fallback",
  },
  {
    key: "gyeongbuk-경산",
    region: "경북",
    locality: "경산",
    url: "https://gsctf.or.kr/user/performance/all/gal?pageNum=1",
    allowedHosts: ["gsctf.or.kr"],
    healthMarkers: ["performance-list"],
    expectedSignals: ["html_list"],
    ingestion: "generic_fallback",
    pagination: { queryParam: "pageNum", maxPages: 3 },
  },
  {
    key: "incheon-서해",
    region: "인천",
    locality: "서해",
    url: "https://www.seohae.go.kr/open_content/culture/cultureListAll.do",
    allowedHosts: ["seohae.go.kr", "www.seohae.go.kr"],
    healthMarkers: ["행사검색"],
    expectedSignals: ["html_table", "html_list"],
    ingestion: "generic_fallback",
    pagination: { queryParam: "pgno", maxPages: 3 },
  },
  {
    key: "jeonnam-gwangju-곡성",
    region: "전남광주통합특별시",
    locality: "곡성",
    url: "https://www.gokseong.go.kr/tour/festivity/event",
    allowedHosts: ["gokseong.go.kr", "www.gokseong.go.kr"],
    healthMarkers: ["공연/체험행사"],
    expectedSignals: ["html_list", "html_cards"],
    ingestion: "generic_fallback",
    pagination: { queryParam: "page", maxPages: 3 },
  },
  {
    key: "gyeonggi-광주",
    region: "경기",
    locality: "광주",
    url: "https://www.gjcity.go.kr/portal/bbs/list.do?mId=0201030100&ptIdx=24",
    allowedHosts: ["gjcity.go.kr", "www.gjcity.go.kr"],
    healthMarkers: ["문화ㆍ행사"],
    expectedSignals: ["html_list"],
    ingestion: "generic_fallback",
  },
  {
    key: "seoul-gangnam",
    region: "서울",
    locality: "강남",
    url: "https://www.gangnam.go.kr/office/gfac/board/gfac_lifeculture/list.do?mid=gfac_festival06",
    allowedHosts: ["gangnam.go.kr", "www.gangnam.go.kr"],
    healthMarkers: ["강남생활문화축제"],
    expectedSignals: ["html_list"],
    ingestion: "generic_fallback",
  },
  {
    key: "ulsan-북",
    region: "울산",
    locality: "북구",
    url: "https://www.bukgu.ulsan.kr/art/BBS_014List.mo",
    allowedHosts: ["bukgu.ulsan.kr", "www.bukgu.ulsan.kr"],
    healthMarkers: ["공연/영화"],
    expectedSignals: ["html_list", "html_cards"],
    ingestion: "generic_fallback",
  },
  {
    key: "daegu-서",
    region: "대구",
    locality: "서구",
    url: "https://www.dgs.go.kr/music/contents.do?mid=0400000000",
    allowedHosts: ["dgs.go.kr", "www.dgs.go.kr"],
    healthMarkers: ['"listMonthly"'],
    expectedSignals: ["html_table"],
    ingestion: "registered_parser",
  },
  {
    key: "gangwon-원주",
    region: "강원",
    locality: "원주",
    url: "https://www.wonju.go.kr/www/selectCtyhllCldrListCal.do?key=213&pageIndex=1&pageUnit=10&searchCnd=all&searchLgd=7",
    allowedHosts: ["wonju.go.kr", "www.wonju.go.kr"],
    healthMarkers: ["월간일정"],
    expectedSignals: ["html_table"],
    ingestion: "generic_fallback",
  },
  {
    key: "gyeonggi-용인",
    region: "경기",
    locality: "용인",
    url: "https://www.yicf.or.kr/main/show/list.do?menuNo=010000&show_type=all&subMenuNo=010100&thirdMenuNo=&viewType=img",
    allowedHosts: ["yicf.or.kr", "www.yicf.or.kr"],
    healthMarkers: ["구분", "날짜", "장소"],
    expectedSignals: ["html_list"],
    ingestion: "generic_fallback",
    pagination: { queryParam: "page", maxPages: 3 },
  },
  {
    key: "gyeonggi-이천",
    region: "경기",
    locality: "이천",
    url: "https://www.icheon.go.kr/portal/universal/kalendar/index.do?mid=0401030000",
    allowedHosts: ["icheon.go.kr", "www.icheon.go.kr"],
    healthMarkers: ["시정달력(행사/축제)"],
    expectedSignals: ["html_list", "html_cards"],
    ingestion: "generic_fallback",
  },
  {
    key: "gyeonggi-의정부",
    region: "경기",
    locality: "의정부",
    url: "https://ui4u.go.kr/portal/eventNoti/list.do?mId=0301170300",
    allowedHosts: ["ui4u.go.kr", "www.ui4u.go.kr"],
    healthMarkers: ["2026년 연간 행사·축제 일정"],
    expectedSignals: ["html_table"],
    ingestion: "generic_fallback",
  },
  {
    key: "chungbuk-옥천",
    region: "충북",
    locality: "옥천",
    url: "https://oc.go.kr/tour/selectTnTursmResrceListU.do?key=2529&rcpp=9&sa1=%EC%B6%95%EC%A0%9C%EC%B2%B4%ED%97%98&so1=ORDR",
    allowedHosts: ["oc.go.kr", "www.oc.go.kr"],
    healthMarkers: ["photo_item", "info_title"],
    expectedSignals: ["html_list"],
    ingestion: "registered_parser",
  },
  {
    key: "gyeongbuk-안동",
    region: "경북",
    locality: "안동",
    url: "https://andongculture.com/index.do?menuId=00000235&ordBy=1&pageIndex=1&pageSize=12&progStat=&realmDcd=&searchDiv=&searchTxt=&ym=",
    allowedHosts: ["andongculture.com", "www.andongculture.com"],
    healthMarkers: ["ct_list_ul", "ct_list_date"],
    expectedSignals: ["html_list"],
    ingestion: "registered_parser",
  },
  {
    key: "busan-동",
    region: "부산",
    locality: "동구",
    url: "https://www.bsdonggu.go.kr/tour/board/list.donggu?boardId=BBS_0000336&contentsSid=2300&cpath=%2Ftour&menuCd=DOM_000000312001001000",
    allowedHosts: ["bsdonggu.go.kr", "www.bsdonggu.go.kr"],
    healthMarkers: ["bbs_gall_typeB", "공연·전시명"],
    expectedSignals: ["html_list"],
    ingestion: "registered_parser",
  },
  {
    key: "gyeongbuk-영주",
    region: "경북",
    locality: "영주",
    url: "https://www.yeongju.go.kr/open_content/main/page.do?mnu_uid=10617",
    allowedHosts: ["yeongju.go.kr", "www.yeongju.go.kr"],
    healthMarkers: ["문화달력", "schedule_tit"],
    expectedSignals: ["html_list"],
    ingestion: "registered_parser",
  },
  {
    key: "busan-해운대",
    region: "부산",
    locality: "해운대",
    url: "https://www.haeundae.go.kr/index.do?menuCd=DOM_000000104002004000",
    allowedHosts: ["haeundae.go.kr", "www.haeundae.go.kr"],
    healthMarkers: ["해운대 행사 캘린더"],
    expectedSignals: ["html_table"],
    ingestion: "registered_parser",
  },
  {
    key: "gyeongbuk-경주",
    region: "경북",
    locality: "경주",
    url: "https://www.gyeongju.go.kr/tour/page.do?mnu_uid=4609&listType=list",
    allowedHosts: ["gyeongju.go.kr", "www.gyeongju.go.kr"],
    healthMarkers: ["cultureList", "리스트형"],
    expectedSignals: ["html_list"],
    ingestion: "registered_parser",
  },
  {
    key: "ulsan-jung",
    region: "울산",
    locality: "중구",
    url: "https://www.junggu.ulsan.kr/tour/index.ulsan?menuCd=DOM_000002208005006002",
    allowedHosts: ["junggu.ulsan.kr", "www.junggu.ulsan.kr"],
    healthMarkers: ["문화예술업종행사일정", "공연분과"],
    expectedSignals: ["html_table"],
    ingestion: "registered_parser",
  },
  {
    key: "gyeongbuk-포항",
    region: "경북",
    locality: "포항",
    url: "https://www.phcf.or.kr/api/phcf/performance/getPerformanceList.do?categoryFilter=&statusFilter=&fieldFilter=&sortFilter=date&searchKeyword=&pageIndex=1&pageSize=25&searchMode=NOMAL",
    allowedHosts: ["phcf.or.kr", "www.phcf.or.kr"],
    healthMarkers: ["\"list\"", "\"event_id\""],
    expectedSignals: ["json_payload"],
    ingestion: "registered_parser",
    pagination: { queryParam: "pageIndex", maxPages: 3 },
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
  const trimmed = html.trim();
  if (
    (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
    (() => {
      try {
        JSON.parse(trimmed);
        return true;
      } catch {
        return false;
      }
    })()
  )
    signals.add("json_payload");
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
