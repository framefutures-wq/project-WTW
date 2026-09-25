import {
  assessMunicipalSourceDocument,
} from "../shared/municipal-source-registry.ts";
import {
  extractMunicipalCandidates,
} from "../shared/municipal-discovery.ts";

const probes = [
  {
    key: "seoul-yeongdeungpo",
    region: "서울특별시",
    locality: "영등포구",
    urls: [
      "https://www.ydp.go.kr/tour/selectTnTursmSchdulListU.do?key=4016",
      "https://ydp.go.kr/tour/selectTnTursmSchdulListU.do?key=4016",
    ],
  },
  {
    key: "jeonnam-gwangju-목포",
    region: "전남광주통합특별시",
    locality: "목포시",
    urls: [
      "https://www.mokpo.go.kr/art/performance/art_schedule",
      "https://www.mokpo.go.kr/art/performance/art_schedule?date=2026-09-01",
    ],
  },
  {
    key: "gyeongnam-거제",
    region: "경상남도",
    locality: "거제시",
    urls: [
      "https://tour.geoje.go.kr/board/list.geoje?boardId=FESTIVAL&contentsSid=8213&menuCd=DOM_000008504014001000",
      "https://www.geoje.go.kr/board/list.geoje?boardId=FESTIVAL&contentsSid=8213&menuCd=DOM_000008504014001000",
      "https://geoje.go.kr/board/list.geoje?boardId=FESTIVAL&contentsSid=8213&menuCd=DOM_000008504014001000",
    ],
  },
  {
    key: "gyeongnam-산청",
    region: "경상남도",
    locality: "산청군",
    urls: [
      "https://www.sancheong.go.kr/tour/selectSchdulWeb.do?key=545&yyyymm=202609",
      "https://www.sancheong.go.kr/tour/selectSchdulWeb.do?key=545",
      "https://sancheong.sancheong.go.kr/tour/selectSchdulWeb.do?key=545&yyyymm=202609",
    ],
  },
];

for (const probe of probes) {
  for (const url of probe.urls) {
    const host = new URL(url).hostname;
    const source = {
      key: probe.key,
      region: probe.region,
      locality: probe.locality,
      url,
      allowedHosts: [host],
      healthMarkers: [],
      expectedSignals: ["html_table","html_list","html_cards","structured_event"],
      ingestion: "generic_fallback",
    };
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(12_000),
        headers: {"user-agent":"GaltteumMunicipalGapDiagnostic/1.0 read-only"},
      });
      const html = await response.text();
      const assessment = assessMunicipalSourceDocument(source, html);
      const extraction = extractMunicipalCandidates(source, html);
      const dateMatch = /20\d{2}[-./년]\s*\d{1,2}[-./월]\s*\d{1,2}/.exec(html);
      const keywordMatch = /(행사명|공연명|축제명|장소|기간|일시|event|schedule|festival)/i.exec(html);
      const at = dateMatch?.index ?? keywordMatch?.index ?? 0;
      console.log(JSON.stringify({
        source: probe.key,
        requested_url: url,
        http_status: response.status,
        final_url: response.url,
        bytes: Buffer.byteLength(html,"utf8"),
        assessment,
        mode: extraction.mode,
        complete_candidates: extraction.candidates.length,
        partial_candidates: extraction.partialCandidates?.length ?? 0,
        examples: extraction.candidates.slice(0,4).map((c)=>({
          title:c.title,start_date:c.start_date,end_date:c.end_date,venue:c.venue,official_url:c.official_url
        })),
        snippet: html.slice(Math.max(0,at-1800),Math.min(html.length,at+6200)).replace(/\s+/g," ").slice(0,8000),
      }, null, 2));
      if (response.ok) break;
    } catch (error) {
      console.log(JSON.stringify({
        source: probe.key,
        requested_url: url,
        status:"FETCH_FAILED",
        error:error instanceof Error?error.message:String(error),
      }, null, 2));
    }
  }
}
