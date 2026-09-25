const url = "https://www.phcf.or.kr/resources/view/phcf/js/culture_performance.js?v=20250629b";
try {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: {"user-agent":"GaltteumMunicipalGapDiagnostic/1.0 read-only"},
  });
  const body = await response.text();
  const lines = body.split(/\r?\n/);
  const ranges = [[245,390],[500,760],[760,930]];
  const excerpts = ranges.map(([start,end]) => ({
    start,
    end,
    text: lines.slice(start-1,end).map((line,index)=>String(start+index).padStart(4,"0")+": "+line).join("\n")
  }));
  console.log(JSON.stringify({http_status:response.status,excerpts},null,2));
} catch (error) {
  console.log(JSON.stringify({status:"FETCH_FAILED",error:error instanceof Error?error.message:String(error)},null,2));
}
