const url = "https://www.mokpo.go.kr/art/performance/art_schedule/ybmodule.pkg/js/list_month.js";
try {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: {"user-agent":"GaltteumMunicipalGapDiagnostic/1.0 read-only"},
  });
  const body = await response.text();
  const lines=body.split(/\r?\n/);
  const interesting=lines.map((line,index)=>({line:index+1,text:line.trim()})).filter(({text})=>/view_popup|idx|ajax|url|scheduler|detail|popup/i.test(text)).slice(0,220);
  console.log(JSON.stringify({http_status:response.status,bytes:Buffer.byteLength(body,"utf8"),interesting},null,2));
} catch(error) {
  console.log(JSON.stringify({status:"FETCH_FAILED",error:error instanceof Error?error.message:String(error)},null,2));
}
