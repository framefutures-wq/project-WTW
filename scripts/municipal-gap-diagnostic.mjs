import {
  assessMunicipalSourceDocument,
} from "../shared/municipal-source-registry.ts";
import {
  extractMunicipalCandidates,
  selectMunicipalGate,
} from "../shared/municipal-discovery.ts";

const sources = [
  {
    key: "probe-mokpo",
    region: "전남광주통합특별시",
    locality: "목포",
    url: "https://www.mokpo.go.kr/art/performance/art_schedule",
    allowedHosts: ["mokpo.go.kr", "www.mokpo.go.kr"],
    needle: "공연/행사일정",
  },
  {
    key: "probe-ulsan-jung",
    region: "울산",
    locality: "중구",
    url: "https://www.junggu.ulsan.kr/tour/index.ulsan?menuCd=DOM_000002208005006002",
    allowedHosts: ["junggu.ulsan.kr", "www.junggu.ulsan.kr"],
    needle: "문화예술",
  },
  {
    key: "probe-pocheon",
    region: "경기",
    locality: "포천",
    url: "https://www.pcfac.or.kr/sub03/sub06-1.php",
    allowedHosts: ["pcfac.or.kr", "www.pcfac.or.kr"],
    needle: "2026년 제3회 포천생활문화대전",
  },
  {
    key: "probe-okcheon",
    region: "충북",
    locality: "옥천",
    url: "https://oc.go.kr/tour/selectTnTursmResrceListU.do?key=2529&rcpp=9&sa1=%EC%B6%95%EC%A0%9C%EC%B2%B4%ED%97%98&so1=ORDR",
    allowedHosts: ["oc.go.kr", "www.oc.go.kr"],
    needle: "옥천묘목축제",
  },
  {
    key: "probe-pohang",
    region: "경북",
    locality: "포항",
    url: "https://www.phcf.or.kr/phcf/culture_performance/view.do",
    allowedHosts: ["phcf.or.kr", "www.phcf.or.kr"],
    needle: "문화정보",
  },
  {
    key: "probe-gyeongju-old",
    region: "경북",
    locality: "경주",
    url: "https://www.gyeongju.go.kr/tour/page.do?mnu_uid=4608",
    allowedHosts: ["gyeongju.go.kr", "www.gyeongju.go.kr"],
  },
  {
    key: "probe-gyeongju-current",
    region: "경북",
    locality: "경주",
    url: "https://www.gyeongju.go.kr/tour/page.do?mnu_uid=4609",
    allowedHosts: ["gyeongju.go.kr", "www.gyeongju.go.kr"],
    needle: "이달의 축제 및 행사",
  },
  {
    key: "probe-andong",
    region: "경북",
    locality: "안동",
    url: "https://andongculture.com/index.do?menuId=00000235&ordBy=1&pageIndex=1&pageSize=12&progStat=&realmDcd=&searchDiv=&searchTxt=&ym=",
    allowedHosts: ["andongculture.com", "www.andongculture.com"],
    needle: "문화놀이터 - 휴앤아트",
  },

  {
    key: "probe-busan-dong",
    region: "부산",
    locality: "동구",
    url: "https://www.bsdonggu.go.kr/tour/board/list.donggu?boardId=BBS_0000336&contentsSid=2300&cpath=%2Ftour&menuCd=DOM_000000312001001000",
    allowedHosts: ["bsdonggu.go.kr", "www.bsdonggu.go.kr"],
    needle: "유규영 작가 초대전",
  },
  {
    key: "probe-haeundae",
    region: "부산",
    locality: "해운대",
    url: "https://www.haeundae.go.kr/culture/schedule/list.do?boardId=BBS_0000215&contentsSid=1842&cpath=%2Fculture&menuCd=DOM_000000901001002000",
    allowedHosts: ["haeundae.go.kr", "www.haeundae.go.kr"],
    needle: "On Stage Concert 5",
  },
  {
    key: "probe-yeongdeungpo",
    region: "서울",
    locality: "영등포",
    url: "https://www.ydp.go.kr/tour/selectTnTursmSchdulListU.do?key=4016",
    allowedHosts: ["ydp.go.kr", "www.ydp.go.kr"],
    needle: "문화행사",
  },
  {
    key: "probe-yeongju",
    region: "경북",
    locality: "영주",
    url: "https://www.yeongju.go.kr/open_content/main/page.do?mnu_uid=10617",
    allowedHosts: ["yeongju.go.kr", "www.yeongju.go.kr"],
    needle: "문화달력",
  },
  {
    key: "probe-geoje",
    region: "경남",
    locality: "거제",
    url: "https://tour.geoje.go.kr/board/list.geoje?boardId=FESTIVAL&contentsSid=8213&menuCd=DOM_000008504014001000",
    allowedHosts: ["tour.geoje.go.kr", "geoje.go.kr", "www.geoje.go.kr"],
    needle: "2026 블루거제 페스티벌",
  },
  {
    key: "probe-sancheong",
    region: "경남",
    locality: "산청",
    url: "https://www.sancheong.go.kr/tour/selectSchdulWeb.do?key=545&yyyymm=202609",
    allowedHosts: ["sancheong.go.kr", "www.sancheong.go.kr"],
    needle: "행사일정",
  },
].map((source) => ({
  ...source,
  healthMarkers: [],
  expectedSignals: ["html_table", "html_list", "html_cards"],
  ingestion: "generic_fallback",
}));

