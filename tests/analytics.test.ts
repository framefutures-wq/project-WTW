import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  analyticsRuntimeConfig,
  validCloudflareWebAnalyticsToken,
  validGa4MeasurementId,
} from "../shared/analytics-config";
import { safeAnalyticsPath } from "../src/analytics";

test("SPA navigation and behavior events are sent once with sanitized payloads", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  const scripts: Array<Record<string, string>> = [];
  const fakeWindow = {
    location: { hostname: "weekend-mwohae.framefutures.workers.dev", origin: "https://weekend-mwohae.framefutures.workers.dev", href: "https://weekend-mwohae.framefutures.workers.dev/?period=weekend&q=private&lat=37.1" },
    dataLayer: [] as unknown[],
  };
  const fakeDocument = {
    title: "갈틈",
    querySelectorAll: () => scripts,
    createElement: () => ({ dataset: {} as Record<string, string>, setAttribute(key: string, value: string) { this.dataset[key] = value; }, getAttribute(key: string) { return key === "data-wtw-analytics" ? this.dataset.wtwAnalytics : this.dataset[key]; } }),
    head: { appendChild(script: Record<string, string>) { scripts.push(script); } },
  };
  Object.assign(globalThis, {
    window: fakeWindow,
    document: fakeDocument,
    fetch: async () => Response.json({ enabled: true, ga4: { enabled: true, measurementId: "G-TEST123" }, cloudflare: { enabled: true, token: "synthetic_token_123" } }),
  });
  try {
    const modulePath = "../src/analytics.ts?spa-test";
    const analytics: typeof import("../src/analytics") = await import(modulePath);
    await Promise.all([analytics.initAnalytics(), analytics.initAnalytics()]);
    analytics.trackPageView("initial");
    analytics.trackPageView("initial");
    analytics.trackFilterApply("region", "경기");
    analytics.trackFilterApply("region", "private-search");
    analytics.trackSearchSubmit("private raw search", 3);
    fakeWindow.location.href = "https://weekend-mwohae.framefutures.workers.dev/?period=weekend&event=tourapi-123&q=private";
    analytics.trackEventDetailView("tourapi-123", "경기", "tourapi", "weekend");
    analytics.trackEventDetailView("tourapi-123", "경기", "tourapi", "weekend");
    analytics.trackNearbyUse("granted");
    analytics.trackPushSubscribe({ region: true, audience: false, theme: false });
    analytics.trackPushUnsubscribe();
    analytics.trackOfficialLinkClick("tourapi-123", "tourapi");
    analytics.trackLoadMore(4);
    fakeWindow.location.href = "https://weekend-mwohae.framefutures.workers.dev/?period=weekend&q=private";
    analytics.trackPageView("list");
    analytics.trackPageView("list");
    const events = fakeWindow.dataLayer.filter((entry): entry is unknown[] => Array.isArray(entry) && entry[0] === "event");
    assert.equal(events.filter((entry) => entry[1] === "page_view").length, 3);
    assert.equal(events.filter((entry) => entry[1] === "event_detail_view").length, 1);
    assert.equal(events.filter((entry) => entry[1] === "filter_apply").length, 1);
    assert.equal(events.filter((entry) => entry[1] === "search_submit").length, 1);
    for (const name of ["nearby_use", "push_subscribe", "push_unsubscribe", "official_link_click", "load_more"])
      assert.equal(events.filter((entry) => entry[1] === name).length, 1);
    assert.doesNotMatch(JSON.stringify(events), /private raw search|private-search|lat=|37\.1|endpoint|p256dh|auth/);
    assert.equal(scripts.length, 2);
  } finally {
    Object.assign(globalThis, { window: originalWindow, document: originalDocument, fetch: originalFetch });
  }
});

test("analytics runtime config is disabled by default and never returns secrets", () => {
  assert.deepEqual(analyticsRuntimeConfig({}), {
    enabled: false,
    ga4: { enabled: false, measurementId: null },
    cloudflare: { enabled: false, token: null },
  });
  assert.deepEqual(
    analyticsRuntimeConfig({
      APP_MODE: "sample",
      ANALYTICS_ENABLED: "true",
      GA4_MEASUREMENT_ID: "G-TEST123",
      CLOUDFLARE_WEB_ANALYTICS_TOKEN: "token_123456",
    }),
    {
      enabled: false,
      ga4: { enabled: false, measurementId: null },
      cloudflare: { enabled: false, token: null },
    },
  );
  assert.deepEqual(
    analyticsRuntimeConfig({
      APP_MODE: "production",
      ANALYTICS_ENABLED: "true",
      GA4_MEASUREMENT_ID: "G-TEST123",
      CLOUDFLARE_WEB_ANALYTICS_TOKEN: "token_123456",
    }),
    {
      enabled: true,
      ga4: { enabled: true, measurementId: "G-TEST123" },
      cloudflare: { enabled: true, token: "token_123456" },
    },
  );
  assert.deepEqual(
    analyticsRuntimeConfig({
      APP_MODE: "production",
      ANALYTICS_ENABLED: "true",
      GA4_MEASUREMENT_ID: "UA-123",
    }),
    {
      enabled: false,
      ga4: { enabled: false, measurementId: null },
      cloudflare: { enabled: false, token: null },
    },
  );
  assert.deepEqual(
    analyticsRuntimeConfig({
      APP_MODE: "production",
      ANALYTICS_ENABLED: "true",
      CLOUDFLARE_WEB_ANALYTICS_TOKEN: "short",
    }),
    {
      enabled: false,
      ga4: { enabled: false, measurementId: null },
      cloudflare: { enabled: false, token: null },
    },
  );
  assert.equal(validGa4MeasurementId("UA-123"), false);
  assert.equal(validCloudflareWebAnalyticsToken("short"), false);
});

test("analytics path removes search text, coordinates and unknown parameters", () => {
  assert.equal(
    safeAnalyticsPath(
      "https://weekend-mwohae.example/?period=weekend&region=경기&q=전화번호&lat=37.1&lng=127.1&secret=x&event=evt_1",
    ),
    "/?period=weekend&region=%EA%B2%BD%EA%B8%B0&event=evt_1",
  );
});

test("analytics source keeps sensitive values out of provider calls", () => {
  const source = readFileSync(
    new URL("../src/analytics.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /push_endpoint|p256dh|VAPID_PRIVATE|latitude|longitude/,
  );
  assert.doesNotMatch(source, /query:\s*rawQuery|search_term/);
  assert.match(source, /send_page_view: false/);
});
