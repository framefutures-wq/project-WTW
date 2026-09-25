const url = "https://www.mokpo.go.kr/art/performance/art_schedule";
try {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: {"user-agent":"GaltteumMunicipalGapDiagnostic/1.0 read-only"},
  });
  const html = await response.text();
  const needles = ["view_popup", "data-idx", "ybmodule", "scheduler", "$.ajax", "ajax"];
  const snippets = needles.map((needle)=>{
    const at=html.indexOf(needle);
    return {
      needle,found:at>=0,
      snippet:at>=0?html.slice(Math.max(0,at-3500),Math.min(html.length,at+9000)).replace(/\s+/g," ").slice(0,12500):null
    };
  });
  const scripts=[...html.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi)].map(m=>m[1]);
  console.log(JSON.stringify({http_status:response.status,scripts,snippets},null,2));
} catch(error) {
  console.log(JSON.stringify({status:"FETCH_FAILED",error:error instanceof Error?error.message:String(error)},null,2));
}
