const url = "https://www.mokpo.go.kr/art/performance/art_schedule/ybmodule.pkg/js/list_month.js";
try {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: {"user-agent":"GaltteumMunicipalGapDiagnostic/1.0 read-only"},
  });
  const body=await response.text();
  const lines=body.split(/\r?\n/);
  console.log(lines.slice(55,125).map((line,index)=>String(index+56).padStart(4,"0")+": "+line).join("\n"));
} catch(error) {
  console.log(error instanceof Error?error.message:String(error));
}
