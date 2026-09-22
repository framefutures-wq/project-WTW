import { normalizeMunicipalTitle } from "./municipal-duplicate";
import {
  municipalSourceAllowsUrl,
  type MunicipalSourceDefinition,
} from "./municipal-source-registry";
import type { MunicipalCandidate } from "./municipal-discovery";

export type MunicipalDocumentKind = "pdf" | "image";
export type MunicipalDocumentMode = "pdf_text" | "image_vision";

export type MunicipalDocumentAttachment = {
  url: string;
  name: string;
  kind: MunicipalDocumentKind;
  mimeType: string;
};

export type MunicipalMarkdownResult = {
  format: "markdown" | "text" | "error";
  data?: string;
  error?: string;
  name?: string;
  mimetype?: string;
};

export interface MunicipalMarkdownAI {
  toMarkdown(
    files:
      | { name: string; blob: Blob }
      | Array<{ name: string; blob: Blob }>,
    options?: {
      conversionOptions?: {
        output?: { format?: "markdown" | "text" };
        pdf?: { metadata?: boolean };
      };
    },
  ): Promise<MunicipalMarkdownResult | MunicipalMarkdownResult[]>;
}

export type MunicipalDocumentCandidate = {
  mode: MunicipalDocumentMode;
  candidate: MunicipalCandidate;
  attachment: MunicipalDocumentAttachment;
};

const MIME_BY_EXTENSION: Record<string, { kind: MunicipalDocumentKind; mimeType: string }> = {
  pdf: { kind: "pdf", mimeType: "application/pdf" },
  jpg: { kind: "image", mimeType: "image/jpeg" },
  jpeg: { kind: "image", mimeType: "image/jpeg" },
  png: { kind: "image", mimeType: "image/png" },
  webp: { kind: "image", mimeType: "image/webp" },
  svg: { kind: "image", mimeType: "image/svg+xml" },
  gif: { kind: "image", mimeType: "image/gif" },
  bmp: { kind: "image", mimeType: "image/bmp" },
};

