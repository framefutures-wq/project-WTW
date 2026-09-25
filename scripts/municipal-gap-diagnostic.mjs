const url = "https://www.mokpo.go.kr/art/performance/art_schedule";
try {
  const response=await fetch(url,{signal:AbortSignal.timeout(20_000),headers:{"user-agent":"GaltteumMunicipalGapDiagnostic/1.0 read-only"}});
  const html=await response.text();
  for(const needle of ["selfUrl","art_concert_exhibit","mode=list","return=json"]){
    const at=html.indexOf(needle);
    console.log("NEEDLE",needle,"AT",at);
    if(at>=0) console.log(html.slice(Math.max(0,at-3000),Math.min(html.length,at+6500)).replace(/\s+/g," "));
  }
} catch(error) { console.log(error instanceof Error?error.message:String(error)); }
