import {
  validCloudflareWebAnalyticsToken,
  validGa4MeasurementId,
  type AnalyticsRuntimeConfig,
} from "../shared/analytics-config";
import { AUDIENCES, REGIONS, THEMES } from "../shared/domain";

type EventName =
  | "event_detail_view"
  | "filter_apply"
  | "search_submit"
  | "official_link_click"
  | "nearby_use"
  | "push_subscribe"
  | "push_unsubscribe"
  | "load_more";
type FilterType = "period" | "region" | "audience" | "theme" | "sort";
type Gtag = (...args: unknown[]) => void;

let initialization: Promise<AnalyticsRuntimeConfig> | null = null;
let config: AnalyticsRuntimeConfig = {
  enabled: false,
  ga4: { enabled: false, measurementId: null },
  cloudflare: { enabled: false, token: null },
};
let lastPageView = "";
let activeDetail = "";

const loadScript = (src: string, attributes: Record<string, string> = {}) =>
  new Promise<void>((resolve) => {
    if (
      [...document.querySelectorAll("script[data-wtw-analytics]")].some(
        (script) => script.getAttribute("data-wtw-analytics") === src,
      )
    )
      return resolve();
    const script = document.createElement("script");
    script.async = true;
    script.src = src;
    script.dataset.wtwAnalytics = src;
    for (const [key, value] of Object.entries(attributes))
      script.setAttribute(key, value);
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });

const safeId = (value: string) =>
  /^[A-Za-z0-9_-]{1,120}$/.test(value) ? value : undefined;
const allowedFilterValues: Record<string, readonly string[]> = {
  period: ["today", "weekend", "next-weekend", "custom"],
  region: REGIONS,
  audience: Object.keys(AUDIENCES),
  theme: Object.keys(THEMES),
  sort: ["recommended", "date", "distance"],
};
export function buildAnalyticsPath(
  input: string | URL = typeof window === "undefined" ? "/" : window.location.href,
) {
  try {
    const url = new URL(input.toString(), "https://weekend-mwohae.invalid");
    const allowed = new URLSearchParams();
    for (const [key, values] of Object.entries(allowedFilterValues)) {
      const value = url.searchParams.get(key);
      if (value && values.includes(value)) allowed.set(key, value);
    }
    const eventId = url.searchParams.get("event");
    if (eventId && safeId(eventId)) allowed.set("event", eventId);
    const query = allowed.toString();
    return `${url.pathname || "/"}${query ? `?${query}` : ""}`;
  } catch {
    return "/";
  }
}
export function safeAnalyticsPath(
  input: string | URL = typeof window === "undefined"
    ? "/"
    : window.location.href,
) {
  return buildAnalyticsPath(input);
}

function ga() {
  if (
    !config.ga4.enabled ||
    !config.ga4.measurementId ||
    typeof window === "undefined"
  )
    return null;
  const w = window as Window & { dataLayer?: unknown[]; gtag?: Gtag };
  w.dataLayer ??= [];
  w.gtag ??= (...args: unknown[]) => w.dataLayer?.push(args);
  return w.gtag;
}
function send(
  name: EventName,
  properties: Record<string, string | number | boolean>,
) {
  ga()?.("event", name, properties);
}

