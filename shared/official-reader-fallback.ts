const READER_ENDPOINT = "https://r.jina.ai/";
const MAX_READER_BYTES = 2_000_000;

export type OfficialReaderOptions = {
  refererUrl?: string | null;
  /** Clamp scheduled recovery waits without changing manual/default behavior. */
  timeoutMs?: number;
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
  // Anonymous Reader's documented basic path is GET with the target URL
  // appended to r.jina.ai. Request rendered HTML so municipal parsers retain
  // onclick/data attributes that Markdown conversion would discard.
  const readerUrl = READER_ENDPOINT + target.toString();
  const timeoutMs = options.timeoutMs ?? 25_000;
  const withinTimeout = <T>(promise: Promise<T>) => new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("official_reader_timeout")), timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
  const request = fetch(readerUrl, {
    method: "GET",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: "application/json",
      "x-respond-with": "html",
      "x-timeout": "20",
      "x-locale": "ko-KR",
      // This path is used only after direct official fetches fail. A recent
      // cached official snapshot is preferable to dropping the source
      // entirely; event identity/date/venue validation still gates writes.
      "x-cache-tolerance": "86400",
      "x-retain-links": "all",
      "x-retain-images": "all",
      "x-with-images-summary": "true",
      "x-base": "final",
      ...(referer ? { "x-referer": referer } : {}),
    },
  });
  const response = options.timeoutMs ? await withinTimeout(request) : await request;
  if (!response.ok)
    throw new Error("official_reader_http_" + response.status);

  const body = response.text();
  const raw = options.timeoutMs ? await withinTimeout(body) : await body;
  if (new TextEncoder().encode(raw).byteLength > MAX_READER_BYTES)
    throw new Error("official_reader_too_large");

  let content = raw;
  let images: unknown = null;
  let finalUrl = target.toString();
  try {
    const payload = JSON.parse(raw) as {
      data?: {
        html?: unknown;
        content?: unknown;
        text?: unknown;
        url?: unknown;
        images?: unknown;
      };
      html?: unknown;
      content?: unknown;
      text?: unknown;
      url?: unknown;
      images?: unknown;
    };
    const candidate =
      payload.data?.html ??
      payload.html ??
      payload.data?.content ??
      payload.content ??
      payload.data?.text ??
      payload.text;
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
