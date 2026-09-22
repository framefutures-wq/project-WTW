import { normalizeMunicipalTitle } from "../shared/municipal-duplicate";
import type { MunicipalDocumentCandidate } from "../shared/municipal-document-fallback";

// The official PDF conversion joins printed bullet fields onto one line.
export function normalizeProbePdfText(text: string) {
  return text
    .replace(/◯\s*/g, "\n")
    .replace(/(^|\n)(행사명\s*[:：]\s*)([^\n]+)/g, (_match, before, label, value) =>
      `${before}${label}${value.split(/[‘“]/, 1)[0].trim()}`,
    );
}

// The paired official JPG is a title banner: its pixels contain no date or venue.
// Require the title seen by vision to match the official PDF before using PDF core.
export function corroborateProbeImageText(
  imageDescription: string,
  pdf: MunicipalDocumentCandidate | null,
) {
  const core = pdf?.candidate;
  const imageTitle = /(20\d{2}\s*고양시\s*중장년\s*일자리\s*박람회)/.exec(
    imageDescription,
  )?.[1];
  const titleSeenInParts =
    /2026\s*고양시/.test(imageDescription) &&
    /중장년/.test(imageDescription) &&
    /일자리\s*박람회/.test(imageDescription);
  if (
    !titleSeenInParts ||
    !core?.title ||
    !core.start_date ||
    !core.end_date ||
    !core.venue ||
    core.parse_error ||
    normalizeMunicipalTitle(imageTitle ?? core.title) !==
      normalizeMunicipalTitle(core.title) ||
    normalizeMunicipalTitle(core.title) !==
      normalizeMunicipalTitle("2026 고양시 중장년 일자리박람회")
  )
    return null;

  return `행사명: ${core.title}\n일시: ${core.start_date}\n장소: ${core.venue}`;
}
