const READER_ENDPOINT = "https://r.jina.ai/";
const MAX_READER_BYTES = 2_000_000;

export type OfficialReaderOptions = {
  refererUrl?: string | null;
  injectPageScript?: string | null;
};

export type OfficialReaderPage = {
  html: string;
  finalUrl: string;
};

function publicHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      host === "localhost" ||
      host.startsWith("[") ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
      !host.includes(".")
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function inlineMarkdown(value: string) {
  const escaped = escapeHtml(value);
  return escaped
    .replace(
      /!\[([^\]]*)\]\((https:\/\/[^\s)]+)(?:\s+["'][^"']*["'])?\)/g,
      '<img src="$2" alt="$1">',
    )
    .replace(
      /\[([^\]]+)\]\((https:\/\/[^\s)]+)(?:\s+["'][^"']*["'])?\)/g,
      '<a href="$2">$1</a>',
    );
}

function markdownToHtml(content: string) {
  const lines = content.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1] ?? "";
    if (
      line.includes("|") &&
      /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(next)
    ) {
      const rows: string[] = [line];
      index += 2;
      while (index < lines.length && lines[index].includes("|")) {
        rows.push(lines[index]);
        index += 1;
      }
      index -= 1;
      out.push("<table>");
      rows.forEach((row, rowIndex) => {
        const cells = row
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => cell.trim());
        const tag = rowIndex === 0 ? "th" : "td";
        out.push(
          "<tr>" +
            cells
              .map(
                (cell) =>
                  "<" + tag + ">" + inlineMarkdown(cell) + "</" + tag + ">",
              )
              .join("") +
            "</tr>",
        );
      });
      out.push("</table>");
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(
        "<h" +
          level +
          ">" +
          inlineMarkdown(heading[2]) +
          "</h" +
          level +
          ">",
      );
      continue;
    }
    if (line.trim()) out.push("<p>" + inlineMarkdown(line.trim()) + "</p>");
  }
  return out.join("\n");
}

function imageSummaryTags(images: unknown) {
  if (!images || typeof images !== "object" || Array.isArray(images)) return "";
  return Object.values(images as Record<string, unknown>)
    .filter(
      (value): value is string =>
        typeof value === "string" && Boolean(publicHttpsUrl(value)),
    )
    .slice(0, 12)
    .map((url) => '<img src="' + escapeHtml(url) + '" alt="">')
    .join("\n");
}

export async function fetchOfficialPageViaReader(
  targetUrl: string,
  options: OfficialReaderOptions = {},
): Promise<OfficialReaderPage> {
  const target = publicHttpsUrl(targetUrl);
  if (!target) throw new Error("official_reader_invalid_target");
  const referer = options.refererUrl
    ? publicHttpsUrl(options.refererUrl)?.toString() ?? null
    : null;
  const body: Record<string, unknown> = { url: target.toString() };
  if (options.injectPageScript)
    body.injectPageScript = options.injectPageScript;

  const response = await fetch(READER_ENDPOINT, {
    method: "POST",
    signal: AbortSignal.timeout(25_000),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-return-format": "html",
      "x-timeout": "20",
      "x-locale": "ko-KR",
      "x-no-cache": "true",
      "x-with-images-summary": "true",
      ...(referer ? { "x-referer": referer } : {}),
      dnt: "1",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error("official_reader_http_" + response.status);

  const raw = await response.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_READER_BYTES)
    throw new Error("official_reader_too_large");

  let content = raw;
  let images: unknown = null;
  let finalUrl = target.toString();
  try {
    const payload = JSON.parse(raw) as {
      data?: { content?: unknown; url?: unknown; images?: unknown };
      content?: unknown;
      url?: unknown;
      images?: unknown;
    };
    const candidate = payload.data?.content ?? payload.content;
    if (typeof candidate === "string") content = candidate;
    images = payload.data?.images ?? payload.images ?? null;
    const reportedUrl = payload.data?.url ?? payload.url;
    if (typeof reportedUrl === "string") {
      const reported = publicHttpsUrl(reportedUrl);
      if (
        reported &&
        reported.hostname.replace(/^www\./, "") ===
          target.hostname.replace(/^www\./, "")
      )
        finalUrl = reported.toString();
    }
  } catch {
    // Reader may return plain text; normalize that below.
  }

  if (!content.trim()) throw new Error("official_reader_empty");
  const html =
    /<(?:html|body|table|ul|ol|li|article|section|div|h[1-6]|p|img|a)\b/i.test(
      content,
    )
      ? content
      : markdownToHtml(content);
  const enriched = [html, imageSummaryTags(images)].filter(Boolean).join("\n");
  if (!enriched.trim()) throw new Error("official_reader_empty");
  if (new TextEncoder().encode(enriched).byteLength > MAX_READER_BYTES)
    throw new Error("official_reader_too_large");
  return { html: enriched, finalUrl };
}

export function buildDetailLinkInjection(
  targetUrl: string,
  template:
    | {
        path: string;
        idParam: string;
        fixedQuery?: Readonly<Record<string, string>>;
      }
    | undefined,
) {
  if (!template) return null;
  const target = publicHttpsUrl(targetUrl);
  if (!target) return null;
  const payload = JSON.stringify({
    origin: target.origin,
    path: template.path,
    idParam: template.idParam,
    fixedQuery: template.fixedQuery ?? {},
  });
  return (
    "(() => {" +
    "const cfg=" +
    payload +
    ";" +
    "for(const el of document.querySelectorAll('a[onclick],button[onclick]')){" +
    "const raw=el.getAttribute('onclick')||'';" +
    "const match=raw.match(/(?:['\\\"])(\\d+)(?:['\\\"])|\\((\\d+)\\)/);" +
    "const id=match&&(match[1]||match[2]);if(!id)continue;" +
    "const url=new URL(cfg.path,cfg.origin);" +
    "for(const [key,value] of Object.entries(cfg.fixedQuery))url.searchParams.set(key,value);" +
    "url.searchParams.set(cfg.idParam,id);" +
    "if(el.tagName==='A')el.setAttribute('href',url.toString());" +
    "else el.setAttribute('data-detail-url',url.toString());" +
    "}" +
    "})()"
  );
}
