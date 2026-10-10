import {
  REGIONS,
  AUDIENCES,
  THEMES,
  dateRange,
  koreaDate,
  distanceKm,
  type DateRange,
  type EventItem,
} from "../shared/domain";
import type { Env } from "./env";
import { parseFilters, parseNearbyFilters, InputError } from "./filters";
import { runScheduled } from "./cron";
import {
  disableSubscription,
  isSameOrigin,
  parseSubscriptionRequest,
  pushStatus,
  readPushBody,
  upsertSubscription,
  validPushEndpoint,
} from "./push";
import {
  classifyFactTags,
  FACT_CLASSIFIER,
  FACT_RULE_VERSION,
} from "../shared/fact-tags";
import { USER_CONTENT_FILTER_BY_QUERY } from "../shared/content-filters";
import {
  audienceCompanionFilter,
  COMPANION_CLASSIFIER,
  COMPANION_RULE_VERSION,
} from "../shared/companion-suitability";
import { normalizeOfficialPhone } from "../shared/contact-phone";
import { looksDecorative } from "../shared/official-page-image-candidates";
import { municipalEventTimeOnlyLabel } from "../shared/municipal-rich-detail";
import { validProgramTime } from "../shared/event-program-time";
import {
  selectOperatingHours,
  validOperatingTime,
  type EventOperatingHours,
} from "../shared/event-operating-hours";
import { trustedPrivateLkgSources } from "../shared/private-official-sources";
import { analyticsRuntimeConfig } from "../shared/analytics-config";
import { seoLandingForPath } from "../shared/seo-landings";
import { legacyHostRedirect } from "./host";
import {
  decodeSeoEventId,
  renderSeoHtml,
  robotsTxt,
  sitemapXml,
  type SeoEvent,
} from "./seo";

const EVENT_FIELDS = `e.id,e.title,e.description,e.region,e.venue,e.address,
  e.start_date,e.end_date,e.lat,e.lng,e.cost,e.price_text,e.pet_policy,e.status,
  e.verification,e.is_sample,e.primary_source_id,e.checked_at`;
const SELECT = `SELECT ${EVENT_FIELDS}, s.url AS source_url, s.name AS source_name, s.kind AS source_kind,
  ts.trust_status, ts.checked_at AS trust_checked_at,
  ts.changed_fields AS trust_changed_fields,
  tsl.url AS trust_source_url, tsl.final_url AS trust_source_final_url,
  tsl.source_types AS trust_source_types,
  ei.image_url, ei.source_type AS image_source_type,
  ei.source_page_url AS image_source_page_url, ei.image_status,
  (SELECT json_group_array(json_object('start_date',oh.start_date,'end_date',oh.end_date,'start_time',oh.start_time,'end_time',oh.end_time,'human_time_text',oh.human_time_text))
   FROM event_operating_hours oh WHERE oh.event_id=e.id) AS operating_hours_json,
  (SELECT group_concat(tag) FROM event_tags WHERE event_id=e.id AND classifier_type='legacy') AS tag_list
  FROM events e
  LEFT JOIN sources s ON s.id=e.primary_source_id
  LEFT JOIN event_trust_status ts ON ts.event_id=e.id
  LEFT JOIN official_source_links tsl ON tsl.id=ts.evidence_source_id
  LEFT JOIN event_images ei ON ei.event_id=e.id AND ei.is_primary=1
`;
const availableRangeCache = new WeakMap<
  D1Database,
  { expiresAt: number; value: { start: string; end: string } | null }