const fetchHtml = async (url) => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: { "user-agent": "GaltteumMunicipalGapDiagnostic/1.0 read-only" },
  });
  return {
    status: response.status,
    ok: response.ok,
    finalUrl: response.url,
    html: await response.text(),
  };
};

const reports = [];
for (const source of sources) {
  try {
    const fetched = await fetchHtml(source.url);
    const assessment = assessMunicipalSourceDocument(source, fetched.html);
    const extraction = extractMunicipalCandidates(source, fetched.html);
    reports.push({
      source: source.key,
      url: source.url,
      http_status: fetched.status,
      final_url: fetched.finalUrl,
      bytes: Buffer.byteLength(fetched.html, "utf8"),
      document_status: assessment.status,
      document_reason: assessment.reason,
      observed_signals: assessment.observedSignals,
      extraction_mode: extraction.mode,
      complete_candidates: extraction.candidates.length,
      partial_candidates: extraction.partialCandidates?.length ?? 0,
      first_full_date_snippet: (() => {
        const match = /20\d{2}[-./]\s*\d{1,2}[-./]\s*\d{1,2}/.exec(fetched.html);
        if (!match || match.index === undefined) return null;
        return fetched.html
          .slice(Math.max(0, match.index - 1200), Math.min(fetched.html.length, match.index + 2600))
          .replace(/\s+/g, " ")
          .slice(0, 4000);
      })(),
      raw_snippet: (() => {
        if (!source.needle) return null;
        const at = fetched.html.indexOf(source.needle);
        if (at < 0) return "NEEDLE_NOT_FOUND";
        return fetched.html
          .slice(Math.max(0, at - 900), Math.min(fetched.html.length, at + 2200))
          .replace(/\s+/g, " ")
          .slice(0, 3200);
      })(),
      examples: extraction.candidates.slice(0, 4).map((candidate) => ({
        title: candidate.title,
        start_date: candidate.start_date,
        end_date: candidate.end_date,
        venue: candidate.venue,
        official_url: candidate.official_url,
        gate: selectMunicipalGate(candidate),
      })),
    });
  } catch (error) {
    reports.push({
      source: source.key,
      url: source.url,
      status: "FETCH_FAILED",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

console.log(JSON.stringify({
  mode: "read-only",
  production_write: false,
  d1_access: false,
  manual_ingestion: false,
  reports,
}, null, 2));
