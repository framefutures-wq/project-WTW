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
        image?: { descriptionLanguage?: string };
      };
    },
  ): Promise<MunicipalMarkdownResult | MunicipalMarkdownResult[]>;
}

/** The existing Workers AI binding also exposes direct model inference. */
export interface MunicipalVisionAI {
  run(model: string, input: unknown, options?: unknown): Promise<unknown>;
}

export type MunicipalDocumentCandidate = {
  mode: MunicipalDocumentMode;
  candidate: MunicipalCandidate;
  attachment: MunicipalDocumentAttachment;
};

const seoulDate = (value: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));

export function confirmRepeatedImageVisionCandidate(
  candidate: MunicipalCandidate,
  {
    previousPayloadHash,
    currentPayloadHash,
    previousSeenAt,
    currentSeenAt,
  }: {
    previousPayloadHash?: string | null;
    currentPayloadHash: string;
    previousSeenAt?: string | null;
    currentSeenAt: string;
  },
): MunicipalCandidate {
  if (candidate.parse_error !== "image_vision_requires_confirmation")
    return candidate;
  if (
    !candidate.title ||
    !candidate.start_date ||
    !candidate.end_date ||
    !candidate.venue ||
    !previousPayloadHash ||
    previousPayloadHash !== currentPayloadHash ||
    !previousSeenAt
  )
    return candidate;

  const previousDay = seoulDate(previousSeenAt);
  const currentDay = seoulDate(currentSeenAt);
  if (!previousDay || !currentDay || previousDay >= currentDay)
    return candidate;

  const { parse_error: _confirmed, ...confirmed } = candidate;
  return confirmed;
}

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

