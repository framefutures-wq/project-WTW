import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import worker from "../worker/index";
import { robotsTxt, sitemapXml } from "../worker/seo";

const html = `<!doctype html><html lang="ko"><head><meta name="description" content="기본 설명" /><title>기본</title></head><body><div id="root"></div></body></html>`;

async function setup() {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('ok')}}",
      compatibilityDate: "2026-09-18",
      d1Databases: ["DB"],
      cf: false,
    }),
  );
  const DB = await mf.getD1Database("DB");
  for (const file of readdirSync("migrations").sort())
    for (const sql of readFileSync(`migrations/${file}`, "utf8")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean))
      await DB.prepare(sql).run();
  const now = new Date().toISOString();
  await DB.batch([
    DB.prepare("INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES('source','tourapi',3,'공식 TourAPI','https://example.test',?)").bind(now),
    DB.prepare("INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,cost,status,verification,is_sample,primary_source_id,checked_at,updated_at) VALUES('seo-event_1','봄 <행사>','설명','서울','서울 광장','서울특별시 중구 세종대로','2026-09-21','2026-10-01','unknown','scheduled','verified',0,'source',?,?)").bind(now, now),
    ...["schedule", "venue", "status"].map((field) =>
      DB.prepare("INSERT INTO event_evidence(event_id,source_id,field,excerpt,checked_at) VALUES('seo-event_1','source',?,?,?)").bind(field, "확인", now),
    ),
    DB.prepare("INSERT INTO event_images(event_id,image_url,source_type,source_page_url,is_primary,image_status,last_checked_at) VALUES('seo-event_1','https://images.example.test/event.jpg','official','https://example.test/event',1,'ok',?)").bind(now),
    DB.prepare("INSERT INTO event_additional_images(event_id,image_url,source_type,source_page_url,sort_order,image_status,last_checked_at) VALUES('seo-event_1','https://images.example.test/event-2.jpg','tourapi','https://example.test/event',2,'ok',?)").bind(now),
    DB.prepare("INSERT INTO event_additional_images(event_id,image_url,source_type,source_page_url,sort_order,image_status,last_checked_at) VALUES('seo-event_1','https://images.example.test/event-3.jpg','tourapi','https://example.test/event',3,'ok',?)").bind(now),
    DB.prepare("INSERT INTO event_additional_images(event_id,image_url,source_type,source_page_url,sort_order,image_status,last_checked_at) VALUES('seo-event_1','https://images.example.test/blocked.jpg','tourapi','https://example.test/event',4,'blocked',?)").bind(now),
    DB.prepare("INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,cost,status,verification,is_sample,primary_source_id,checked_at,updated_at) VALUES('hidden','숨김','설명','서울','장소','주소','2026-09-21','2026-10-01','unknown','scheduled','pending',0,'source',?,?)").bind(now, now),
  ]);
  const env = {
    DB,
    ASSETS: { fetch: async () => new Response(html, { headers: { "Content-Type": "text/html" } }) },
    APP_MODE: "production",
    TOUR_API_ENABLED: "false",
  };
  return { mf, env };
}

test("event pages are self-canonical, escaped, and expose one factual Event JSON-LD", async () => {
  const { mf, env } = await setup();
  try {
    const response = await worker.fetch(new Request("https://galteum.com/events/seo-event_1"), env as never);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(body, /<link rel="canonical" href="https:\/\/galteum\.com\/events\/seo-event_1"/);
    assert.match(body, /<meta property="og:image" content="https:\/\/images\.example\.test\/event\.jpg"/);
    assert.doesNotMatch(body, /봄 <행사>/);
    const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(body)?.[1];
    assert(json);
    assert.deepEqual(JSON.parse(json!), {
      "@context": "https://schema.org",
      "@type": "Event",
      name: "봄 <행사>",
      startDate: "2026-09-21",
      endDate: "2026-10-01",
      url: "https://galteum.com/events/seo-event_1",
      description: "봄 <행사> · 2026-09-21~2026-10-01 · 서울 광장. 갈틈에서 공식 확인 정보를 확인하세요.",
      location: { "@type": "Place", name: "서울 광장", address: { "@type": "PostalAddress", streetAddress: "서울특별시 중구 세종대로" } },
      image: ["https://images.example.test/event.jpg"],
      eventStatus: "https://schema.org/EventScheduled",
    });
  } finally {
    await mf.dispose();
  }
});

test("detail API returns primary then distinct usable additional images only", async () => {
  const { mf, env } = await setup();
  try {
    await (env as { DB: D1Database }).DB.prepare("INSERT OR IGNORE INTO event_additional_images(event_id,image_url,source_type,source_page_url,sort_order,image_status,last_checked_at) VALUES('seo-event_1','https://images.example.test/event.jpg','tourapi','https://example.test/event',5,'ok',?)").bind(new Date().toISOString()).run();
    const response = await worker.fetch(new Request("https://galteum.com/api/events/seo-event_1"), env as never);
    const body = await response.json() as { images: { image_url: string; is_primary: boolean; sort_order: number }[] };
    assert.deepEqual(body.images, [
      { image_url: "https://images.example.test/event.jpg", source_type: "official", source_page_url: "https://example.test/event", is_primary: true, sort_order: 1 },
      { image_url: "https://images.example.test/event-2.jpg", source_type: "tourapi", source_page_url: "https://example.test/event", sort_order: 2, is_primary: false },
      { image_url: "https://images.example.test/event-3.jpg", source_type: "tourapi", source_page_url: "https://example.test/event", sort_order: 3, is_primary: false },
    ]);
  } finally { await mf.dispose(); }
});

test("root canonical, sitemap, robots, and event 404s follow the public visibility contract", async () => {
  const { mf, env } = await setup();
  try {
    const root = await worker.fetch(new Request("https://galteum.com/?q=private"), env as never);
    assert.match(await root.text(), /<link rel="canonical" href="https:\/\/galteum\.com\/"/);
    const sitemap = await worker.fetch(new Request("https://galteum.com/sitemap.xml"), env as never);
    const sitemapBody = await sitemap.text();
    assert.equal(sitemap.status, 200);
    assert.match(sitemap.headers.get("content-type") ?? "", /application\/xml/);
    assert.match(sitemapBody, /https:\/\/galteum\.com\/events\/seo-event_1/);
    assert.doesNotMatch(sitemapBody, /hidden/);
    const robots = await worker.fetch(new Request("https://galteum.com/robots.txt"), env as never);
    assert.equal(await robots.text(), robotsTxt);
    assert.equal((await worker.fetch(new Request("https://galteum.com/events/not-found"), env as never)).status, 404);
    assert.equal((await worker.fetch(new Request("https://galteum.com/events/%E0%A4%A"), env as never)).status, 404);
    assert.equal((await worker.fetch(new Request("https://galteum.com/events/a/b"), env as never)).status, 404);
  } finally {
    await mf.dispose();
  }
});

test("sitemap XML escapes canonical event ids and keeps only route-safe identifiers", () => {
  const xml = sitemapXml([
    { id: "safe_event", title: "x", venue: "x", address: "x", start_date: "2026-01-01", end_date: "2026-01-01", status: "unknown", cost: "unknown", image_url: null, image_status: null, updated_at: null, checked_at: null },
    { id: "not/a/path", title: "x", venue: "x", address: "x", start_date: "2026-01-01", end_date: "2026-01-01", status: "unknown", cost: "unknown", image_url: null, image_status: null, updated_at: null, checked_at: null },
  ]);
  assert.match(xml, /events\/safe_event/);
  assert.doesNotMatch(xml, /not\/a\/path/);
});
