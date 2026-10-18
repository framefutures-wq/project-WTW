import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const fields = [
  "title",
  "start_date",
  "end_date",
  "venue",
  "address",
  "price",
  "cancelled",
  "postponed",
  "operation_change",
];
export const types = [
  "event_official",
  "organizer_official",
  "local_government",
  "visitkorea",
  "other",
  "unknown",
];
export function normalizeComparable(field, value) {
  if (value == null) return null;
  const text = String(value).normalize("NFKC").trim();
  if (["start_date", "end_date"].includes(field)) {
    const date = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
    if (date) {
      const iso = `${date[1]}-${date[2].padStart(2, "0")}-${date[3].padStart(2, "0")}`;
      const parsed = new Date(`${iso}T00:00:00Z`);
      if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso)
        return iso;
    }
  }
  // Formatting-only equivalence: punctuation and whitespace carry no identity.
  return text.replace(/[\s\p{P}\p{S}]+/gu, "").toLowerCase();
}
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export function decode(value) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => {
      const code =
        n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n);
      return code <= 0x10ffff ? String.fromCodePoint(code) : "";
    });
}
export function plain(html) {
  return decode(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}
export function normalizeUrl(raw) {
  try {
    const u = new URL(
      decode(raw)
        .trim()
        .replace(/^www\./i, "https://www."),
    );
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
      return null;
    if (
      [...u.searchParams.keys()].some((k) =>
        /^(servicekey|api[_-]?key|token|password|secret|access_token)$/i.test(
          k,
        ),
      )
    )
      return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}
export function extractUrls(value, path = "raw") {
  const results = [];
  function walk(v, p) {
    if (typeof v === "string") {
      const decoded = decode(v);
      for (const match of decoded.matchAll(
        /(?:https?:\/\/|www\.)[^\s<>"']+/gi,
      )) {
        const url = normalizeUrl(match[0].replace(/\)[가-힣]+.*$/, "").replace(/[),;]+$/, ""));
        if (url)
          results.push({
            url,
            path: p,
            asset:
              /(?:firstimage\d*|image|img|mapurl)$/i.test(p) ||
              /\.(?:png|jpe?g|gif|webp|svg|mp4|pdf)(?:\?|$)/i.test(url),
          });
      }
      // A provider homepage field may contain a bare host with a Korean label.
      // Do not infer hosts from arbitrary prose or email addresses.
      if (/homepage$/i.test(p) && !/(?:https?:\/\/|www\.)/i.test(decoded)) {
        for (const match of decoded.matchAll(/(?:^|\s)((?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"']*)?)(?=\s|$)/gi)) {
          const url = normalizeUrl(`https://${match[1]}`);
          if (url) results.push({ url, path: p, asset: false, normalization: "provider_bare_host_https" });
        }
      }
    } else if (v && typeof v === "object")
      for (const [k, val] of Object.entries(v)) walk(val, `${p}.${k}`);
  }
  walk(value, path);
  return results;
}
function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && [18, 19].includes(b))
    );
  }
  return isIP(address) === 6 && !/^(::|f[cd]|fe[89ab])/i.test(address);
}
export async function allowedUrl(raw) {
  const normalized = normalizeUrl(raw);
  if (!normalized) return false;
  const u = new URL(normalized);
  if (
    (u.port && !["80", "443"].includes(u.port)) ||
    !u.hostname.includes(".") ||
    /\.(localhost|local|internal)$/i.test(u.hostname)
  )
    return false;
  try {
    const addresses = await lookup(u.hostname, { all: true });
    return (
      addresses.length > 0 && addresses.every((a) => publicAddress(a.address))
    );
  } catch {
    return null;
  }
}
export async function fetchPage(url) {
  const result = {
    url,
    finalUrl: url,
    checkedAt: new Date().toISOString(),
    httpStatus: null,
    accessStatus: "network_error",
    title: null,
    text: "",
    contentHash: null,
  };
  try {
    for (let n = 0; n <= 5; n++) {
      const allowed = await allowedUrl(result.finalUrl);
      if (allowed === false) return { ...result, accessStatus: "blocked_url" };
      if (allowed === null) return result;
      const response = await fetch(result.finalUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(12000),
        headers: {
          "user-agent": "project-WTW source-audit/1.0",
          accept: "text/html,text/plain",
        },
      });
      result.httpStatus = response.status;
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || n === 5)
          return { ...result, accessStatus: "http_error" };
        result.finalUrl = new URL(location, result.finalUrl).href;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        return { ...result, accessStatus: "http_error" };
      }
      const contentType = response.headers.get("content-type") || "";
      if (!/text\/html|text\/plain|application\/xhtml/i.test(contentType)) {
        await response.body?.cancel();
        return { ...result, accessStatus: "unsupported_content" };
      }
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2_000_000) {
          await reader.cancel();
          return { ...result, accessStatus: "too_large" };
        }
        chunks.push(value);
      }
      const bytes = Buffer.concat(chunks);
      let charset = contentType.match(/charset=["']?([^;"'\s]+)/i)?.[1];
      charset ||=
        bytes
          .toString("ascii")
          .slice(0, 10000)
          .match(/charset=["']?([a-z0-9_-]+)/i)?.[1] || "utf-8";
      let html;
      try {
        html = new TextDecoder(charset).decode(bytes);
      } catch {
        html = bytes.toString("utf8");
      }
      return {
        ...result,
        accessStatus: "ok",
        title:
          plain(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "") ||
          null,
        text: plain(html),
        contentHash: hash(bytes),
      };
    }
  } catch {
    return result;
  }
  return result;
}
// Classification requires a reviewed excerpt from this exact fetched document.
// Transport failure is independent of officialness and never establishes 'other'.
export function classify(page, review) {
  if (!review)
    return {
      sourceTypes: ["unknown"],
      official: null,
      reason: page.accessStatus === "ok" ? "페이지의 행사·운영기관 관계를 확정할 근거 미확인" : "공식성 평가 미실시. 접근 실패 상태를 공식/비공식 판정 근거로 사용하지 않음",
      excerpt: null,
    };
  if (typeof review.official !== "boolean" && review.official !== null) throw new Error("Officialness must be true, false, or null");
  if (
    page.accessStatus !== "ok" ||
    review.contentHash !== page.contentHash ||
    !review.excerpt ||
    !page.text.includes(review.excerpt)
  )
    throw new Error("Review does not match fetched evidence");
  if (
    !review.sourceTypes?.length ||
    review.sourceTypes.some((t) => !types.includes(t))
  )
    throw new Error("Invalid source type");
  if (
    review.official &&
    !review.sourceTypes.some((t) =>
      ["event_official", "organizer_official", "local_government"].includes(t),
    )
  )
    throw new Error("Not an eligible official source");
  if (!review.reason) throw new Error("Review reason required");
  return {
    sourceTypes: review.sourceTypes,
    official: review.official,
    reason: review.reason,
    excerpt: review.excerpt,
  };
}
export function compare(
  field,
  tourapiValue,
  observation,
  page,
  classification,
) {
  const base = {
    field,
    tourapiValue:
      tourapiValue == null || tourapiValue === "" ? null : String(tourapiValue),
    officialValue: null,
    evidenceUrl: null,
    excerpt: null,
    result: "unconfirmed",
    reason: "공식 페이지에 해당 회차의 명확한 필드 근거 미확보",
  };
  if (!observation) return base;
  if (
    classification.official !== true ||
    page.accessStatus !== "ok" ||
    !observation.excerpt ||
    !page.text.includes(observation.excerpt) ||
    !observation.value ||
    !observation.reason
  )
    throw new Error("Comparison requires explicit official evidence");
  return {
    ...base,
    officialValue: observation.value,
    evidenceUrl: page.finalUrl,
    excerpt: observation.excerpt,
    result:
      base.tourapiValue === null
        ? "not_comparable"
        : normalizeComparable(field, base.tourapiValue) ===
            normalizeComparable(field, observation.value)
          ? "match"
          : observation.equivalent === true
            ? "match"
            : "mismatch",
    reason: observation.reason,
  };
}
