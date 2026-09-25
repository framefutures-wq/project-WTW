import {
  assessMunicipalSourceDocument,
} from "../shared/municipal-source-registry.ts";
import {
  extractMunicipalCandidates,
} from "../shared/municipal-discovery.ts";

const probes = [
  {
    key: "mokpo-home-www",
    region: "전남광주통합특별시",
    locality: "목포시",
    url: "https://www.mokpo.go.kr/art",
    allowedHosts: ["www.mokpo.go.kr", "mokpo.go.kr"],
  },
  {
    key: "mokpo-home-biz",
    region: "전남광주통합특별시",
    locality: "목포시",
    url: "https://biz.mokpo.go.kr/art",
    allowedHosts: ["biz.mokpo.go.kr", "mokpo.go.kr"],
  },
  {
    key: "ydp-current-window",
    region: "서울특별시",
    locality: "영등포구",
    url: "https://www.ydp.go.kr/tour/selectTnTursmSchdulListU.do?ad1=0&key=4016&rcpp=12&sc1=10&sc5=20260901&sc6=20261031",
    allowedHosts: ["www.ydp.go.kr", "ydp.go.kr"],
  },
  {
    key: "geoje-apex",
    region: "경상남도",
    locality: "거제시",
    url: "https://geoje.go.kr/board/list.geoje?boardId=FESTIVAL&contentsSid=8213&menuCd=DOM_000008504014001000",
    allowedHosts: ["geoje.go.kr", "www.geoje.go.kr"],
  },
  {
    key: "sancheong-no-param",
    region: "경상남도",
    locality: "산청군",
    url: "https://www.sancheong.go.kr/tour/selectSchdulWeb.do?key=545",
    allowedHosts: ["www.sancheong.go.kr", "sancheong.go.kr"],
  },
];

for (const source of probes) {
  try {
    const response = await fetch(source.url, {
      signal: AbortSignal.timeout(8_000),
      headers: {"user-agent":"GaltteumMunicipalGapDiagnostic/1.0 read-only"},
    });
    const html = await response.text();
    const definition = {
      ...source,
      healthMarkers: [],
      expectedSignals: ["html_table","html_list","html_cards","structured_event"],
      ingestion: "generic_fallback",
    };
    const assessment = assessMunicipalSourceDocument(definition, html);
    const extraction = extractMunicipalCandidates(definition, html);
    const fullDate = /20\d{2}[-./년]\s*\d{1,2}[-./월]\s*\d{1,2}/.exec(html);
    const item = /(기간|장소|행사명|공연명|축제명|performtit|item_cont|event)/i.exec(html);
    const at = fullDate?.index ?? item?.index ?? 0;
    console.log(JSON.stringify({
      source: source.key,
      http_status: response.status,
      final_url: response.url,
      bytes: Buffer.byteLength(html,"utf8"),
      assessment,
      mode: extraction.mode,
      complete_candidates: extraction.candidates.length,
      partial_candidates: extraction.partialCandidates?.length ?? 0,
      examples: extraction.candidates.slice(0,6).map((c)=>({
        title:c.title,start_date:c.start_date,end_date:c.end_date,venue:c.venue,official_url:c.official_url
      })),
      snippet: html.slice(Math.max(0,at-2200),Math.min(html.length,at+8800)).replace(/\s+/g," ").slice(0,11000),
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      source:source.key,status:"FETCH_FAILED",
      error:error instanceof Error?error.message:String(error),
    }, null, 2));
  }
}
