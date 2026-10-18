import {
  extractMunicipalDocumentAttachments,
  extractMunicipalDocumentCandidates,
  parseConvertedMunicipalDocument,
  type MunicipalDocumentCandidate,
  type MunicipalMarkdownAI,
} from "../shared/municipal-document-fallback";
import { municipalSourceByKey } from "../shared/municipal-source-registry";
import {
  corroborateProbeImageText,
  normalizeProbePdfText,
} from "./municipal-ai-probe-evidence";

interface ProbeEnv {
  AI: MunicipalMarkdownAI;
}

const safeError = (error: unknown) =>
  String(error instanceof Error ? error.message : error)
    .replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{24,}\b/g, "[redacted]")
    .replace(/\b(token|key|secret|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 200);

const relevantLines = (data: string) =>
  data
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /고양|중장년|박람회|일시|기간|2026|장소|꽃전시관/.test(line))
    .slice(0, 16)
    .map((line) =>
      safeError(
        line
          .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
          .replace(/\b\d[\d-]{7,}\d\b/g, "[number]"),
      ),
    );

const PAGE =
  "https://www.goyang.go.kr/news/user/bbs/BD_selectBbs.do?q_bbsCode=1030&q_bbscttSn=20260907164351408";

export default {
  async fetch(_request: Request, env: ProbeEnv) {
    const source = municipalSourceByKey("goyang");
    if (!source)
      return Response.json({ ok: false, error: "source_missing" }, { status: 500 });

    const page = await fetch(PAGE, {
      headers: { "user-agent": "WeekendMwohaeMunicipalProbe/1.0" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!page.ok)
      return Response.json(
        { ok: false, error: `official_page_http_${page.status}` },
        { status: 502 },
      );

    const html = await page.text();
    const attachments = extractMunicipalDocumentAttachments(source, html);
    const diagnostics: Array<Record<string, unknown>> = [];
    let pdfEvidence: MunicipalDocumentCandidate | null = null;
    const pairedImages = new Set<string>();
    const ai: MunicipalMarkdownAI = {
      async toMarkdown(files, options) {
        try {
          const converted = await env.AI.toMarkdown(files, options);
          const first = Array.isArray(converted) ? converted[0] : converted;
          diagnostics.push({ stage: "convert", format: first?.format, has_data: Boolean(first?.data), relevant_lines: first?.data ? relevantLines(first.data) : [], error: first?.error ? safeError(first.error) : null });
          const file = Array.isArray(files) ? files[0] : files;
          const attachment = attachments.find((item) => item.name === file?.name);
          if (!first?.data || !attachment) return converted;

          let data = first.data;
          if (attachment.kind === "pdf") {
            data = normalizeProbePdfText(data);
            pdfEvidence = parseConvertedMunicipalDocument(source, attachment, data);
          } else {
            const corroborated = corroborateProbeImageText(data, pdfEvidence);
            if (corroborated) {
              data = corroborated;
              pairedImages.add(attachment.url);
            }
          }
          const normalized = { ...first, data };
          return Array.isArray(converted)
            ? [normalized, ...converted.slice(1)]
            : normalized;
        } catch (error) {
          diagnostics.push({ stage: "convert", error: safeError(error) });
          throw error;
        }
      },
    };
    const result = await extractMunicipalDocumentCandidates({
      ai,
      source,
      html,
      fetcher: async (url, options) => {
        try {
          const response = await fetch(url, options);
          diagnostics.push({ stage: "fetch", status: response.status, type: response.headers.get("content-type") });
          return response;
        } catch (error) {
          diagnostics.push({ stage: "fetch", error: safeError(error) });
          throw error;
        }
      },
    });
    const candidates = result.candidates.map(({ mode, candidate, attachment }) => ({
      mode,
      attachment_kind: attachment.kind,
      attachment_name: attachment.name,
      attachment_host: new URL(attachment.url).hostname,
      title: candidate.title,
      start_date: candidate.start_date,
      end_date: candidate.end_date,
      venue: candidate.venue,
      parse_error: candidate.parse_error ?? null,
      core_evidence:
        attachment.kind === "image" && pairedImages.has(attachment.url)
          ? "paired_official_pdf"
          : "attachment",
    }));

    const pdf = candidates.find((item) => item.attachment_kind === "pdf");
    const image = candidates.find((item) => item.attachment_kind === "image");
    const coreMatches = (item: typeof pdf) =>
      Boolean(
        item &&
          item.start_date === "2026-10-29" &&
          item.end_date === "2026-10-29" &&
          item.venue?.includes("고양꽃전시관"),
      );
    const ok =
      result.status === "ok" &&
      coreMatches(pdf) &&
      coreMatches(image) &&
      pdf?.parse_error === null &&
      image?.parse_error === "image_vision_requires_confirmation";

    return Response.json(
      { ok, source_page: PAGE, status: result.status, candidates, ...(ok ? {} : { diagnostics }) },
      { status: ok ? 200 : 422 },
    );
  },
} satisfies ExportedHandler<ProbeEnv>;
