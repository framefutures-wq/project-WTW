import {
  assessMunicipalSourceDocument,
  type MunicipalSourceDefinition,
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
  },
  {
    key: "probe-ulsan-jung",
    region: "울산",
    locality: "중구",
    url: "https://www.junggu.ulsan.kr/tour/index.ulsan?menuCd=DOM_000002208005006002",
    allowedHosts: ["junggu.ulsan.kr", "www.junggu.ulsan.kr"],
  },
  {
    key: "probe-pocheon",
    region: "경기",
    locality: "포천",
    url: "https://www.pcfac.or.kr/sub03/sub06-1.php",
    allowedHosts: ["pcfac.or.kr", "www.pcfac.or.kr"],
  },
  {
    key: "probe-okcheon",
    region: "충북",
    locality: "옥천",
    url: "https://oc.go.kr/tour/selectTnTursmResrceListU.do?key=2529&rcpp=9&sa1=%EC%B6%95%EC%A0%9C%EC%B2%B4%ED%97%98&so1=ORDR",
    allowedHosts: ["oc.go.kr", "www.oc.go.kr"],
  },
  {
    key: "probe-pohang",
    region: "경북",
    locality: "포항",
    url: "https://www.phcf.or.kr/phcf/culture_performance/view.do",
    allowedHosts: ["phcf.or.kr", "www.phcf.or.kr"],
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
  },
  {
    key: "probe-andong",
    region: "경북",
    locality: "안동",
    url: "https://andongculture.com/index.do?menuId=00000235&ordBy=1&pageIndex=1&pageSize=12&progStat=&realmDcd=&searchDiv=&searchTxt=&ym=",
    allowedHosts: ["andongculture.com", "www.andongculture.com"],
  },
].map((source) => ({
  ...source,
  healthMarkers: [],
  expectedSignals: ["html_table", "html_list", "html_cards"],
  ingestion: "generic_fallback",
})) satisfies MunicipalSourceDefinition[];

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
