import { decodeEventPathId, validEventId } from "../shared/event-id";

export const CANONICAL_ORIGIN = "https://galteum.com";

export type SeoEvent = {
  id: string;
  title: string;
  venue: string;
  address: string;
  start_date: string;
  end_date: string;
  status: string;
  cost: string;
  image_url: string | null;
  image_status: string | null;
  updated_at: string | null;
  checked_at: string | null;
};

export function validSeoEventId(value: string): boolean {
  return validEventId(value);
}

export function decodeSeoEventId(value: string): string | null {
  return decodeEventPathId(value);
}

export function eventCanonicalUrl(id: string): string {
  return `${CANONICAL_ORIGIN}/events/${encodeURIComponent(id)}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeImage(value: string | null, status: string | null) {
  if (status !== "ok" || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function eventDescription(event: SeoEvent) {
  const dates =
    event.start_date === event.end_date
      ? event.start_date
      : `${event.start_date}~${event.end_date}`;
  return `${event.title} · ${dates} · ${event.venue}. 갈틈에서 공식 확인 정보를 확인하세요.`.slice(
    0,
    180,
  );
}

function jsonForHtml(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

type SeoHead = { title: string; description: string; canonical: string; extra: string };

function rootHead(): SeoHead {
  return {
    title: "갈틈 · 오늘 갈 만한 곳을 한눈에",
    description: "오늘, 이번 주말, 원하는 날짜에 갈 만한 축제·지역행사·체험을 찾아보세요.",
    canonical: `${CANONICAL_ORIGIN}/`,
    extra: "",
  };
}

function eventHead(event: SeoEvent): SeoHead {
  const canonical = eventCanonicalUrl(event.id);
  const description = eventDescription(event);
  const image = safeImage(event.image_url, event.image_status);
  const structuredData: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    startDate: event.start_date,
    endDate: event.end_date,
    url: canonical,
    description,
    location: {
      "@type": "Place",
      name: event.venue,
      address: {
        "@type": "PostalAddress",
        streetAddress: event.address,
      },
    },
  };
  if (image) structuredData.image = [image];
  if (event.status === "scheduled")
    structuredData.eventStatus = "https://schema.org/EventScheduled";
  if (event.status === "cancelled")
    structuredData.eventStatus = "https://schema.org/EventCancelled";
  if (event.status === "postponed")
    structuredData.eventStatus = "https://schema.org/EventPostponed";
  return {
    title: `${event.title} | 갈틈`,
    description,
    canonical,
    extra: [
      '<meta property="og:type" content="website" />',
      `<meta property="og:title" content="${escapeHtml(`${event.title} | 갈틈`)}" />`,
      `<meta property="og:description" content="${escapeHtml(description)}" />`,
      `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
      image
        ? `<meta property="og:image" content="${escapeHtml(image)}" />`
        : "",
      `<script type="application/ld+json">${jsonForHtml(structuredData)}</script>`,
    ]
      .filter(Boolean)
      .join("\n    "),
  };
}

export function renderSeoHtml(html: string, event: SeoEvent | null = null) {
  const head = event ? eventHead(event) : rootHead();
  const base = html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(head.title)}</title>`)
    .replace(
      /<meta\s+name=["']description["'][^>]*>/i,
      `<meta name="description" content="${escapeHtml(head.description)}" />`,
    );
  const tags = [
    `<link rel="canonical" href="${escapeHtml(head.canonical)}" />`,
    head.extra,
  ]
    .filter(Boolean)
    .join("\n    ");
  return base.replace(/<\/head>/i, `    ${tags}\n  </head>`);
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function sitemapXml(events: SeoEvent[]) {
  const rows = events
    .filter((event) => validSeoEventId(event.id))
    .map((event) => {
      const lastmod = event.updated_at ?? event.checked_at;
      return [
        "  <url>",
        `    <loc>${xmlEscape(eventCanonicalUrl(event.id))}</loc>`,
        lastmod ? `    <lastmod>${xmlEscape(lastmod)}</lastmod>` : "",
        "  </url>",
      ]
        .filter(Boolean)
        .join("\n");
    });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    "  <url>",
    `    <loc>${CANONICAL_ORIGIN}/</loc>`,
    "  </url>",
    ...rows,
    "</urlset>",
  ].join("\n");
}

export const robotsTxt = `User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${CANONICAL_ORIGIN}/sitemap.xml
`;
