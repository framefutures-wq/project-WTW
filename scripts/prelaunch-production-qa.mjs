import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const BASE = (process.env.QA_BASE_URL || "https://galteum.com").replace(/\/$/, "");
const SAMPLE_SIZE = Number(process.env.QA_SAMPLE_SIZE || 30);
const TIMEOUT_MS = 15000;
const TODAY = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalize = (value) =>
  String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: "follow",
      ...init,
      headers: {
        "user-agent": "GalteumFinalPromotionQA/1.0",
        ...(init.headers || {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function dateVariants(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return [];
  const [y, m, d] = date.split("-");
  return [
    date,
    `${y}.${m}.${d}`,
    `${y}/${m}/${d}`,
    `${Number(m)}.${Number(d)}`,
    `${Number(m)}/${Number(d)}`,
    `${y}년 ${Number(m)}월 ${Number(d)}일`,
  ].map((x) => x.toLowerCase());
}

function titleTokens(title) {
  return normalize(title)
    .split(/[^0-9a-z가-힣]+/i)
    .filter((token) => token.length >= 2)
    .sort((a, b) => b.length - a.length)
    .slice(0, 6);
}

function chooseSample(events, size) {
  const unique = [...new Map(events.map((event) => [event.id, event])).values()];
  const groups = new Map();
  for (const event of unique) {
    if (!groups.has(event.region)) groups.set(event.region, []);
    groups.get(event.region).push(event);
  }
  const regions = [...groups.keys()].sort();
  const picked = [];
  let index = 0;
  while (picked.length < size) {
    let added = false;
    for (const region of regions) {
      const row = groups.get(region)?.[index];
      if (row && picked.length < size) {
        picked.push(row);
        added = true;
      }
    }
    if (!added) break;
    index += 1;
  }
  if (picked.length < size) {
    const used = new Set(picked.map((e) => e.id));
    for (const event of unique) {
      if (!used.has(event.id)) picked.push(event);
      if (picked.length >= size) break;
    }
  }
  return picked.slice(0, size);
}

function sourceUrl(detail) {
  const event = detail.event || {};
  if (event.trust_source_url) return event.trust_source_url;
  if (detail.enrichment?.source_priority <= 2 && detail.enrichment?.source_url)
    return detail.enrichment.source_url;
  return event.source_url || null;
}

async function sourceProbe(url, event) {
  if (!url) return { status: "missing", http: null, signal: false, reason: "no_source_url" };
  try {
    const response = await fetchWithTimeout(url);
    const body = normalize((await response.text()).slice(0, 2_000_000));
    const tokens = titleTokens(event.title);
    const titleSignal = tokens.some((token) => body.includes(token));
    const dateSignal = [...dateVariants(event.start_date), ...dateVariants(event.end_date)]
      .some((token) => body.includes(token));
    const venueSignal = titleTokens(event.venue).slice(0, 3).some((token) => body.includes(token));
    return {
      status: response.ok ? "reachable" : "http_error",
      http: response.status,
      final_url: response.url,
      signal: titleSignal || dateSignal || venueSignal,
      title_signal: titleSignal,
      date_signal: dateSignal,
      venue_signal: venueSignal,
    };
  } catch (error) {
    return {
      status: "fetch_error",
      http: null,
      signal: false,
      reason: error instanceof Error ? error.name : "unknown",
    };
  }
}

async function pool() {
  const queries = [
    "period=weekend&sort=recommended&page=1&limit=50",
    "period=next-weekend&sort=date&page=1&limit=50",
    "period=today&sort=date&page=1&limit=50",
  ];
  const rows = [];
  for (const query of queries) {
    const response = await fetchWithTimeout(`${BASE}/api/events?${query}`);
    if (!response.ok) throw new Error(`event pool failed ${response.status}: ${query}`);
    const body = await response.json();
    rows.push(...(body.events || []));
  }
  return rows;
}

async function inspectEvent(event, index) {
  const critical = [];
  const warnings = [];
  if (!event.id || !event.title?.trim()) critical.push("missing_identity");
  if (!event.venue?.trim()) critical.push("missing_venue");
  if (!event.address?.trim()) critical.push("missing_address");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.start_date || "") ||
      !/^\d{4}-\d{2}-\d{2}$/.test(event.end_date || "") ||
      event.start_date > event.end_date) critical.push("invalid_date_range");
  if (event.end_date < TODAY) critical.push("ended_event_visible");
  if (["cancelled", "postponed"].includes(event.status)) critical.push(`bad_status_${event.status}`);
  if (event.verification !== "verified" || Number(event.is_sample) !== 0)
    critical.push("not_verified_real");
  if (!event.checked_at) warnings.push("missing_checked_at");
  else {
    const ageHours = (Date.now() - Date.parse(event.checked_at)) / 3600000;
    if (Number.isFinite(ageHours) && ageHours > 96) warnings.push(`checked_at_${Math.round(ageHours)}h_old`);
  }

  const encoded = encodeURIComponent(event.id);
  let detail = null;
  let detailHttp = null;
  try {
    const response = await fetchWithTimeout(`${BASE}/api/events/${encoded}`);
    detailHttp = response.status;
    if (!response.ok) critical.push(`detail_api_http_${response.status}`);
    else detail = await response.json();
  } catch (error) {
    critical.push(`detail_api_fetch_${error instanceof Error ? error.name : "error"}`);
  }

  if (detail?.event) {
    for (const key of ["id", "title", "region", "venue", "address", "start_date", "end_date"]) {
      if (String(detail.event[key] ?? "") !== String(event[key] ?? ""))
        critical.push(`list_detail_mismatch_${key}`);
    }
  }

  let pageHttp = null;
  let canonicalOk = false;
  try {
    const response = await fetchWithTimeout(`${BASE}/events/${encoded}`);
    pageHttp = response.status;
    const html = await response.text();
    if (!response.ok) critical.push(`detail_page_http_${response.status}`);
    canonicalOk = html.includes(`rel="canonical" href="${BASE}/events/${encoded}"`);
    if (!canonicalOk) critical.push("canonical_missing_or_wrong");
  } catch (error) {
    critical.push(`detail_page_fetch_${error instanceof Error ? error.name : "error"}`);
  }

  const official = detail ? sourceUrl(detail) : event.trust_source_url || event.source_url || null;
  const source = await sourceProbe(official, event);
  if (!official) warnings.push("no_official_source_url");
  else if (source.status !== "reachable") warnings.push(`source_${source.status}_${source.http ?? ""}`);
  else if (!source.signal) warnings.push("source_reachable_but_no_content_signal");

  process.stdout.write(
    `[${String(index + 1).padStart(2, "0")}/${SAMPLE_SIZE}] ${event.region} | ${event.title} | critical=${critical.length} warnings=${warnings.length}\n`,
  );
  await sleep(80);
  return {
    id: event.id,
    title: event.title,
    region: event.region,
    venue: event.venue,
    address: event.address,
    start_date: event.start_date,
    end_date: event.end_date,
    status: event.status,
    verification: event.verification,
    checked_at: event.checked_at,
    detail_api_http: detailHttp,
    detail_page_http: pageHttp,
    canonical_ok: canonicalOk,
    source_url: official,
    source_probe: source,
    critical,
    warnings,
  };
}

async function mobileQa(sample) {
  const checks = [];
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    for (const event of sample.slice(0, 5)) {
      const path = `/events/${encodeURIComponent(event.id)}`;
      const response = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      const dialog = page.locator('dialog[aria-label="행사 상세 정보"]');
      await dialog.waitFor({ state: "visible", timeout: 20000 });
      await dialog.locator(".detail-primary-facts").waitFor({ state: "visible", timeout: 20000 });
      await dialog.locator(".detail-source-row").waitFor({ state: "attached", timeout: 20000 });
      const result = await dialog.evaluate((dialog) => ({
        dialog_width: dialog.getBoundingClientRect().width,
        viewport_width: innerWidth,
        dialog_overflow: dialog.scrollWidth > dialog.clientWidth,
        document_overflow: document.documentElement.scrollWidth > innerWidth,
        document_scroll_width: document.documentElement.scrollWidth,
        has_primary_facts: Boolean(dialog.querySelector(".detail-primary-facts")),
        has_source_row: Boolean(dialog.querySelector(".detail-source-row")),
      }));
      checks.push({
        id: event.id,
        title: event.title,
        http: response?.status() ?? null,
        ...result,
        ok:
          response?.status() === 200 &&
          result.dialog_width <= result.viewport_width &&
          !result.dialog_overflow &&
          result.has_primary_facts &&
          result.has_source_row,
      });
    }
    const landingResponse = await page.goto(`${BASE}/weekend/seoul`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.locator(".event-card").first().waitFor({ state: "visible", timeout: 20000 });
    const landing = await page.evaluate(() => {
      const clippedByAncestor = (element) => {
        let parent = element.parentElement;
        while (parent && parent !== document.body) {
          const style = getComputedStyle(parent);
          const rect = parent.getBoundingClientRect();
          if (
            ["auto", "scroll", "hidden", "clip"].includes(style.overflowX) &&
            rect.left >= -1 &&
            rect.right <= innerWidth + 1
          ) return true;
          parent = parent.parentElement;
        }
        return false;
      };
      const offenders = [...document.querySelectorAll("body *")]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            className: typeof element.className === "string" ? element.className : "",
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            clipped: clippedByAncestor(element),
          };
        })
        .filter((item) => (item.right > innerWidth + 1 || item.left < -1) && !item.clipped)
        .sort((a, b) => Math.max(b.right - innerWidth, -b.left) - Math.max(a.right - innerWidth, -a.left))
        .slice(0, 12);
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        scroll_width: document.documentElement.scrollWidth,
        viewport_width: innerWidth,
        region: document.querySelector('select[aria-label="지역"]')?.value ?? null,
        cards: document.querySelectorAll(".event-card").length,
        offenders,
      };
    });
    checks.push({
      id: "seo-landing",
      title: "서울 이번 주말 행사",
      http: landingResponse?.status() ?? null,
      ok: landingResponse?.status() === 200 && !landing.overflow && landing.region === "서울" && landing.cards > 0,
      ...landing,
    });
  } finally {
    await browser.close();
  }
  return checks;
}

