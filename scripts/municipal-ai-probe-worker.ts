import {
  extractMunicipalDocumentCandidates,
  type MunicipalMarkdownAI,
} from "../shared/municipal-document-fallback";
import { municipalSourceByKey } from "../shared/municipal-source-registry";

interface ProbeEnv {
  AI: MunicipalMarkdownAI;
}

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

    const result = await extractMunicipalDocumentCandidates({
      ai: env.AI,
      source,
      html: await page.text(),
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
      { ok, source_page: PAGE, status: result.status, candidates },
      { status: ok ? 200 : 422 },
    );
  },
} satisfies ExportedHandler<ProbeEnv>;