>();
const AVAILABLE_RANGE_TTL_MS = 60_000;
const privateLkgClause = (alias: string) => {
  const entries = trustedPrivateLkgSources();
  if (!entries.length) return "0";
  // The values are code-owned registry constants, never request input.
  return entries
    .map(
      (source) =>
        `(${alias}.kind='organizer' AND ${alias}.id LIKE '${source.sourceIdPrefix}%' AND (${source.allowedHosts.map((host) => `${alias}.url LIKE 'https://${host}/%'`).join(" OR ")}))`,
    )
    .join(" OR ");
};
const LKG_PRIMARY_SOURCE = `(s.kind='municipality' OR (${privateLkgClause("s")}))`;
function visibility(env: Env) {
  // No sample records can escape to production, even if its DB was accidentally seeded.
  return env.APP_MODE === "sample"
    ? "e.is_sample=1 AND e.verification='sample'"
    : `e.is_sample=0 AND e.verification='verified' AND e.publish_quality_state='PUBLIC' AND s.kind!='sample' AND s.url LIKE 'https://%'
      AND (${LKG_PRIMARY_SOURCE} OR (e.checked_at >= ? AND e.checked_at <= ?))
      AND NOT EXISTS (SELECT 1 FROM (SELECT 'schedule' AS field UNION ALL SELECT 'venue' UNION ALL SELECT 'status') required
        WHERE NOT EXISTS (SELECT 1 FROM event_evidence ev JOIN sources es ON es.id=ev.source_id
          WHERE ev.event_id=e.id AND ev.field=required.field AND es.kind!='sample' AND es.url LIKE 'https://%'
            AND (${LKG_PRIMARY_SOURCE} OR (ev.checked_at >= ? AND ev.checked_at <= ?))))
      AND (e.cost='unknown' OR EXISTS (SELECT 1 FROM event_evidence ev JOIN sources es ON es.id=ev.source_id WHERE ev.event_id=e.id AND ev.field='price' AND es.kind!='sample' AND es.url LIKE 'https://%' AND (${LKG_PRIMARY_SOURCE} OR (ev.checked_at >= ? AND ev.checked_at <= ?))))
      AND NOT EXISTS (SELECT 1 FROM event_tags t WHERE t.event_id=e.id AND t.classifier_type='legacy' AND NOT EXISTS
        (SELECT 1 FROM event_evidence ev JOIN sources es ON es.id=ev.source_id WHERE ev.event_id=e.id AND ev.field=t.tag AND es.kind!='sample' AND es.url LIKE 'https://%' AND (${LKG_PRIMARY_SOURCE} OR (ev.checked_at >= ? AND ev.checked_at <= ?))))
      AND (e.pet_policy='unknown' OR EXISTS (SELECT 1 FROM event_evidence ev JOIN sources es ON es.id=ev.source_id WHERE ev.event_id=e.id AND ev.field='pet_policy' AND es.kind!='sample' AND es.url LIKE 'https://%' AND (${LKG_PRIMARY_SOURCE} OR (ev.checked_at >= ? AND ev.checked_at <= ?))))
      AND (e.lat IS NULL OR EXISTS (SELECT 1 FROM event_evidence ev JOIN sources es ON es.id=ev.source_id WHERE ev.event_id=e.id AND ev.field='coordinates' AND es.kind!='sample' AND es.url LIKE 'https://%' AND (${LKG_PRIMARY_SOURCE} OR (ev.checked_at >= ? AND ev.checked_at <= ?))))`;
}
function visibilityBindings(env: Env) {
  if (env.APP_MODE === "sample") return [];
  const now = new Date().toISOString(),
    cutoff = new Date(Date.now() - 72 * 3600_000).toISOString();
  return Array.from({ length: 6 }, () => [cutoff, now]).flat();
}
async function availableDateRange(env: Env) {
  const cached = availableRangeCache.get(env.DB);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const row = await env.DB.prepare(
    `SELECT MIN(e.start_date) AS start_date, MAX(e.end_date) AS end_date
     FROM events e LEFT JOIN sources s ON s.id=e.primary_source_id
     WHERE ${visibility(env)}`,
  )
    .bind(...visibilityBindings(env))
    .first<{ start_date: string | null; end_date: string | null }>();
  const value =
    row?.start_date && row.end_date
      ? { start: row.start_date, end: row.end_date }
      : null;
  availableRangeCache.set(env.DB, {
    value,
    expiresAt: Date.now() + AVAILABLE_RANGE_TTL_MS,
  });
  return value;
}
function serialize(
  row: Record<string, unknown>,
  lat: number | null = null,
  lng: number | null = null,
  selectedRange: DateRange | null = null,
): EventItem {
  const jsonArray = (value: unknown): string[] => {
    if (typeof value !== "string") return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  };
  const operatingHours: EventOperatingHours[] =
    typeof row.operating_hours_json === "string"
      ? (() => {
          try {
            const parsed = JSON.parse(row.operating_hours_json) as unknown[];
            return parsed
              .filter((item): item is Record<string, unknown> =>
                Boolean(item && typeof item === "object"),
              )
              .map((item) => ({
                start_date: String(item.start_date),
                end_date: String(item.end_date),
                start_time: item.start_time as string | null,
                end_time: item.end_time as string | null,
                human_time_text: item.human_time_text as string | null,
              }))
              .filter(
                (item) =>
                  validOperatingTime(item.start_time) &&
                  validOperatingTime(item.end_time),
              );
          } catch {
            return [];
          }
        })()
      : [];
  return {
    id: String(row.id),
    title: String(row.title),
    description: String(row.description),
    region: String(row.region),
    venue: String(row.venue),
    address: String(row.address),
    start_date: String(row.start_date),
    end_date: String(row.end_date),
    lat: row.lat as number | null,
    lng: row.lng as number | null,
    cost: row.cost as EventItem["cost"],
    price_text: row.price_text as string | null,
    pet_policy: row.pet_policy as EventItem["pet_policy"],
    status: row.status as EventItem["status"],
    verification: row.verification as EventItem["verification"],
    is_sample: Number(row.is_sample),
    checked_at: row.checked_at as string | null,
    source_url: row.source_url as string | null,
    source_name: row.source_name as string | null,
    source_kind: row.source_kind as string | null,
    official_url: row.official_url as string | null,
    trust_status:
      row.trust_status === "confirmed" ||
      row.trust_status === "needs_review" ||
      row.trust_status === "changed"
        ? row.trust_status
        : null,
    trust_checked_at: row.trust_checked_at as string | null,
    trust_source_url:
      (row.trust_source_final_url as string | null) ??
      (row.trust_source_url as string | null) ??
      null,
    trust_source_types: jsonArray(row.trust_source_types),
    trust_changed_fields: jsonArray(row.trust_changed_fields),
    image_url: row.image_url as string | null,
    image_source_type: row.image_source_type as string | null,
    image_source_page_url: row.image_source_page_url as string | null,
    image_status:
      row.image_status === "ok" ||
      row.image_status === "missing" ||
      row.image_status === "blocked" ||
      row.image_status === "invalid"
        ? row.image_status
        : null,
    tags: String(row.tag_list ?? "")
      .split(",")
      .filter(Boolean) as EventItem["tags"],
    distance_km:
      lat !== null && lng !== null && row.lat !== null && row.lng !== null
        ? distanceKm(lat, lng, Number(row.lat), Number(row.lng))
        : null,
    operating_hours: selectedRange
      ? selectOperatingHours(operatingHours, selectedRange)
      : null,
  };
}