const all = await pool();
const sample = chooseSample(all, SAMPLE_SIZE);
if (process.env.QA_MOBILE_ONLY === "1") {
  const mobile = await mobileQa(sample.slice(0, 5));
  const report = {
    generated_at: new Date().toISOString(),
    base_url: BASE,
    mode: "mobile_only",
    mobile,
  };
  await writeFile("prelaunch-qa-report.json", JSON.stringify(report, null, 2));
  console.log("\n=== MOBILE DIAGNOSTIC ===");
  console.log(JSON.stringify(mobile, null, 2));
  process.exit(0);
}
if (sample.length < Math.min(SAMPLE_SIZE, 20))
  throw new Error(`insufficient production sample: ${sample.length}`);

console.log(`Production pool unique=${new Set(all.map((e) => e.id)).size}, selected=${sample.length}, regions=${new Set(sample.map((e) => e.region)).size}`);
const rows = [];
for (let i = 0; i < sample.length; i += 1) rows.push(await inspectEvent(sample[i], i));
const mobile = await mobileQa(sample);

const criticalRows = rows.filter((row) => row.critical.length);
const warningRows = rows.filter((row) => row.warnings.length);
const sourceReachable = rows.filter((row) => row.source_probe.status === "reachable").length;
const sourceSignal = rows.filter((row) => row.source_probe.signal).length;
const mobileFailures = mobile.filter((row) => !row.ok);

