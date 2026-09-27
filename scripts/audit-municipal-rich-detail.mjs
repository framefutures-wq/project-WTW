import { pathToFileURL } from "node:url";
import {
  MUNICIPAL_SOURCE_REGISTRY,
  municipalSourceAllowsUrl,
} from "../shared/municipal-source-registry.ts";
import {
  extractMunicipalCandidates,
} from "../shared/municipal-discovery.ts";

const TIMEOUT_MS = 15_000;
const CONCURRENCY = 4;
const MAX_DETAILS_PER_SOURCE = 2;

const cleanText = (html) =>
  html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

const imageUrls = (html) =>
  [...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .filter((value) => !/\b(?:logo|icon|favicon|blank|spacer)\b/i.test(value));

export function detectRichDetailSignals(html) {
  const text = cleanText(html);
  const images = imageUrls(html);
  const timeMatches = [...text.matchAll(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g)];
  return {
    images: images.length > 0,
    image_count: images.length,
    multiple_images: images.length >= 2,
    time: timeMatches.length > 0,
    time_count: timeMatches.length,
    price: /(?:무료|유료|입장료|이용료|관람료|참가비|체험비|\b\d{1,3}(?:,\d{3})+\s*원\b)/.test(text),
    phone:
      /(?:문의|전화|연락처|대표전화)/.test(text) &&
      /(?:\b0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}\b|(?:문의|전화|연락처|대표전화)\s*[:：|]?\s*\d{3,4}\b)/.test(text),
    intro:
      /(?:행사\s*소개|행사내용|상세\s*내용|주요\s*내용|소개)/.test(text) ||
      text.length >= 1200,
    programs:
      /(?:프로그램|세부\s*일정|행사\s*일정|공연\s*내용|공연시간|체험\s*프로그램|전통공연|체험행사)/.test(text),
    address: /(?:주소|위치|장소)\s*[:：]?/.test(text),
    text_length: text.length,
  };
}

export function richSignalNames(signals) {
  return ["images", "time", "price", "phone", "intro", "programs"].filter(
    (key) => signals[key],
  );
}

export function classifyRichDetailCoverage({
  detailSampleCount,
  detailFetchFailures,
  observedFields,
}) {
  if (!detailSampleCount)
    return observedFields.length
      ? "LIST_RICHNESS_ONLY"
      : "NO_DETAIL_SAMPLE";
  if (detailFetchFailures === detailSampleCount) return "DETAIL_FETCH_FAILED";
  if (observedFields.length >= 4) return "RICH_DETAIL_UNHARVESTED";
  if (observedFields.length >= 1) return "DETAIL_FIELDS_UNHARVESTED";
  return "MINIMAL_DETAIL";
}

const read = async (url) => {
  const started = Date.now();
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      "user-agent": "GaltteumRichDetailAudit/1.0 read-only",
    },
  });
  const html = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    finalUrl: response.url,
    html,
    elapsedMs: Date.now() - started,
    bytes: Buffer.byteLength(html, "utf8"),
  };
};

const representativeDetailUrls = (source, extraction) => {
  const rows = [
    ...(extraction.candidates ?? []),
    ...(extraction.partialCandidates ?? []),
  ];
  const seen = new Set();
  const selected = [];
  for (const candidate of rows) {
    const url = candidate.official_url;
    if (
      !url ||
      url === source.url ||
      seen.has(url) ||
      !municipalSourceAllowsUrl(source, url)
    )
      continue;
    seen.add(url);
    selected.push({
      title: candidate.title,
      url,
      candidate_has_snippet: Boolean(candidate.snippet),
      candidate_has_image: Boolean(candidate.image_candidate),
    });
    if (selected.length >= MAX_DETAILS_PER_SOURCE) break;
  }
  return selected;
};