export function initAnalytics() {
  if (initialization) return initialization;
  if (typeof window === "undefined" || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname))
    return Promise.resolve(config);
  initialization = fetch("/api/analytics/config")
    .then((response) =>
      response.ok
        ? (response.json() as Promise<AnalyticsRuntimeConfig>)
        : Promise.reject(new Error("analytics_config")),
    )
    .catch(() => ({
      enabled: false,
      ga4: { enabled: false, measurementId: null },
      cloudflare: { enabled: false, token: null },
    }))
    .then(async (next) => {
      config = {
        enabled: Boolean(next?.enabled),
        ga4:
          next?.enabled &&
          next.ga4?.enabled &&
          validGa4MeasurementId(next.ga4.measurementId)
            ? { enabled: true, measurementId: next.ga4.measurementId }
            : { enabled: false, measurementId: null },
        cloudflare:
          next?.enabled &&
          next.cloudflare?.enabled &&
          validCloudflareWebAnalyticsToken(next.cloudflare.token)
            ? { enabled: true, token: next.cloudflare.token }
            : { enabled: false, token: null },
      };
      config.enabled = config.ga4.enabled || config.cloudflare.enabled;
      if (config.ga4.enabled && config.ga4.measurementId) {
        const w = window as Window & { dataLayer?: unknown[]; gtag?: Gtag };
        w.dataLayer ??= [];
        w.gtag ??= (...args: unknown[]) => w.dataLayer?.push(args);
        w.gtag("js", new Date());
        w.gtag("config", config.ga4.measurementId, {
          send_page_view: false,
          page_location: `${window.location.origin}${buildAnalyticsPath()}`,
          page_referrer: "",
        });
        void loadScript(
          `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.ga4.measurementId)}`,
        );
      }
      if (config.cloudflare.enabled && config.cloudflare.token)
        void loadScript(
          "https://static.cloudflareinsights.com/beacon.min.js",
          {
            type: "module",
            "data-cf-beacon": JSON.stringify({
              token: config.cloudflare.token,
              spa: false,
            }),
          },
        );
      return config;
    });
  return initialization;
}

export function trackPageView(kind: "initial" | "detail" | "list" = "initial") {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const tag = ga();
  if (!tag) return;
  const path = safeAnalyticsPath();
  const key = `${kind}:${path}`;
  if (lastPageView === key) return;
  lastPageView = key;
  if (kind === "list") activeDetail = "";
  tag("event", "page_view", {
    page_location: `${window.location.origin}${path}`,
    page_title: document.title,
    page_referrer: "",
  });
}
export function trackEventDetailView(
  eventId: string,
  region: string | null | undefined,
  sourceKind: string | null | undefined,
  period: string,
) {
  const id = safeId(eventId);
  if (!id || !ga() || activeDetail === id) return;
  activeDetail = id;
  send("event_detail_view", {
    event_id: id,
    region: region && /^[a-z0-9가-힣_-]{1,40}$/i.test(region) ? region : "unknown",
    source_kind:
      sourceKind === "organizer" ||
      sourceKind === "municipality" ||
      sourceKind === "tourapi" ||
      sourceKind === "private_official"
        ? sourceKind
        : "unknown",
    period: ["today", "weekend", "next-weekend", "custom"].includes(period)
      ? period
      : "weekend",
  });
  trackPageView("detail");
}
export function trackFilterApply(type: FilterType, value: string) {
  if (value !== "all" && !allowedFilterValues[type].includes(value)) return;
  send("filter_apply", { filter_type: type, filter_value: value });
}
export function trackSearchSubmit(rawQuery: string, resultCount: number) {
  const length = rawQuery.trim().length;
  if (!length) return;
  const queryLengthBucket = length <= 5 ? "1-5" : length <= 10 ? "6-10" : "11+";
  const resultCountBucket =
    resultCount <= 0
      ? "0"
      : resultCount <= 5
        ? "1-5"
        : resultCount <= 20
          ? "6-20"
          : "21+";
  send("search_submit", {
    query_length_bucket: queryLengthBucket,
    result_count_bucket: resultCountBucket,
  });
}
export function trackOfficialLinkClick(
  eventId: string,
  sourceKind: string | null | undefined,
) {
  const id = safeId(eventId);
  if (!id) return;
  send("official_link_click", {
    event_id: id,
    source_kind:
      sourceKind === "organizer" ||
      sourceKind === "municipality" ||
      sourceKind === "tourapi"
        ? sourceKind
        : "unknown",
  });
}
export function trackNearbyUse(permission: "granted" | "denied" | "error") {
  send("nearby_use", { permission_result: permission });
}
export function trackPushSubscribe(scope: {
  region: boolean;
  audience: boolean;
  theme: boolean;
}) {
  send("push_subscribe", scope);
}
export function trackPushUnsubscribe() {
  send("push_unsubscribe", {});
}
export function trackLoadMore(page: number) {
  send("load_more", {
    page_bucket: page <= 1 ? "1" : page <= 3 ? "2-3" : "4+",
  });
}
