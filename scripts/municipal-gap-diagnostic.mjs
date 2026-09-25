const url = "https://www.phcf.or.kr/resources/view/phcf/js/culture_performance.js?v=20250629b";
try {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: {"user-agent":"GaltteumMunicipalGapDiagnostic/1.0 read-only"},
  });
  const text = await response.text();
  const lines = text.split(/\r?\n/);
  const interesting = lines
    .map((line, index) => ({line:index + 1, text:line.trim()}))
    .filter(({text}) =>
      /fn_list|ajax|fetch\(|\.do\b|\/api\/|culture_performance|pageNo|pageIndex|search/i.test(text)
    )
    .slice(0, 180);
  console.log(JSON.stringify({
    http_status: response.status,
    final_url: response.url,
    bytes: Buffer.byteLength(text,"utf8"),
    interesting,
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    status:"FETCH_FAILED",
    error:error instanceof Error ? error.message : String(error),
  }, null, 2));
}
