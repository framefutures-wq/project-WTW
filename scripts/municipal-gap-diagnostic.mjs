const url="https://www.mokpo.go.kr/art/performance/art_schedule";
for(const date of ["2026-09-03","2026-10-03","2026-10-17"]){
  try{
    const body=new URLSearchParams({
      mode:"list",idx:"",sub_mode:"thisdate",date,return:"json"
    });
    const response=await fetch(url,{
      method:"POST",
      body,
      signal:AbortSignal.timeout(20_000),
      headers:{
        "user-agent":"GaltteumMunicipalGapDiagnostic/1.0 read-only",
        "content-type":"application/x-www-form-urlencoded"
      }
    });
    const text=await response.text();
    let parsed=null;
    try{parsed=JSON.parse(text);}catch{}
    console.log(JSON.stringify({
      date,http_status:response.status,content_type:response.headers.get("content-type"),
      bytes:Buffer.byteLength(text,"utf8"),
      keys:parsed&&typeof parsed==="object"?Object.keys(parsed):null,
      list:Array.isArray(parsed?.list)?parsed.list.slice(0,12):null,
      body_prefix:parsed?null:text.slice(0,5000)
    },null,2));
  }catch(error){
    console.log(JSON.stringify({date,status:"FETCH_FAILED",error:error instanceof Error?error.message:String(error)},null,2));
  }
}
