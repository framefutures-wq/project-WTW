import {
  assessMunicipalSourceDocument,
} from "../shared/municipal-source-registry.ts";
import {
  extractMunicipalCandidates,
} from "../shared/municipal-discovery.ts";

const source = {
  key: "probe-mokpo",
  region: "전남광주통합특별시",
  locality: "목포",
  url: "https://www.mokpo.go.kr/art/performance/art_schedule",
  allowedHosts: ["mokpo.go.kr", "www.mokpo.go.kr"],
  healthMarkers: [],
  expectedSignals: ["html_table","html_list","html_cards","structured_event"],
  ingestion: "generic_fallback",
};

try {
  const response = await fetch(source.url, {
    signal: AbortSignal.timeout(20_000),
    headers: {"user-agent":"GaltteumMunicipalGapDiagnostic/1.0 read-only"},
  });
  const html = await response.text();
  const assessment = assessMunicipalSourceDocument(source, html);
  const extraction = extractMunicipalCandidates(source, html);
  const needles = ["2026-", "공연", "행사", "장소", "art_schedule"];
  const snippets = needles.map((needle)=>{
    const at=html.indexOf(needle);
    return {needle,found:at>=0,snippet:at>=0?html.slice(Math.max(0,at-2200),Math.min(html.length,at+7000)).replace(/\s+/g," ").slice(0,9000):null};
  });
  console.log(JSON.stringify({
    http_status:response.status,final_url:response.url,bytes:Buffer.byteLength(html,"utf8"),
    assessment,mode:extraction.mode,candidates:extraction.candidates.length,
    partials:extraction.partialCandidates?.length??0,
    examples:extraction.candidates.slice(0,8),
    snippets,
  },null,2));
} catch(error) {
  console.log(JSON.stringify({status:"FETCH_FAILED",error:error instanceof Error?error.message:String(error)},null,2));
}
