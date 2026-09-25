import {
  assessMunicipalSourceDocument,
} from "../shared/municipal-source-registry.ts";
import {
  extractMunicipalCandidates,
  selectMunicipalGate,
} from "../shared/municipal-discovery.ts";

const sources = [
  {
    key: "probe-haeundae-annual",
    region: "부산",
    locality: "해운대",
    url: "https://www.haeundae.go.kr/index.do?menuCd=DOM_000000104002004000",
    allowedHosts: ["haeundae.go.kr", "www.haeundae.go.kr"],
    healthMarkers: ["해운대 행사 캘린더"],
    expectedSignals: ["html_table"],
    ingestion: "generic_fallback",
  },
  {
    key: "probe-geoje-www",
    region: "경남",
    locality: "거제",
    url: "https://www.geoje.go.kr/board/list.geoje?boardId=FESTIVAL&contentsSid=8213&menuCd=DOM_000008504014001000",
    allowedHosts: ["geoje.go.kr", "www.geoje.go.kr"],
    healthMarkers: ["행사일정표"],
    expectedSignals: ["html_table"],
    ingestion: "generic_fallback",
  },
];

for (const source of sources) {
  try {
    const response = await fetch(source.url, {
      signal: AbortSignal.timeout(20_000),
      headers: { "user-agent": "GaltteumMunicipalGapDiagnostic/1.0 read-only" },
    });
    const html = await response.text();
    const assessment = assessMunicipalSourceDocument(source, html);
    const extraction = extractMunicipalCandidates(source, html);
    const firstTable = /<table\b[\s\S]*?<\/table>/i.exec(html)?.[0] ?? null;
    console.log(JSON.stringify({
      source: source.key,
      http_status: response.status,
      final_url: response.url,
      bytes: Buffer.byteLength(html, "utf8"),
      assessment,
      extraction_mode: extraction.mode,
      complete_candidates: extraction.candidates.length,
      examples: extraction.candidates.slice(0, 5).map((candidate) => ({
        title: candidate.title,
        start_date: candidate.start_date,
        end_date: candidate.end_date,
        venue: candidate.venue,
        official_url: candidate.official_url,
        gate: selectMunicipalGate(candidate),
      })),
      first_table_snippet: firstTable
        ? firstTable.replace(/\s+/g, " ").slice(0, 7000)
        : null,
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      source: source.key,
      status: "FETCH_FAILED",
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
  }
}