async function auditSource(source) {
  try {
    const list = await read(source.url);
    const extraction = extractMunicipalCandidates(source, list.html);
    const listSignals = detectRichDetailSignals(list.html);
    const detailTargets = representativeDetailUrls(source, extraction);
    const details = [];

    for (const target of detailTargets) {
      try {
        const fetched = await read(target.url);
        details.push({
          ...target,
          http_status: fetched.status,
          final_url: fetched.finalUrl,
          elapsed_ms: fetched.elapsedMs,
          bytes: fetched.bytes,
          signals: detectRichDetailSignals(fetched.html),
        });
      } catch (error) {
        details.push({
          ...target,
          fetch_error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const detailFields = new Set();
    for (const detail of details)
      if (detail.signals)
        for (const field of richSignalNames(detail.signals))
          detailFields.add(field);

    const candidateSnippetCount = extraction.candidates.filter((row) =>
      Boolean(row.snippet),
    ).length;
    const candidateImageCount = extraction.candidates.filter((row) =>
      Boolean(row.image_candidate),
    ).length;
    const observedFields = [
      ...new Set([
        ...richSignalNames(listSignals),
        ...detailFields,
      ]),
    ];
    const currentlyPersistedRichFields =
      candidateSnippetCount > 0 ? ["intro"] : [];
    const unharvestedFields = observedFields.filter(
      (field) => !currentlyPersistedRichFields.includes(field),
    );
    const detailFetchFailures = details.filter((row) => row.fetch_error).length;

    return {
      source: source.key,
      region: source.region,
      locality: source.locality,
      ingestion: source.ingestion,
      list_detail_followup: Boolean(source.listDetailFollowup),
      list_http: list.status,
      list_bytes: list.bytes,
      extraction_mode: extraction.mode,
      candidates: extraction.candidates.length,
      partial_candidates: extraction.partialCandidates?.length ?? 0,
      candidate_snippets: candidateSnippetCount,
      candidate_images: candidateImageCount,
      detail_targets: detailTargets.length,
      detail_fetch_failures: detailFetchFailures,
      list_signals: listSignals,
      detail_observed_fields: [...detailFields],
      observed_rich_fields: observedFields,
      currently_persisted_rich_fields: currentlyPersistedRichFields,
      unharvested_fields: unharvestedFields,
      classification: classifyRichDetailCoverage({
        detailSampleCount: details.length,
        detailFetchFailures,
        observedFields,
      }),
      details,
    };
  } catch (error) {
    return {
      source: source.key,
      region: source.region,
      locality: source.locality,
      ingestion: source.ingestion,
      list_detail_followup: Boolean(source.listDetailFollowup),
      classification: "LIST_FETCH_FAILED",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}

async function main() {
  const keyArg = process.argv.find((arg) => arg.startsWith("--keys="));
  const requested = keyArg
    ? new Set(keyArg.slice("--keys=".length).split(",").filter(Boolean))
    : null;
  const sources = requested
    ? MUNICIPAL_SOURCE_REGISTRY.filter((source) => requested.has(source.key))
    : [...MUNICIPAL_SOURCE_REGISTRY];

  const reports = await mapConcurrent(
    sources,
    CONCURRENCY,
    auditSource,
  );

  const counts = reports.reduce((acc, row) => {
    acc[row.classification] = (acc[row.classification] ?? 0) + 1;
    return acc;
  }, {});

  console.log("\n=== MUNICIPAL RICH-DETAIL COVERAGE ===");
  console.table(
    reports.map((row) => ({
      source: row.source,
      mode: row.ingestion,
      followup: row.list_detail_followup ? "yes" : "no",
      candidates: row.candidates ?? "",
      partials: row.partial_candidates ?? "",
      snippets: row.candidate_snippets ?? "",
      images: row.candidate_images ?? "",
      detail_targets: row.detail_targets ?? "",
      rich_fields: row.observed_rich_fields?.join(",") ?? "",
      dropped: row.unharvested_fields?.join(",") ?? "",
      result: row.classification,
    })),
  );

  console.log("\n=== SUMMARY ===");
  console.log({
    sources: reports.length,
    generic_fallback: reports.filter((row) => row.ingestion === "generic_fallback").length,
    generic_with_followup: reports.filter(
      (row) => row.ingestion === "generic_fallback" && row.list_detail_followup,
    ).length,
    classifications: counts,
  });

  console.log("\n=== FULL JSON ===");
  console.log(
    JSON.stringify(
      {
        mode: "read-only",
        production_write: false,
        d1_access: false,
        manual_ingestion: false,
        source_count: reports.length,
        reports,
      },
      null,
      2,
    ),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await main();
