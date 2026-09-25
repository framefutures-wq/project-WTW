const url = "https://www.pcfac.or.kr/";
try {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: {"user-agent":"GaltteumMunicipalGapDiagnostic/1.0 read-only"},
  });
  const html = await response.text();
  const needles = [
    "Pride 클래식 콘서트",
    "포천 산정호수 명성산",
    "가을엔 포크 콘서트",
    "가족뮤지컬",
  ];
  const snippets = needles.map((needle) => {
    const at = html.indexOf(needle);
    return {
      needle,
      found: at >= 0,
      snippet: at >= 0
        ? html.slice(Math.max(0, at - 1800), Math.min(html.length, at + 4200)).replace(/\s+/g, " ").slice(0, 6200)
        : null,
    };
  });
  console.log(JSON.stringify({
    http_status: response.status,
    final_url: response.url,
    bytes: Buffer.byteLength(html, "utf8"),
    snippets,
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    status:"FETCH_FAILED",
    error:error instanceof Error ? error.message : String(error),
  }, null, 2));
}
