export type OfficialPageImageCandidate = {
  url: string;
  signal:
    | "OG_IMAGE"
    | "TWITTER_IMAGE"
    | "JSON_LD_IMAGE"
    | "ATTACHMENT_IMAGE"
    | "IMG";
  alt: string | null;
};

export type RawPayloadImageCandidate = {
  url: string;
  path: string;
};

const decodeHtml = (value: string) =>
  value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

function safeHttps(baseUrl: string, raw: unknown) {
  if (typeof raw !== "string") return null;
  const value = decodeHtml(raw.trim());
  if (!value || /^(?:data|blob|javascript):/i.test(value)) return null;
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.href;
  } catch {
    return null;
  }
}

function attribute(tag: string, name: string) {
  const escaped = name.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  const quoted = new RegExp(`${escaped}\\s*=\\s*(['"])([\\s\\S]*?)\\1`, "i").exec(tag)?.[2];
  if (quoted) return decodeHtml(quoted.trim());
  return new RegExp(`${escaped}\\s*=\\s*([^\\s>]+)`, "i").exec(tag)?.[1]?.trim() ?? null;
}

function pushUnique(
  output: OfficialPageImageCandidate[],
  seen: Set<string>,
  candidate: OfficialPageImageCandidate,
) {
  if (seen.has(candidate.url)) return;
  seen.add(candidate.url);
  output.push(candidate);
}

function looksDecorative(url: string, alt: string | null) {
  const haystack = `${url} ${alt ?? ""}`.toLowerCase();
  return (
    /(?:favicon|sprite|spacer|pixel|tracking|noimg|no_image|default_img|all_menu|menu_show|logo(?:[._/-]|$)|icon(?:[._/-]|$)|btn(?:[._/-]|$)|button(?:[._/-]|$)|arrow(?:[._/-]|$))/i.test(
      haystack,
    ) || /\/inc\/img\/common\//i.test(haystack)
  );
}

function jsonLdImageValues(value: unknown, output: string[]) {
  if (Array.isArray(value)) {
    for (const item of value) jsonLdImageValues(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^(?:image|thumbnailUrl|contentUrl)$/i.test(key)) {
      if (typeof child === "string") output.push(child);
      else if (Array.isArray(child))
        for (const item of child) {
          if (typeof item === "string") output.push(item);
          else if (item && typeof item === "object") {
            const record = item as Record<string, unknown>;
            for (const candidate of [record.url, record.contentUrl, record.thumbnailUrl])
              if (typeof candidate === "string") output.push(candidate);
          }
        }
      else if (child && typeof child === "object") {
        const record = child as Record<string, unknown>;
        for (const candidate of [record.url, record.contentUrl, record.thumbnailUrl])
          if (typeof candidate === "string") output.push(candidate);
      }
    }
    jsonLdImageValues(child, output);
  }
}

export function extractOfficialPageImageCandidates(
  pageUrl: string,
  html: string,
  limit = 12,
): OfficialPageImageCandidate[] {
  const output: OfficialPageImageCandidate[] = [];
  const seen = new Set<string>();
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metas) {
    const key = (attribute(tag, "property") ?? attribute(tag, "name") ?? "").toLowerCase();
    const content = attribute(tag, "content");
    if (!content) continue;
    const signal =
      key === "og:image" || key === "og:image:url"
        ? "OG_IMAGE"
        : key === "twitter:image" || key === "twitter:image:src"
          ? "TWITTER_IMAGE"
          : null;
    if (!signal) continue;
    const url = safeHttps(pageUrl, content);
    if (!url || looksDecorative(url, null)) continue;
    pushUnique(output, seen, { url, signal, alt: null });
    if (output.length >= limit) return output;
  }

  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*(['"])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try {
      const parsed = JSON.parse(match[2]);
      const values: string[] = [];
      jsonLdImageValues(parsed, values);
      for (const raw of values) {
        const url = safeHttps(pageUrl, raw);
        if (!url || looksDecorative(url, null)) continue;
        pushUnique(output, seen, { url, signal: "JSON_LD_IMAGE", alt: null });
        if (output.length >= limit) return output;
      }
    } catch {}
  }

  const anchors = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) ?? [];
  for (const tag of anchors) {
    const href = attribute(tag, "href");
    const label = decodeHtml(
      tag.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    );
    const url = safeHttps(pageUrl, href);
    if (!url || looksDecorative(url, label || null)) continue;
    const path = new URL(url).pathname;
    if (!/\.(?:avif|webp|png|jpe?g|gif)$/i.test(path)) continue;
    if (
      !/(?:포스터|poster|행사|축제|festival|event|공연|전시)/i.test(
        `${label} ${decodeURIComponent(path)}`,
      )
    )
      continue;
    pushUnique(output, seen, {
      url,
      signal: "ATTACHMENT_IMAGE",
      alt: label || null,
    });
    if (output.length >= limit) return output;
  }

  const images = html.match(/<img\b[^>]*>/gi) ?? [];
  for (const tag of images) {
    const raw =
      attribute(tag, "src") ??
      attribute(tag, "data-src") ??
      attribute(tag, "data-original") ??
      attribute(tag, "data-lazy-src");
    const alt = attribute(tag, "alt");
    const url = safeHttps(pageUrl, raw);
    if (!url || looksDecorative(url, alt)) continue;
    pushUnique(output, seen, { url, signal: "IMG", alt });
    if (output.length >= limit) return output;
  }
  return output;
}

const IMAGE_KEY = /(?:^|_)(?:firstimage2?|image(?:url)?|image_url|poster|thumbnail|thumb)(?:$|_)/i;
const IMAGE_EXT = /\.(?:avif|webp|png|jpe?g|gif)(?:[?#]|$)/i;

export function extractRawPayloadImageCandidates(
  value: unknown,
  path = "raw",
  limit = 12,
): RawPayloadImageCandidate[] {
  const output: RawPayloadImageCandidate[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown, currentPath: string, keyHint = "") => {
    if (output.length >= limit) return;
    if (typeof node === "string") {
      if (!IMAGE_KEY.test(keyHint) && !IMAGE_EXT.test(node)) return;
      const url = safeHttps("https://example.invalid/", node);
      if (!url || seen.has(url) || looksDecorative(url, null)) return;
      seen.add(url);
      output.push({ url, path: currentPath });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${currentPath}.${index}`, keyHint));
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node as Record<string, unknown>))
      walk(child, `${currentPath}.${key}`, key);
  };
  walk(value, path);
  return output;
}