import {
  assessMunicipalSourceDocument,
} from "../shared/municipal-source-registry.ts";
import {
  extractMunicipalCandidates,
} from "../shared/municipal-discovery.ts";

const probes = [
  ["gyeongju-list-default","https://www.gyeongju.go.kr/tour/page.do?mnu_uid=4609&listType=list"],
  ["gyeongju-list-sep","https://www.gyeongju.go.kr/tour/page.do?mnu_uid=4609&listType=list&initYear=2026&initMonth=9&initDay=1"],
  ["sancheong-www-current","https://www.sancheong.go.kr/tour/selectSchdulWeb.do?key=545"],
  ["sancheong-sub-current","https://sancheong.sancheong.go.kr/tour/selectSchdulWeb.do?key=545"],
  ["ydp-apex","https://ydp.go.kr/tour/selectTnTursmSchdulListU.do?key=4016"],
  ["geoje-apex","https://geoje.go.kr/board/list.geoje?boardId=FESTIVAL&contentsSid=8213&menuCd=DOM_000008504014001000"],
  ["mokpo-sep-list","https://www.mokpo.go.kr/art/performance/art_schedule?date=2026-09-01&sub_mode=today"],
];

for (const [key,url] of probes) {
  const source = {
    key,
    region: "진단",
    locality: "진단",
    url,
    allowedHosts: [new URL(url).hostname],
    healthMarkers: [],
    expectedSignals: ["html_table","html_list","html_cards"],
    ingestion: "generic_fallback",
  };
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: {"user-agent":"GaltteumMunicipalGapDiagnostic/1.0 read-only"},
    });
    const html = await response.text();
    const assessment = assessMunicipalSourceDocument(source, html);
    const extraction = extractMunicipalCandidates(source, html);
    const dateMatch = /20\d{2}[-./]\s*\d{1,2}[-./]\s*\d{1,2}/.exec(html);
    const eventWords = /(기간|장소|행사명|일정명|schedule_tit|festival|event)/i.exec(html);
    const at = dateMatch?.index ?? eventWords?.index ?? 0;
    console.log(JSON.stringify({
      source:key,http_status:response.status,final_url:response.url,bytes:Buffer.byteLength(html,"utf8"),
      assessment,mode:extraction.mode,candidates:extraction.candidates.length,
      snippet:html.slice(Math.max(0,at-1600),Math.min(html.length,at+5200)).replace(/\s+/g," ").slice(0,7000),
    },null,2));
  } catch (error) {
    console.log(JSON.stringify({source:key,status:"FETCH_FAILED",error:error instanceof Error?error.message:String(error)},null,2));
  }
}