const htmlText = (value: string) =>
  value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#40;/gi, "(")
    .replace(/&#41;/gi, ")")
    .replace(/\s+/g, " ")
    .trim();

const supportedExtension = (value: string) => {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Keep the original value when a municipal URL contains malformed escapes.
  }
  const match = /\.([a-z0-9]+)(?=$|[?#\s"'()<>])/i.exec(decoded);
  const extension = match?.[1]?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ? extension : "";
};

const filenameFromContext = (value: string) => {
  const text = htmlText(value);
  const match =
    /([^<>/\\|]+?\.(?:pdf|jpe?g|png|webp|svg|gif|bmp))(?=$|[\s"'()])/i.exec(
      text,
    );
  return match?.[1]?.trim() ?? null;
};

export function extractMunicipalDocumentAttachments(
  source: MunicipalSourceDefinition,
  html: string,
): MunicipalDocumentAttachment[] {
  const found: MunicipalDocumentAttachment[] = [];
  const seen = new Set<string>();

  const consider = (rawValue: string, context = "") => {
    const raw = rawValue.replace(/&amp;/gi, "&").trim();
    let url: string;
    try {
      url = new URL(raw, source.url).toString();
    } catch {
      return;
    }
    if (!municipalSourceAllowsUrl(source, url) || seen.has(url)) return;

    const contextualName = filenameFromContext(context);
    const extension =
      supportedExtension(url) || supportedExtension(contextualName ?? "");
    const supported = MIME_BY_EXTENSION[extension];
    if (!supported) return;

    seen.add(url);
    found.push({
      url,
      name:
        contextualName ??
        attachmentName(url, `municipal-${source.key}.${extension}`),
      kind: supported.kind,
      mimeType: supported.mimeType,
    });
  };

  // Korean municipal sites frequently serve files through extensionless
  // download endpoints and expose the real filename only in link context.
  for (const match of html.matchAll(
    /<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi,
  ))
    consider(match[2], `${match[1]} ${match[3]} ${match[4]}`);

  for (const match of html.matchAll(
    /<img\b([^>]*?)src=["']([^"']+)["']([^>]*)>/gi,
  ))
    consider(match[2], `${match[1]} ${match[3]}`);

  // Preserve support for simple markup and direct file URLs.
  for (const match of html.matchAll(/(?:href|src)=["']([^"']+)["']/gi))
    consider(match[1]);

  return found
    .sort((left, right) =>
      left.kind === right.kind ? 0 : left.kind === "pdf" ? -1 : 1,
    )
    .slice(0, MAX_ATTACHMENTS);
}

const parseDateRange = (text: string) => {
  const labeled = /(?:행사\s*기간|축제\s*기간|기\s*간|행사\s*일시|일\s*시)\s*[:：]?\s*([^\n\r]{4,120})/i.exec(text)?.[1];
  if (!labeled) return null;

  const toDate = (year: string, month: string, day: string) =>
    `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const fullDate = (value: string) => {
    const match =
      /(20\d{2})\s*(?:[.\/-]\s*|년\s*)(\d{1,2})\s*(?:[.\/-]\s*|월\s*)(\d{1,2})/.exec(
        value,
      );
    return match
      ? { year: match[1], month: match[2], day: match[3] }
      : null;
  };

  const [startText, endText] = labeled.split(/[~∼]/, 2);
  const startParts = fullDate(startText);
  if (!startParts) return null;
  const start = toDate(startParts.year, startParts.month, startParts.day);
  if (!endText) return { start, end: start };

  const endFull = fullDate(endText);
  if (endFull)
    return {
      start,
      end: toDate(endFull.year, endFull.month, endFull.day),
    };

  const monthDay =
    /(\d{1,2})\s*(?:[.\/-]\s*|월\s*)(\d{1,2})/.exec(endText);
  if (monthDay)
    return {
      start,
      end: toDate(startParts.year, monthDay[1], monthDay[2]),
    };

  const dayOnly = /^\s*(\d{1,2})\s*(?:[.]|일)?\s*$/.exec(endText);
  if (dayOnly)
    return {
      start,
      end: toDate(startParts.year, startParts.month, dayOnly[1]),
    };

  return { start, end: start };
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
  fetchUrl = attachment.url,
) => {
  const response = await fetcher(fetchUrl, {
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "image/*,application/pdf", "user-agent": "Mozilla/5.0" },
  });
  if (!response.ok) throw new Error(`attachment_http_${response.status}`);
  const declaredSize = Number(response.headers.get("content-length") ?? "0");
  if (declaredSize > MAX_ATTACHMENT_BYTES) throw new Error("attachment_too_large");
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) throw new Error("attachment_too_large");
  return new Blob([buffer], { type: attachment.mimeType });
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let start = 0; start < bytes.length; start += chunkSize)
    binary += String.fromCharCode(...bytes.subarray(start, start + chunkSize));
  return btoa(binary);
};

const strictPosterTranscriptionPrompt = [
  "이 이미지는 한국어 행사 포스터다.",
  "보이는 한글, 숫자, 시간, 장소, 프로그램 문구를 가능한 한 원문 그대로 전사하라.",
  "번역, 요약, 설명, 추측, 화면에 없는 문구 생성은 금지한다.",
  "읽을 수 없는 부분은 만들어내지 말고 생략하거나 [판독불가]로 표시한다.",
  "행사 사실을 구조화하거나 추론하지 말고 원문 전사만 반환하라.",
].join(" ");

function transcriptionFromVisionResponse(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const value = response as {
    response?: unknown;
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = value.choices?.[0]?.message?.content ?? value.response;
  if (typeof content !== "string") return null;
  try {
    const parsed = JSON.parse(content) as { transcription?: unknown };
    return typeof parsed.transcription === "string"
      ? parsed.transcription.replace(/\r/g, "").trim().slice(0, 20_000) || null
      : null;
  } catch {
    return null;
  }
}

/**
 * OCR is intentionally separate from Markdown conversion: that service
 * describes images, while this direct vision request asks only for a literal
 * Korean transcription.
 */
export async function transcribeMunicipalPosterImage({
  ai,
  attachment,
  fetcher = fetch,
  fetchUrl,
}: {
  ai: MunicipalVisionAI;
  attachment: MunicipalDocumentAttachment;
  fetcher?: typeof fetch;
  fetchUrl?: string;
}): Promise<string | null> {
  if (attachment.kind !== "image") return null;
  const blob = await fetchAttachment(attachment, fetcher, fetchUrl);
  const imageUrl = `data:${attachment.mimeType};base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`;
  const response = await ai.run("@cf/google/gemma-4-26b-a4b-it", {
    messages: [
      { role: "system", content: strictPosterTranscriptionPrompt },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageUrl } },
          { type: "text", text: "JSON의 transcription 필드에 전사문만 반환하라." },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        type: "object",
        properties: { transcription: { type: "string" } },
        required: ["transcription"],
        additionalProperties: false,
      },
    },
    temperature: 0,
    max_tokens: 2048,
    chat_template_kwargs: { enable_thinking: false },
  });
  return transcriptionFromVisionResponse(response);
}

export async function convertMunicipalDocumentText({
  ai,
  attachment,
  fetcher = fetch,
  fetchUrl,
}: {
  ai: MunicipalMarkdownAI;
  attachment: MunicipalDocumentAttachment;
  fetcher?: typeof fetch;
  fetchUrl?: string;
}): Promise<string | null> {
  const blob = await fetchAttachment(attachment, fetcher, fetchUrl);
  const converted = await ai.toMarkdown(
    { name: attachment.name, blob },
    {
      conversionOptions: {
        output: { format: "text" },
        ...(attachment.kind === "pdf"
          ? { pdf: { metadata: false } }
          : { image: { descriptionLanguage: "ko" } }),
      },
    },
  );
  const result = Array.isArray(converted) ? converted[0] : converted;
  if (!result || result.format === "error" || !result.data) return null;
  return result.data.replace(/\r/g, "").trim().slice(0, 20_000) || null;
}

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
  for (const attachment of attachments) {
    try {
      const text = await convertMunicipalDocumentText({ ai, attachment, fetcher });
      if (!text) continue;
      const parsed = parseConvertedMunicipalDocument(
        source,
        attachment,
        text,
      );
      if (parsed) candidates.push(parsed);
    } catch {
      // One bad attachment must not block another official attachment.
    }
  }
  if (candidates.length) return { status: "ok", candidates };
  return { status: "conversion_failed", candidates: [] };
}
