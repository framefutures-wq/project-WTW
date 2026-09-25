import {
  assessMunicipalSourceDocument,
} from "../shared/municipal-source-registry.ts";
import {
  extractMunicipalCandidates,
} from "../shared/municipal-discovery.ts";

const listUrl = "https://www.ydpcf.or.kr/artexhibit/artexhibit.do";
const detailUrl = "https://ydpcf.or.kr/artexhibit/view.do?id=537";

for (const [key,url] of [["ydpcf-list",listUrl],["ydpcf-detail",detailUrl]]) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: {"user-agent":"GaltteumMunicipalGapDiagnostic/1.0 read-only"},
    });
    const html = await response.text();
    const source = {
      key:"probe-ydpcf",
      region:"서울특별시",
      locality:"영등포구",
      url:listUrl,
      allowedHosts:["ydpcf.or.kr","www.ydpcf.or.kr"],
      healthMarkers:[],
      expectedSignals:["html_table","html_list","html_cards","structured_event"],
      ingestion:"generic_fallback",
      listDetailFollowup:{maxDetails:5},
    };
    const assessment=assessMunicipalSourceDocument(source,html);
    const extraction=extractMunicipalCandidates(source,html);
    const needle = key==="ydpcf-list" ? "(10월) 마티네콘서트" : "영등포아트홀";
    const at=html.indexOf(needle);
    console.log(JSON.stringify({
      key,http_status:response.status,final_url:response.url,bytes:Buffer.byteLength(html,"utf8"),
      assessment,mode:extraction.mode,
      candidates:extraction.candidates.length,
      partials:extraction.partialCandidates?.length??0,
      candidate_examples:extraction.candidates.slice(0,5),
      partial_examples:extraction.partialCandidates?.slice(0,5)??[],
      snippet:at>=0?html.slice(Math.max(0,at-2500),Math.min(html.length,at+6500)).replace(/\s+/g," ").slice(0,9000):null,
    },null,2));
  } catch (error) {
    console.log(JSON.stringify({key,status:"FETCH_FAILED",error:error instanceof Error?error.message:String(error)},null,2));
  }
}