function parseOperatingHours(value: unknown): EventOperatingHours[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown[];
    return parsed
      .filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object"),
      )
      .map((item) => ({
        start_date: String(item.start_date),
        end_date: String(item.end_date),
        start_time: item.start_time as string | null,
        end_time: item.end_time as string | null,
        human_time_text: item.human_time_text as string | null,
      }))
      .filter(
        (item) =>
          validOperatingTime(item.start_time) &&
          validOperatingTime(item.end_time),
      );
  } catch {
    return [];
  }
}
function detailImageProxyUrl(
  requestUrl: URL,
  eventId: string,
  sortOrder: number,
) {
  return new URL(
    `/api/events/${encodeURIComponent(eventId)}/image/${sortOrder}`,
    requestUrl.origin,
  ).toString();
}

function withMunicipalImageProxy(requestUrl: URL, event: EventItem) {
  if (
    event.image_url &&
    event.image_status === "ok" &&
    event.image_source_type === "municipality"
  )
    return {
      ...event,
      image_url: detailImageProxyUrl(requestUrl, event.id, 1),
    };
  return event;
}

function viewerImageContentType(url: URL, contentType: string) {
  if (contentType.toLowerCase().startsWith("image/")) return contentType;
  if (!/\/imgViewer\.jsp$/i.test(url.pathname)) return null;
  const extension = url.searchParams.get("ext")?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  return null;
}

function municipalContactPhone(rawPayload: string | null | undefined) {
  if (!rawPayload) return null;
  try {
    const payload = JSON.parse(rawPayload) as {
      tel?: unknown;
      common?: { tel?: unknown };
      intro?: { sponsor1tel?: unknown };
      municipal_rich_detail?: { contact_phone?: unknown };
    };
    return normalizeOfficialPhone(
      payload.municipal_rich_detail?.contact_phone ??
        payload.common?.tel ??
        payload.intro?.sponsor1tel ??
        payload.tel,
    );
  } catch {
    return null;
  }
}

function visibleMunicipalSummary(value: string, sourceKind: string) {
  if (
    sourceKind === "municipality" &&
    /(?:열린\s*민원|시정\s*소식|각\s*분야별\s*정보)/u.test(value)
  )
    return null;
  return value;
}

async function proxyEventImage(
  request: Request,
  env: Env,
  eventId: string,
  sortOrder: number,
) {
  const image =
    sortOrder === 1
      ? await env.DB.prepare(
          `SELECT image_url,source_page_url
           FROM event_images
           WHERE event_id=? AND is_primary=1 AND image_status='ok'
             AND source_type='municipality'
           LIMIT 1`,
        )
          .bind(eventId)
          .first<{ image_url: string; source_page_url: string | null }>()
      : await env.DB.prepare(
          `SELECT image_url,source_page_url
           FROM event_additional_images
           WHERE event_id=? AND sort_order=? AND image_status='ok'
             AND source_type='municipality'
           LIMIT 1`,
        )
          .bind(eventId, sortOrder)
          .first<{ image_url: string; source_page_url: string | null }>();
  if (!image?.image_url) return new Response("Not found", { status: 404 });

  let remote: URL;
  try {
    remote = new URL(image.image_url);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  // Reject old stored chrome before consulting the image cache as well.
  if (looksDecorative(remote.href)) return new Response("Not found", { status: 404 });
  if (
    remote.protocol !== "https:" ||
    remote.username ||
    remote.password ||
    remote.hostname === "localhost" ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(remote.hostname) ||
    remote.hostname.startsWith("[")
  )
    return new Response("Not found", { status: 404 });

  const cacheKey = new Request(request.url, { method: "GET" });
  const imageCache = (globalThis.caches as CacheStorage & { default?: Cache })
    ?.default;
  const cachedImage = async () => {
    if (!imageCache) return null;
    try {
      const cached = await imageCache.match(cacheKey);
      if (
        cached?.status === 200 &&
        (cached.headers.get("Content-Type") ?? "")
          .toLowerCase()
          .startsWith("image/")
      )
        return cached;
    } catch {}
    return null;
  };
  const cached = await cachedImage();
  if (cached) return cached;

  const headers = new Headers({
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
    Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.5",
    "Cache-Control": "no-cache",
  });
  if (image.source_page_url) {
    try {
      const sourcePage = new URL(image.source_page_url);
      if (sourcePage.protocol === "https:")
        headers.set("Referer", sourcePage.toString());
    } catch {}
  }

  let lastFailure: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let upstream: Response;
    try {
      upstream = await fetch(remote.toString(), {
        redirect: "follow",
        headers,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      lastFailure = new Response("Image upstream unavailable", { status: 503 });
      if (attempt < 2) continue;
      break;
    }

    if (!upstream.ok || !upstream.body) {
      const transient =
        !upstream.body ||
        upstream.status === 408 ||
        upstream.status === 429 ||
        upstream.status >= 500;
      lastFailure = new Response("Image upstream unavailable", {
        status: transient ? 503 : 502,
      });
      if (transient && attempt < 2) continue;
      break;
    }

    const contentType = viewerImageContentType(
      remote,
      upstream.headers.get("Content-Type") ?? "",
    );
    if (!contentType)
      return new Response("Invalid image response", { status: 502 });

    const contentLength = Number(upstream.headers.get("Content-Length") ?? 0);
    if (contentLength > 8 * 1024 * 1024)
      return new Response("Image too large", { status: 413 });

    const responseHeaders = new Headers({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "X-Content-Type-Options": "nosniff",
    });
    const etag = upstream.headers.get("ETag");
    if (etag) responseHeaders.set("ETag", etag);
    let imageBytes: ArrayBuffer;
    try {
      imageBytes = await upstream.arrayBuffer();
    } catch {
      lastFailure = new Response("Image upstream unavailable", { status: 503 });
      if (attempt < 2) continue;
      break;
    }
    if (imageBytes.byteLength > 8 * 1024 * 1024)
      return new Response("Image too large", { status: 413 });
    const response = new Response(imageBytes, {
      status: 200,
      headers: responseHeaders,
    });
    if (imageCache) {
      try {
        await imageCache.put(cacheKey, response.clone());
      } catch {}
    }
    return response;
  }

  return (await cachedImage()) ??
    lastFailure ??
    new Response("Image upstream unavailable", { status: 503 });
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    },
  });
}

