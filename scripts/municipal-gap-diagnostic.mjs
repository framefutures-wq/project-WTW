const url="https://www.mokpo.go.kr/art/performance/art_schedule";
for(const date of ["2026-09-03","2026-10-17"]){
  const body=new URLSearchParams({mode:"list",idx:"",sub_mode:"thisdate",date,return:"json"});
  try{
    const response=await fetch(url,{method:"POST",body,signal:AbortSignal.timeout(20_000),headers:{
      "user-agent":"GaltteumMunicipalGapDiagnostic/1.0 read-only",
      "content-type":"application/x-www-form-urlencoded"
    }});
    const text=await response.text();
    console.log("DATE",date);
    console.log(text);
  }catch(error){
    console.log(JSON.stringify({date,status:"FETCH_FAILED",error:error instanceof Error?error.message:String(error)},null,2));
  }
}
