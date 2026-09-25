const url = new URL("https://www.phcf.or.kr/api/phcf/performance/getPerformanceList.do");
url.search = new URLSearchParams({
  categoryFilter: "",
  statusFilter: "",
  fieldFilter: "",
  sortFilter: "date",
  searchKeyword: "",
  pageIndex: "1",
  pageSize: "2000",
  searchMode: "NOMAL",
}).toString();

try {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: {"user-agent":"GaltteumMunicipalGapDiagnostic/1.0 read-only"},
  });
  const body = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(body); } catch {}
  const list = parsed && Array.isArray(parsed.list) ? parsed.list : [];
  console.log(JSON.stringify({
    http_status: response.status,
    content_type: response.headers.get("content-type"),
    bytes: Buffer.byteLength(body,"utf8"),
    result: parsed?.result ?? null,
    totalCount: parsed?.totalCount ?? null,
    pageIndex: parsed?.pageIndex ?? null,
    sample: list.slice(0,8).map((item) => ({
      event_id: item.event_id,
      event_title: item.event_title,
      start_date: item.start_date,
      end_date: item.end_date,
      space_name: item.space_name,
      event_venue: item.event_venue,
      event_category: item.event_category,
      event_field: item.event_field,
      content_type: item.content_type,
      event_status: item.event_status,
    })),
    body_prefix: parsed ? null : body.slice(0,4000),
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    status:"FETCH_FAILED",
    error:error instanceof Error ? error.message : String(error),
  }, null, 2));
}
