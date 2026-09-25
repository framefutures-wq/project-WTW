import {
  assessMunicipalSourceDocument,
} from "../shared/municipal-source-registry.ts";
import {
  parseGenericMunicipalDetail,
} from "../shared/municipal-discovery.ts";

const urls=[
  "https://www.mokpo.go.kr/art/performance/art_schedule?mode=view&idx=6140",
  "https://www.mokpo.go.kr/art/performance/art_schedule?mode=view&idx=6173"
];
for(const url of urls){
  try{
    const response=await fetch(url,{signal:AbortSignal.timeout(20_000),headers:{"user-agent":"GaltteumMunicipalGapDiagnostic/1.0 read-only"}});
    const html=await response.text();
    const source={
      key:"probe-mokpo",region:"전남광주통합특별시",locality:"목포",
      url:"https://www.mokpo.go.kr/art/performance/art_schedule",
      allowedHosts:["mokpo.go.kr","www.mokpo.go.kr"],
      healthMarkers:[],expectedSignals:["html_table","html_list","html_cards"],ingestion:"generic_fallback"
    };
    const detail=parseGenericMunicipalDetail(source,html);
    const needles=["공연 장소","행사 장소","목포문화예술회관","title_box","6140"];
    const snippets=needles.map(needle=>{const at=html.indexOf(needle);return {needle,found:at>=0,snippet:at>=0?html.slice(Math.max(0,at-2000),Math.min(html.length,at+6000)).replace(/\s+/g," ").slice(0,8000):null}});
    console.log(JSON.stringify({url,http_status:response.status,bytes:Buffer.byteLength(html,"utf8"),detail,snippets},null,2));
  }catch(error){console.log(JSON.stringify({url,status:"FETCH_FAILED",error:error instanceof Error?error.message:String(error)},null,2));}
}
