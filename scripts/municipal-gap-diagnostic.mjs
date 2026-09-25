const url = "https://www.pcfac.or.kr/sub03/sub06-1.php";
try {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: {"user-agent":"GaltteumMunicipalGapDiagnostic/1.0 read-only"},
  });
  const html = await response.text();
  const needles = ["function reg_view", "reg_view(", "2026년 제3회 포천생활문화대전", "자세히보기"];
  const snippets = needles.map((needle) => {
    const at = html.indexOf(needle);
    return {
      needle,
      found: at >= 0,
      snippet: at >= 0
        ? html.slice(Math.max(0, at - 2500), Math.min(html.length, at + 7000)).replace(/\s+/g, " ").slice(0, 9500)
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
    status: "FETCH_FAILED",
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
}
