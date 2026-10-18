import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import {
  classifyDuplicate,
  classifyPrivateDateEvidence,
  normalizeTitle,
} from "../shared/private-official-sources.ts";

const reportPath = ".wrangler/everland-dry-run.json";
const outputPath = ".wrangler/everland-production-readiness.json";

function parseWranglerJson(value) {
  const parsed = JSON.parse(value.trim());
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!entry || !Array.isArray(entry.results)) {
    throw new Error("expected one Wrangler D1 JSON result set");
  }
  return entry.results;
}

function dateRanges(text) {
  const ranges = [];
  const pattern =
    /(?:~\s*)?(\d{4})[./](\d{1,2})[./](\d{1,2})\s*~\s*(?:(\d{4})[./])?(\d{1,2})[./](\d{1,2})/g;
  for (const match of text?.matchAll(pattern) ?? []) {
    const [, year, month, day, endYear, endMonth, endDay] = match;
    ranges.push({
      start: `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
      end: `${endYear ?? year}-${endMonth.padStart(2, "0")}-${endDay.padStart(2, "0")}`,
    });
  }
  return ranges;
}

function classifyDateEvidence(candidate) {
  const ranges = dateRanges(candidate.description);
  return {
    ...classifyPrivateDateEvidence({
      sourcePageType: candidate.sourcePageType,
      startDate: candidate.startDate,
      endDate: candidate.endDate,
      completeDateRanges: ranges,
    }),
    ranges,
  };
}

function duplicateAudit(candidate, rows, dateEvidence) {
  if (dateEvidence.classification !== "reliable_event_date") {
    return {
      status: "ambiguous_duplicate",
      reason: "신뢰 가능한 행사 기간이 없어 TourAPI 중복을 확정할 수 없음",
      matches: [],
    };
  }
  const comparable = rows.map((row) => ({
    title: row.title,
    startDate: row.start_date,
    endDate: row.end_date,
    venue: row.venue,
    address: row.address,
    sourceUrl: row.source_url,
  }));
  const status = classifyDuplicate(candidate, comparable);
  const normalized = normalizeTitle(candidate.title);
  const matches = rows
    .filter((row) => normalizeTitle(row.title) === normalized)
    .filter(
      (row) =>
        candidate.startDate <= row.end_date &&
        candidate.endDate >= row.start_date,
    )
    .map((row) => ({
      id: row.id,
      title: row.title,
      startDate: row.start_date,
      endDate: row.end_date,
      venue: row.venue,
      address: row.address,
    }));
  return {
    status,
    reason:
      status === "new_candidate"
        ? "bounded TourAPI snapshot에서 동일 정규화 제목과 기간 겹침을 찾지 못함"
        : status === "probable_duplicate"
          ? "동일 제목·기간 겹침·장소 또는 주소 일치"
          : "동일 제목과 기간은 겹치지만 장소/주소 확인이 부족함",
    matches,
  };
}

const dryRun = JSON.parse(readFileSync(reportPath, "utf8"));
const rows = parseWranglerJson(readFileSync(0, "utf8"));
const candidates = dryRun.candidates.map((candidate) => {
  const dateEvidence = classifyDateEvidence(candidate);
  const duplicate = duplicateAudit(candidate, rows, dateEvidence);
  return {
    title: candidate.title,
    sourceUrl: candidate.sourceUrl,
    sourcePageType: candidate.sourcePageType ?? "unknown",
    startDate: candidate.startDate,
    endDate: candidate.endDate,
    dateEvidence,
    eligibility: candidate.eligibility,
    eligibilityReason: candidate.eligibilityReason,
    factTags: candidate.factTags.map((tag) => tag.tag),
    parentCandidate:
      candidate.parentCandidateId === null && !candidate.subEventCandidate,
    subEventCandidate: candidate.subEventCandidate,
    canonicalSourceId: candidate.canonicalSourceId,
    canonicalIdentityStability:
      candidate.canonicalIdentityStability ?? "fallback_unstable",
    duplicate,
  };
});
const counts = (key, value) =>
  candidates.filter((item) => item[key] === value).length;
const output = {
  generatedAt: new Date().toISOString(),
  sourceSnapshot: {
    rows: rows.length,
    fields: [
      "id",
      "title",
      "start_date",
      "end_date",
      "venue",
      "address",
      "lat",
      "lng",
      "primary_source_id",
      "source_url",
    ],
  },
  candidates,
  counts: {
    reliableEventDate: candidates.filter(
      (item) => item.dateEvidence.classification === "reliable_event_date",
    ).length,
    ambiguousDate: candidates.filter(
      (item) => item.dateEvidence.classification === "ambiguous_date",
    ).length,
    missingDate: candidates.filter(
      (item) => item.dateEvidence.classification === "missing_date",
    ).length,
    probableDuplicate: candidates.filter(
      (item) => item.duplicate.status === "probable_duplicate",
    ).length,
    newCandidate: candidates.filter(
      (item) => item.duplicate.status === "new_candidate",
    ).length,
    ambiguousDuplicate: candidates.filter(
      (item) => item.duplicate.status === "ambiguous_duplicate",
    ).length,
    parentCandidates: candidates.filter((item) => item.parentCandidate).length,
    subEventCandidates: candidates.filter((item) => item.subEventCandidate)
      .length,
  },
};
mkdirSync(".wrangler", { recursive: true });
writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(
  JSON.stringify(
    { output: outputPath, ...output.counts, snapshotRows: rows.length },
    null,
    2,
  ),
);