const report = {
  generated_at: new Date().toISOString(),
  base_url: BASE,
  sample_size: rows.length,
  regions: [...new Set(rows.map((row) => row.region))].sort(),
  summary: {
    critical_events: criticalRows.length,
    warning_events: warningRows.length,
    source_reachable: sourceReachable,
    source_content_signal: sourceSignal,
    mobile_checks: mobile.length,
    mobile_failures: mobileFailures.length,
    verdict:
      criticalRows.length === 0 && mobileFailures.length === 0
        ? warningRows.length === 0
          ? "PROMOTION_READY"
          : "PROMOTION_READY_WITH_REVIEW"
        : "NOT_PROMOTION_READY",
  },
  events: rows,
  mobile,
};

await writeFile("prelaunch-qa-report.json", JSON.stringify(report, null, 2));
console.log("\n=== PRELAUNCH QA SUMMARY ===");
console.log(JSON.stringify(report.summary, null, 2));
if (criticalRows.length) {
  console.log("\n=== CRITICAL EVENTS ===");
  for (const row of criticalRows)
    console.log(`- ${row.region} | ${row.title} | ${row.critical.join(", ")}`);
}
if (warningRows.length) {
  console.log("\n=== WARNING EVENTS ===");
  for (const row of warningRows)
    console.log(`- ${row.region} | ${row.title} | ${row.warnings.join(", ")}`);
}
if (mobileFailures.length) {
  console.log("\n=== MOBILE FAILURES ===");
  for (const row of mobileFailures) console.log(`- ${row.title}`);
}
if (criticalRows.length || mobileFailures.length) process.exitCode = 2;