async function seoEvent(env: Env, eventId: string): Promise<SeoEvent | null> {
  const row = await env.DB.prepare(
    `SELECT e.id,e.title,e.venue,e.address,e.start_date,e.end_date,e.status,e.cost,
      e.updated_at,e.checked_at,ei.image_url,ei.image_status
     FROM events e
     LEFT JOIN sources s ON s.id=e.primary_source_id
     LEFT JOIN event_images ei ON ei.event_id=e.id AND ei.is_primary=1
     WHERE e.id=? AND ${visibility(env)}`,
  )
    .bind(eventId, ...visibilityBindings(env))
    .first<SeoEvent>();
  return row ?? null;
}

async function seoHtml(
  request: Request,
  env: Env,
  event: SeoEvent | null,
  landing = seoLandingForPath(new URL(request.url).pathname),
) {
  const shellRequest = new Request(new URL("/", request.url), request);
  const asset = await env.ASSETS.fetch(shellRequest);
  const contentType = asset.headers.get("Content-Type") ?? "";
  if (!contentType.includes("text/html")) return asset;
  const headers = new Headers(asset.headers);
  headers.set("Content-Type", "text/html; charset=UTF-8");
  headers.set("Cache-Control", "public, max-age=300");
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  headers.delete("ETag");
  return new Response(renderSeoHtml(await asset.text(), event, landing), {
    status: asset.status,
    statusText: asset.statusText,
    headers,
  });
}

