const url="https://www.mokpo.go.kr/art/performance/art_schedule";
const getRes=await fetch(url,{signal:AbortSignal.timeout(20_000),headers:{"user-agent":"GaltteumMunicipalGapDiagnostic/1.0 read-only"}});
const html=await getRes.text();
const setCookie=getRes.headers.getSetCookie?.() ?? [];
const cookie=setCookie.map(v=>v.split(";")[0]).join("; ");
const cases=[
  {name:"base",extra:{}},
  {name:"board",extra:{board_id:"art_concert_exhibit"}},
  {name:"board-usecate",extra:{board_id:"art_concert_exhibit",use_category_1:"true"}},
];
for(const c of cases){
  const body=new URLSearchParams({mode:"list",idx:"6140",sub_mode:"thisdate",date:"2026-09-03",return:"json",...c.extra});
  const headers={
    "user-agent":"GaltteumMunicipalGapDiagnostic/1.0 read-only",
    "content-type":"application/x-www-form-urlencoded",
    "referer":url,
  };
  if(cookie) headers.cookie=cookie;
  const response=await fetch(url,{method:"POST",body,signal:AbortSignal.timeout(20_000),headers});
  const text=await response.text();
  let parsed=null; try{parsed=JSON.parse(text);}catch{}
  console.log(JSON.stringify({
    case:c.name,get_status:getRes.status,cookie_count:setCookie.length,
    post_status:response.status,bytes:Buffer.byteLength(text,"utf8"),
    count:parsed?.count??null,
    list:Array.isArray(parsed?.list)?parsed.list.slice(0,5):null,
    keys:parsed&&typeof parsed==="object"?Object.keys(parsed):null,
    body_prefix:parsed?null:text.slice(0,1500),
  },null,2));
}
