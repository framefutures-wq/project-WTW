const url = "https://www.pcfac.or.kr/sub03/sub06-1.php";
const samples = ["1819130", "1818691", "1819111"];
for (const uid of samples) {
  try {
    const body = new URLSearchParams({
      type: "view",
      uid,
      record_start: "0",
      table_id: "table_1631524937",
      next_url: "/sub03/sub06-1.php",
      strRoot: "../",
      boardRoot: "../board/",
      f_month: "09",
      field: "total",
    });
    const response = await fetch(url, {
      method: "POST",
      body,
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "user-agent":"GaltteumMunicipalGapDiagnostic/1.0 read-only",
        "content-type":"application/x-www-form-urlencoded",
      },
    });
    const html = await response.text();
    const needles = ["행사장소", "장소", "포천시청", "가가호호", "생활문화대전", "culture_title"];
    const snippets = needles.map((needle) => {
      const at = html.indexOf(needle);
      return {
        needle,
        found: at >= 0,
        snippet: at >= 0
          ? html.slice(Math.max(0, at - 1800), Math.min(html.length, at + 4500)).replace(/\s+/g, " ").slice(0, 6500)
          : null,
      };
    });
    console.log(JSON.stringify({
      uid,
      http_status: response.status,
      final_url: response.url,
      bytes: Buffer.byteLength(html,"utf8"),
      snippets,
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({uid,status:"FETCH_FAILED",error:error instanceof Error?error.message:String(error)},null,2));
  }
}
