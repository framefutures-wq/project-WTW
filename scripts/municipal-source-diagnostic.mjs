import {
  assessMunicipalSourceDocument,
  municipalSourceByKey,
} from "../shared/municipal-source-registry.ts";
import {
  extractMunicipalCandidates,
  selectMunicipalGate,
} from "../shared/municipal-discovery.ts";

const KEYS = ["gyeonggi-과천", "gyeonggi-하남", "gyeongbuk-상주"];
const TIMEOUT_MS = 20_000;

const read = async (url) => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "user-agent": "GaltteumMunicipalDiagnostic/1.0 read-only" },
  });
  const html = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    finalUrl: response.url,
    html,
  };
};

const reports = [];
for (const key of KEYS) {
  const source = municipalSourceByKey(key);
  if (!source) {
    reports.push({ source: key, status: "REGISTRY_MISSING" });
    continue;
  }

  try {
    const fetched = await read(source.url);
    const assessment = assessMunicipalSourceDocument(source, fetched.html);
    const extraction = extractMunicipalCandidates(source, fetched.html);

    reports.push({
      source: key,
      url: source.url,
      http_status: fetched.status,
      final_url: fetched.finalUrl,
      bytes: Buffer.byteLength(fetched.html, "utf8"),
      document_status: assessment.status,
      document_reason: assessment.reason,
      observed_signals: assessment.observedSignals,
      extraction_mode: extraction.mode,
      complete_candidates: extraction.candidates.length,
      partial_candidates: extraction.partialCandidates?.length ?? 0,
      examples: extraction.candidates.slice(0, 5).map((candidate) => ({
        title: candidate.title,
        start_date: candidate.start_date,
        end_date: candidate.end_date,
        venue: candidate.venue,
        official_url: candidate.official_url,
        gate: selectMunicipalGate(candidate),
      })),
    });
  } catch (error) {
    reports.push({
      source: key,
      url: source.url,
      status: "FETCH_FAILED",
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

console.log(JSON.stringify({
  mode: "read-only",
  production_write: false,
  d1_access: false,
  manual_ingestion: false,
  reports,
}, null, 2));