function textResponse(body: string, contentType: string, cacheControl: string) {
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function publicSitemap(env: Env) {
  // The public discoverability contract is exactly the same as the UI visibility query.
  // Ended events are intentionally omitted from this current/future discovery sitemap.
  const today = koreaDate();
  const rows = await env.DB.prepare(
    `SELECT e.id,e.title,e.venue,e.address,e.start_date,e.end_date,e.status,e.cost,
      e.updated_at,e.checked_at,NULL AS image_url,NULL AS image_status
     FROM events e LEFT JOIN sources s ON s.id=e.primary_source_id
     WHERE ${visibility(env)} AND e.end_date>=?
     ORDER BY e.start_date,e.id LIMIT 50000`,
  )
    .bind(...visibilityBindings(env), today)
    .all<SeoEvent>();
  return sitemapXml(rows.results);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const legacyRedirect = legacyHostRedirect(url);
    if (legacyRedirect) return legacyRedirect;
    if (url.pathname === "/robots.txt")
      return textResponse(robotsTxt, "text/plain; charset=UTF-8", "public, max-age=86400");
    if (url.pathname === "/sitemap.xml")
      return textResponse(await publicSitemap(env), "application/xml; charset=UTF-8", "public, max-age=3600");
    const seoLanding = seoLandingForPath(url.pathname);
    if (seoLanding) return seoHtml(request, env, null, seoLanding);
    const eventPage = /^\/events\/([^/]+)$/.exec(url.pathname);
    if (eventPage) {
      const eventId = decodeSeoEventId(eventPage[1]);
      if (!eventId)
        return new Response("행사를 찾을 수 없습니다.", {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=UTF-8", "Cache-Control": "no-store" },
        });
      const event = await seoEvent(env, eventId);
      if (!event)
        return new Response("행사를 찾을 수 없습니다.", {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=UTF-8", "Cache-Control": "no-store" },
        });
      return seoHtml(request, env, event);
    }
    if (url.pathname.startsWith("/events/"))
      return new Response("행사를 찾을 수 없습니다.", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=UTF-8", "Cache-Control": "no-store" },
      });
    if (!url.pathname.startsWith("/api/"))
      return url.pathname === "/" ? seoHtml(request, env, null) : env.ASSETS.fetch(request);
    const isNearby = url.pathname === "/api/events/nearby";
    const isPushWrite =
      ["/api/push/subscribe", "/api/push/unsubscribe"].includes(url.pathname) &&
      request.method === "POST";
    if (
      request.method !== "GET" &&
      !(isNearby && request.method === "POST") &&
      !isPushWrite
    )
      return json({ error: "읽기 전용 API입니다." }, 405);
    try {
      if (url.pathname === "/api/health") {
        await env.DB.prepare("SELECT 1 FROM events LIMIT 1").all();
        return json({
          ok: true,
          database: "connected",
          mode: env.APP_MODE,
          timezone: "Asia/Seoul",
          ingestion:
            env.TOUR_API_ENABLED === "true"
              ? env.TOUR_API_KEY
                ? "enabled"
                : "secret_missing"
              : "disabled",
          push: pushStatus(env),
        });
      }
      if (url.pathname === "/api/push/config") {
        const status = pushStatus(env);
        return json({
          enabled: status === "enabled",
          vapidPublicKey:
            status === "enabled" ? env.WEB_PUSH_VAPID_PUBLIC_KEY : null,
        });
      }
      if (url.pathname === "/api/analytics/config") {
        const analytics = analyticsRuntimeConfig(env);
        return json(analytics);
      }
      if (url.pathname === "/api/push/subscribe") {
        if (!isSameOrigin(request))
          return json({ error: "허용되지 않은 요청입니다." }, 403);
        const parsed = parseSubscriptionRequest(await readPushBody(request));
        if (!parsed)
          return json(
            { error: "알림 조건 또는 구독 정보가 올바르지 않습니다." },
            400,
          );
        await upsertSubscription(env, parsed);
        return json({ ok: true });
      }
      if (url.pathname === "/api/push/unsubscribe") {
        if (!isSameOrigin(request))
          return json({ error: "허용되지 않은 요청입니다." }, 403);
        const body = await readPushBody(request);
        const endpoint =
          body && typeof body === "object"
            ? (body as { endpoint?: unknown }).endpoint
            : null;
        if (!validPushEndpoint(endpoint))
          return json({ error: "구독 정보가 올바르지 않습니다." }, 400);
        await disableSubscription(env, endpoint);
        return json({ ok: true });
      }
      const imageRoute =
        /^\/api\/events\/([^/]+)\/image\/([1-5])$/.exec(url.pathname);
      if (imageRoute) {
        const imageEventId = decodeSeoEventId(imageRoute[1]);
        if (!imageEventId)
          return new Response("Not found", { status: 404 });
        return proxyEventImage(
          request,
          env,
          imageEventId,
          Number(imageRoute[2]),
        );
      }
      if (url.pathname === "/api/meta")
        return json({
          regions: REGIONS,
          audiences: AUDIENCES,
          themes: THEMES,
          mode: env.APP_MODE,
          today: koreaDate(),
          available_date_range: await availableDateRange(env),
        });
      if (isNearby) {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          throw new InputError("위치 요청 형식이 올바르지 않습니다.");
        }
        const f = parseNearbyFilters(body);
        if (f.lat === null || f.lng === null)
          throw new InputError("위치 좌표가 필요합니다.");
        const range = f.customRange ?? dateRange(f.period);
        const availableRange = await availableDateRange(env);
        const rangeOutsideAvailable = Boolean(
          f.customRange &&
          availableRange &&
          (range.end < availableRange.start ||
            range.start > availableRange.end),
        );
        const where = [
          visibility(env),
          "(e.status='scheduled' OR (s.kind='tourapi' AND e.status='unknown'))",
          "e.start_date<=?",
          "e.end_date>=?",
          "e.lat IS NOT NULL AND e.lng IS NOT NULL",
        ];
        const binds: (string | number)[] = [
          ...visibilityBindings(env),
          range.end,
          range.start,
        ];
        for (const key of ["cost"] as const)
          if (f[key]) {
            where.push(`e.${key}=?`);
            binds.push(f[key]);
          }
        if (f.audience) {
          const companion =
            audienceCompanionFilter[
              f.audience as keyof typeof audienceCompanionFilter
            ];
          where.push(
            `e.id IN (SELECT cs.event_id FROM event_companion_suitability cs WHERE cs.companion_type=? AND cs.suitability_state=? AND cs.classifier_type='${COMPANION_CLASSIFIER}' AND cs.rule_version='${COMPANION_RULE_VERSION}')`,
          );
          binds.push(companion.companion_type, companion.suitability_state);
        }
        if (f.theme) {
          const contentTag =
            USER_CONTENT_FILTER_BY_QUERY[f.theme]?.factTags[0] ?? f.theme;
          where.push(
            `e.id IN (SELECT t.event_id FROM event_tags t WHERE t.classifier_type='${FACT_CLASSIFIER}' AND t.rule_version='${FACT_RULE_VERSION}' AND t.tag=?)`,
          );
          binds.push(contentTag);
        }
        if (f.q) {
          where.push(
            "(e.title LIKE ? ESCAPE '\\' OR e.venue LIKE ? ESCAPE '\\' OR e.address LIKE ? ESCAPE '\\')",
          );
          const escaped = f.q.replace(/[\\%_]/g, "\\$&");
          binds.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
        }
        const latitudeRadius = 200 / 111.32;
        const longitudeRadius = Math.min(
          180,
          200 / Math.max(111.32 * Math.cos((f.lat * Math.PI) / 180), 0.01),
        );
        where.push("e.lat BETWEEN ? AND ?", "e.lng BETWEEN ? AND ?");
        binds.push(
          f.lat - latitudeRadius,
          f.lat + latitudeRadius,
          f.lng - longitudeRadius,
          f.lng + longitudeRadius,
        );
        const CANDIDATE_LIMIT = 500;
        const { results } = await env.DB.prepare(
          `${SELECT} WHERE ${where.join(" AND ")} ORDER BY e.start_date,e.end_date,e.id LIMIT ?`,
        )
          .bind(...binds, CANDIDATE_LIMIT + 1)
          .all();
        const candidateLimited = results.length > CANDIDATE_LIMIT;
        const events = results
          .slice(0, CANDIDATE_LIMIT)
          .map((row) => withMunicipalImageProxy(url, serialize(row, f.lat, f.lng, range)))
          .filter(
            (event) => event.distance_km !== null && event.distance_km <= 200,
          )
          .sort(
            (a, b) =>
              (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity) ||
              a.start_date.localeCompare(b.start_date) ||
              a.end_date.localeCompare(b.end_date) ||
              a.id.localeCompare(b.id),
          );
        return json({
          events: events.slice((f.page - 1) * f.limit, f.page * f.limit),
          total: events.length,
          page: f.page,
          limit: f.limit,
          range,
          available_date_range: availableRange,
          range_outside_available: rangeOutsideAvailable,
          nearby_candidate_limited: candidateLimited,
          mode: env.APP_MODE,
        });
      }
      if (url.pathname === "/api/events") {
        const f = parseFilters(url.searchParams),
          includeTotal = url.searchParams.get("includeTotal") !== "0",
          range = f.customRange ?? dateRange(f.period),
          availableRange = await availableDateRange(env),
          rangeOutsideAvailable = Boolean(
            f.customRange &&
            availableRange &&
            (range.end < availableRange.start ||
              range.start > availableRange.end),
          );
        const where = [
          visibility(env),
          "(e.status='scheduled' OR (s.kind='tourapi' AND e.status='unknown'))",
          "e.start_date<=?",
          "e.end_date>=?",
        ];
        const binds: (string | number)[] = [
          ...visibilityBindings(env),
          range.end,
          range.start,
        ];
        for (const key of ["region", "cost"] as const)
          if (f[key]) {
            where.push(`e.${key}=?`);
            binds.push(f[key]);
          }
        if (f.audience) {
          const companion =
            audienceCompanionFilter[
              f.audience as keyof typeof audienceCompanionFilter
            ];
          where.push(
            `e.id IN (SELECT cs.event_id FROM event_companion_suitability cs WHERE cs.companion_type=? AND cs.suitability_state=? AND cs.classifier_type='${COMPANION_CLASSIFIER}' AND cs.rule_version='${COMPANION_RULE_VERSION}')`,
          );
          binds.push(companion.companion_type, companion.suitability_state);
        }
        if (f.theme) {
          const contentTag =
            USER_CONTENT_FILTER_BY_QUERY[f.theme]?.factTags[0] ?? f.theme;
          where.push(
            `e.id IN (SELECT t.event_id FROM event_tags t WHERE t.classifier_type='${FACT_CLASSIFIER}' AND t.rule_version='${FACT_RULE_VERSION}' AND t.tag=?)`,
          );
          binds.push(contentTag);
        }
        if (f.q) {
          where.push(
            "(e.title LIKE ? ESCAPE '\\' OR e.venue LIKE ? ESCAPE '\\' OR e.address LIKE ? ESCAPE '\\')",
          );
          const escaped = f.q.replace(/[\\%_]/g, "\\$&");
          binds.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
        }
        const whereSql = where.join(" AND ");
        if (f.sort === "distance") {
          // Distance ordering needs the request coordinates for every matching event.
          // Keep this exceptional path explicit; the default date path stays page-bounded.
          const { results } = await env.DB.prepare(
            `${SELECT} WHERE ${whereSql} ORDER BY e.start_date,e.id`,
          )
            .bind(...binds)
            .all();
          const events = results.map((row) =>
            withMunicipalImageProxy(url, serialize(row, f.lat, f.lng, range)),
          );
          events.sort(
            (a, b) =>
              (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity) ||
              a.start_date.localeCompare(b.start_date) ||
              a.id.localeCompare(b.id),
          );
          return json({
            events: events.slice((f.page - 1) * f.limit, f.page * f.limit),
            total: events.length,
            page: f.page,
            limit: f.limit,
            range,
            available_date_range: availableRange,
            range_outside_available: rangeOutsideAvailable,
            mode: env.APP_MODE,
          });
        }
        const recommendedOrder = `CASE
          WHEN e.start_date>=? AND e.end_date<=? THEN 0
          WHEN e.start_date>=? AND e.start_date<=? THEN 1
          WHEN e.end_date>=? AND e.end_date<=? THEN 2
          ELSE 3 END,
          CASE WHEN e.start_date=e.end_date THEN 0 ELSE 1 END,
          julianday(e.end_date)-julianday(e.start_date),e.start_date,e.end_date,e.id`;
        const orderBy =
          f.sort === "recommended" ? recommendedOrder : "e.start_date,e.id";
        const rankingBinds =
          f.sort === "recommended"
            ? [
                range.start,
                range.end,
                range.start,
                range.end,
                range.start,
                range.end,
              ]
            : [];
        const page = await env.DB.prepare(
          `${SELECT} WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
        )
          .bind(...binds, ...rankingBinds, f.limit, (f.page - 1) * f.limit)
          .all();
        const count = includeTotal
          ? await env.DB.prepare(
              `SELECT count(*) AS total FROM events e LEFT JOIN sources s ON s.id=e.primary_source_id WHERE ${whereSql}`,
            )
              .bind(...binds)
              .first<{ total: number }>()
          : null;
        return json({
          events: page.results.map((row) =>
            withMunicipalImageProxy(url, serialize(row, f.lat, f.lng, range)),
          ),
          ...(includeTotal ? { total: Number(count?.total ?? 0) } : {}),
          sort: f.sort,
          page: f.page,
          limit: f.limit,
          range,
          available_date_range: availableRange,
          range_outside_available: rangeOutsideAvailable,
          mode: env.APP_MODE,
        });
      }
      const detail = /^\/api\/events\/([^/]+)$/.exec(url.pathname);
      if (detail) {
        const eventId = decodeSeoEventId(detail[1]);
        if (!eventId)
          return json({ error: "확인된 행사 정보를 찾을 수 없습니다." }, 404);
        const row = await env.DB.prepare(
          `${SELECT} WHERE e.id=? AND ${visibility(env)}`,
        )
          .bind(eventId, ...visibilityBindings(env))
          .first<Record<string, unknown>>();
        if (!row)
          return json({ error: "확인된 행사 정보를 찾을 수 없습니다." }, 404);
        const additionalImages = await env.DB.prepare(
          `SELECT image_url,source_type,source_page_url,sort_order
           FROM event_additional_images
           WHERE event_id=? AND image_status='ok' AND image_url LIKE 'https://%'
           ORDER BY sort_order ASC LIMIT 5`,
        )
          .bind(eventId)
          .all<{
            image_url: string;
            source_type: string | null;
            source_page_url: string | null;
            sort_order: number;
          }>();
        const images = [
          ...(row.image_url && row.image_status === "ok" && String(row.image_url).startsWith("https://")
            ? [{ image_url: String(row.image_url), source_type: row.image_source_type as string | null, source_page_url: row.image_source_page_url as string | null, is_primary: true, sort_order: 1 }]
            : []),
          ...additionalImages.results.map((image) => ({ ...image, is_primary: false })),
        ].filter((image) => !looksDecorative(image.image_url)).filter((image, index, items) =>
          items.findIndex((candidate) => candidate.image_url === image.image_url) === index,
        ).slice(0, 5).map((image) => ({
          ...image,
          image_url:
            image.source_type === "municipality"
              ? detailImageProxyUrl(url, eventId, Number(image.sort_order))
              : image.image_url,
        }));
        const evidence = await env.DB.prepare(
          `SELECT ev.field,ev.excerpt,ev.checked_at,s.name,s.url,s.kind,s.priority
          FROM event_evidence ev JOIN sources s ON s.id=ev.source_id WHERE ev.event_id=? ORDER BY s.priority,ev.field`,
        )
          .bind(eventId)
          .all<Record<string, unknown>>();
        const storedOfficialUrl = await env.DB.prepare(
          `SELECT ol.url
           FROM event_official_links ol
           JOIN sources s ON s.id=ol.source_id
           WHERE ol.event_id=?
             AND ol.url LIKE 'https://%'
           ORDER BY s.priority,ol.checked_at DESC
           LIMIT 1`,
        )
          .bind(eventId)
          .first<{ url: string | null }>();
        const auditedOfficialUrl = storedOfficialUrl?.url
          ? null
          : await env.DB.prepare(
              `SELECT CASE
                 WHEN l.final_url LIKE 'https://%' THEN l.final_url
                 WHEN l.url LIKE 'https://%' THEN l.url
                 ELSE NULL
               END AS url
               FROM official_source_audits a
               JOIN official_source_links l ON l.audit_id=a.id
               WHERE a.event_id=?
                 AND l.official=1
                 AND l.access_status='ok'
                 AND (l.final_url LIKE 'https://%' OR l.url LIKE 'https://%')
               ORDER BY a.checked_at DESC,l.checked_at DESC
               LIMIT 1`,
            )
              .bind(eventId)
              .first<{ url: string | null }>();
        row.official_url = storedOfficialUrl?.url ?? auditedOfficialUrl?.url ?? null;
        const contactSources = await env.DB.prepare(
          `SELECT raw_payload
           FROM sources
           WHERE id IN (?,?,?)
           ORDER BY CASE
             WHEN id=? THEN 0
             WHEN id=? THEN 1
             ELSE 2
           END`,
        )
          .bind(
            `official-detail-${row.id}`,
            `${row.id}-detail`,
            row.primary_source_id,
            `official-detail-${row.id}`,
            `${row.id}-detail`,
          )
          .all<{ raw_payload: string | null }>();
        const contactPhone =
          contactSources.results
            .map((source) => municipalContactPhone(source.raw_payload))
            .find((value) => value !== null) ?? null;
        const enrichment = await env.DB.prepare(
          `SELECT en.summary,s.url AS source_url,s.kind AS source_kind,s.priority AS source_priority FROM event_enrichments en JOIN sources s ON s.id=en.source_id WHERE en.event_id=?`,
        )
          .bind(eventId)
          .first<{
            summary: string;
            source_url: string;
            source_kind: string;
            source_priority: number;
          }>();
        const highlights = await env.DB.prepare(
          `SELECT label,tag,featured,source_id FROM event_highlights WHERE event_id=? ORDER BY featured DESC,sort_order`,
        )
          .bind(eventId)
          .all<{ label: string; tag: string | null; featured: number; source_id: string }>();
        const programs = await env.DB.prepare(
          `SELECT p.id,p.source_id,p.program_name,p.program_date,p.start_time,p.end_time,p.schedule_text,p.venue_name,p.description,p.featured,(SELECT json_group_array(tag) FROM event_program_tags WHERE program_id=p.id) AS tags FROM event_programs p WHERE p.event_id=? ORDER BY p.featured DESC,p.program_date,p.start_time,p.sort_order`,
        )
          .bind(eventId)
          .all<Record<string, unknown>>();
        const occurrenceRows = await env.DB.prepare(
          `SELECT o.program_id,o.start_date,o.end_date,o.start_time,o.end_time,o.human_time_text,o.venue_name FROM event_program_occurrences o JOIN event_programs p ON p.id=o.program_id WHERE p.event_id=? ORDER BY o.start_date,o.start_time,o.sort_order`,
        )
          .bind(eventId)
          .all<Record<string, unknown>>();
        const occurrencesByProgram = new Map<string, unknown[]>();
        for (const occurrence of occurrenceRows.results)
          occurrencesByProgram.set(String(occurrence.program_id), [
            ...(occurrencesByProgram.get(String(occurrence.program_id)) ?? []),
            occurrence,
          ]);
        const visiblePrograms = programs.results.filter((program) =>
          !municipalEventTimeOnlyLabel(String(program.program_name)),
        );
        const programRows = visiblePrograms.map((program) => ({
          name: String(program.program_name),
          date: program.program_date as string | null,
          start_time: program.start_time as string | null,
          end_time: program.end_time as string | null,
          schedule_text: program.schedule_text as string | null,
          venue: program.venue_name as string | null,
          description: program.description as string | null,
          featured: Number(program.featured) === 1,
          tags:
            typeof program.tags === "string"
              ? (JSON.parse(program.tags) as unknown[]).filter(
                  (tag): tag is string => typeof tag === "string",
                )
              : [],
          occurrences: (occurrencesByProgram.get(String(program.id)) ?? [])
            .filter((occurrence) => {
              const row = occurrence as Record<string, unknown>;
              return (
                validProgramTime(row.start_time as string | null) &&
                validProgramTime(row.end_time as string | null)
              );
            })
            .map((occurrence) => {
              const row = occurrence as Record<string, unknown>;
              return {
                start_date: String(row.start_date),
                end_date: String(row.end_date),
                start_time: row.start_time as string | null,
                end_time: row.end_time as string | null,
                human_time_text: row.human_time_text as string | null,
                venue: row.venue_name as string | null,
              };
            }),
        }));
        const visibleSummary = enrichment
          ? visibleMunicipalSummary(enrichment.summary, enrichment.source_kind)
          : null;
        const hasVisibleDetail = Boolean(
          visibleSummary || highlights.results.length || programRows.length,
        );
        const detailSourceIds = [
          ...visiblePrograms.map((program) => String(program.source_id)),
          ...highlights.results.map((item) => String(item.source_id)),
        ];
        const fallbackSource = !enrichment && hasVisibleDetail && detailSourceIds.length
          ? await env.DB.prepare(
              `SELECT s.url AS source_url,s.kind AS source_kind,s.priority AS source_priority
               FROM sources s
               WHERE s.id IN (${detailSourceIds.map(() => "?").join(",")})
                 AND s.kind!='sample'
                 AND s.url LIKE 'https://%'
               ORDER BY s.priority ASC,s.id ASC
               LIMIT 1`,
            )
              .bind(...detailSourceIds)
              .first<{
                source_url: string;
                source_kind: string;
                source_priority: number;
              }>()
          : null;
        const enrichmentSource = enrichment ?? fallbackSource;
        return json({
          event: withMunicipalImageProxy(url, serialize(row)),
          images,
          evidence: evidence.results,
          contact_phone: contactPhone,
          operating_hours: parseOperatingHours(row.operating_hours_json),
          enrichment: enrichmentSource && hasVisibleDetail
            ? {
                summary: visibleSummary ?? "",
                source_url: enrichmentSource.source_url,
                source_kind: enrichmentSource.source_kind,
                source_priority: enrichmentSource.source_priority,
                highlights: highlights.results.map((item) => ({
                  label: item.label,
                  tag: item.tag,
                  featured: Number(item.featured) === 1,
                })),
                programs: programRows,
              }
            : null,
          mode: env.APP_MODE,
        });
      }
      return json({ error: "API를 찾을 수 없습니다." }, 404);
    } catch (error) {
      if (error instanceof InputError)
        return json({ error: error.message }, 400);
      const requestId = crypto.randomUUID();
      console.error("api_failed", {
        requestId,
        path: url.pathname,
        error: error instanceof Error ? error.name : "unknown",
      });
      return json(
        {
          error: "정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
          requestId,
        },
        503,
      );
    }
  },
  async scheduled(controller: ScheduledController, env: Env) {
    await runScheduled(env, controller.cron);
  },
} satisfies ExportedHandler<Env>;