const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const cleanLine = (value: string) =>
  value.replace(/\s+/g, " ").replace(/^[-*#>\s]+/, "").trim();

const attachmentName = (url: string, fallback: string) => {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return name || fallback;
  } catch {
    return fallback;
  }
};

export function extractMunicipalDocumentAttachments(
  source: MunicipalSourceDefinition,
  html: string,
): MunicipalDocumentAttachment[] {
  const found: MunicipalDocumentAttachment[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/(?:href|src)=["']([^"']+)["']/gi)) {
    const raw = match[1].replace(/&amp;/gi, "&").trim();
    let url: string;
    try {
      url = new URL(raw, source.url).toString();
    } catch {
      continue;
    }
    if (!municipalSourceAllowsUrl(source, url) || seen.has(url)) continue;
    const extension =
      /\.([a-z0-9]+)(?:$|[?#])/i.exec(url)?.[1]?.toLowerCase() ?? "";
    const supported = MIME_BY_EXTENSION[extension];
    if (!supported) continue;
    seen.add(url);
    found.push({
      url,
      name: attachmentName(url, `municipal-${source.key}.${extension}`),
      kind: supported.kind,
      mimeType: supported.mimeType,
    });
  }
  return found
    .sort((left, right) =>
      left.kind === right.kind ? 0 : left.kind === "pdf" ? -1 : 1,
    )
    .slice(0, MAX_ATTACHMENTS);
}

const parseDateRange = (text: string) => {
  const pattern =
    /(?:행사\s*기간|축제\s*기간|기\s*간|행사\s*일시|일\s*시)\s*[:：]?\s*(20\d{2})\s*(?:[.\/-]|년)\s*(\d{1,2})\s*(?:[.\/-]|월)\s*(\d{1,2})\s*(?:일)?(?:\s*[~∼-]\s*(?:(20\d{2})\s*(?:[.\/-]|년)\s*)?(?:(\d{1,2})\s*(?:[.\/-]|월)\s*)?(\d{1,2})\s*(?:일)?)?/;
  const match = pattern.exec(text);
  if (!match) return null;
  const toDate = (year: string, month: string, day: string) =>
    `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const start = toDate(match[1], match[2], match[3]);
  const end = match[6]
    ? toDate(match[4] ?? match[1], match[5] ?? match[2], match[6])
    : start;
  return { start, end };
};

const labeledValue = (text: string, labels: string[]) => {
  const escaped = labels.map((label) => label.replace(/\s+/g, "\\s*")).join("|");
  const match = new RegExp(
    `(?:^|\\n)\\s*(?:${escaped})\\s*[:：]\\s*([^\\n\\r]{2,140})`,
    "i",
  ).exec(text);
  return match ? cleanLine(match[1]) : null;
};

export function parseConvertedMunicipalDocument(
  source: MunicipalSourceDefinition,
  attachment: MunicipalDocumentAttachment,
  text: string,
): MunicipalDocumentCandidate | null {
  const normalized = String(text ?? "").replace(/\r/g, "").trim();
  if (!normalized) return null;
  const title = labeledValue(normalized, ["행사명", "축제명", "공연명", "행 사 명"]);
  const range = parseDateRange(normalized);
  const venue = labeledValue(normalized, ["행사장소", "행사장", "장소", "장 소"]);
  if (!title) return null;

  const identity = normalizeMunicipalTitle(
    `${attachment.url}|${title}`,
  ).slice(0, 90);
  const mode: MunicipalDocumentMode =
    attachment.kind === "pdf" ? "pdf_text" : "image_vision";
  const coreMissing = !range || !venue;
  const imageNeedsConfirmation = attachment.kind === "image";
  const snippet = normalized
    .split("\n")
    .map(cleanLine)
    .filter(Boolean)
    .slice(0, 8)
    .join(" ")
    .slice(0, 280) || null;

  return {
    mode,
    attachment,
    candidate: {
      source: source.key,
      source_candidate_id: `doc-${attachment.kind}-${identity || normalizeMunicipalTitle(title).slice(0, 60)}`,
      title,
      start_date: range?.start ?? null,
      end_date: range?.end ?? null,
      region: source.region,
      locality: source.locality,
      venue,
      official_url: attachment.url,
      category:
        attachment.kind === "pdf"
          ? "공식 PDF 행사안내"
          : "공식 이미지 행사안내",
      snippet,
      image_candidate:
        attachment.kind === "image"
          ? { url: attachment.url, source_url: source.url }
          : null,
      ...(coreMissing
        ? { parse_error: "document_missing_explicit_core" }
        : imageNeedsConfirmation
          ? { parse_error: "image_vision_requires_confirmation" }
          : {}),
    },
  };
}

const fetchAttachment = async (
  attachment: MunicipalDocumentAttachment,
  fetcher: typeof fetch,
) => {
  const response = await fetcher(attachment.url, {
    signal: AbortSignal.timeout(15_000),
    headers: { "user-agent": "WeekendMwohaeMunicipal/1.0" },
  });
  if (!response.ok) throw new Error(`attachment_http_${response.status}`);
  const declaredSize = Number(response.headers.get("content-length") ?? "0");
  if (declaredSize > MAX_ATTACHMENT_BYTES) throw new Error("attachment_too_large");
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) throw new Error("attachment_too_large");
  return new Blob([buffer], { type: attachment.mimeType });
};

export async function extractMunicipalDocumentCandidates({
  ai,
  source,
  html,
  fetcher = fetch,
}: {
  ai?: MunicipalMarkdownAI;
  source: MunicipalSourceDefinition;
  html: string;
  fetcher?: typeof fetch;
}): Promise<{
  status: "ok" | "no_supported_attachment" | "ai_binding_unavailable" | "conversion_failed";
  candidates: MunicipalDocumentCandidate[];
}> {
  const attachments = extractMunicipalDocumentAttachments(source, html);
  if (!attachments.length)
    return { status: "no_supported_attachment", candidates: [] };
  if (!ai) return { status: "ai_binding_unavailable", candidates: [] };

  const candidates: MunicipalDocumentCandidate[] = [];
  let successfulConversions = 0;
  for (const attachment of attachments) {
    try {
      const blob = await fetchAttachment(attachment, fetcher);
      const converted = await ai.toMarkdown(
        { name: attachment.name, blob },
        {
          conversionOptions: {
            output: { format: "text" },
            ...(attachment.kind === "pdf"
              ? { pdf: { metadata: false } }
              : {}),
          },
        },
      );
      const result = Array.isArray(converted) ? converted[0] : converted;
      if (!result || result.format === "error" || !result.data) continue;
      successfulConversions += 1;
      const parsed = parseConvertedMunicipalDocument(
        source,
        attachment,
        result.data,
      );
      if (parsed) candidates.push(parsed);
    } catch {
      // One bad attachment must not block another official attachment.
    }
  }
  if (candidates.length) return { status: "ok", candidates };
  return {
    status: successfulConversions ? "conversion_failed" : "conversion_failed",
    candidates: [],
  };
}
