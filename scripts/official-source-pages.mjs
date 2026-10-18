import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { extractUrls, fetchPage } from "./official-source-lib.mjs";
const dir = ".wrangler/deployment/official-source";
const snapshot = JSON.parse(
  readFileSync(".wrangler/deployment/tourapi-real.json", "utf8"),
);
const details = JSON.parse(readFileSync(`${dir}/details.json`, "utf8"));
mkdirSync(dir, { recursive: true });
const candidates = {};
for (const event of snapshot.events) {
  const source = snapshot.sources.find((s) => s.id === event.primary_source_id);
  const detail = details[event.id.slice(8)];
  const inventory = [
    ...extractUrls(JSON.parse(source.raw_payload)),
    ...extractUrls(detail?.results || [], "detail"),
  ];
  // Existing event-linked evidence sources are candidates too. The API documentation
  // landing page is not an event-specific source and is not counted as VisitKorea.
  for (const evidence of snapshot.evidence.filter(
    (e) => e.event_id === event.id,
  )) {
    const linked = snapshot.sources.find((s) => s.id === evidence.source_id);
    if (linked && linked.kind !== "tourapi" && linked.url)
      inventory.push(...extractUrls(linked.url, `existing.${linked.id}`));
  }
  candidates[event.id] = {
    inventory,
    urls: [...new Set(inventory.filter((u) => !u.asset).map((u) => u.url))],
  };
}
writeFileSync(`${dir}/candidates.json`, JSON.stringify(candidates, null, 2));
let pages = {};
try {
  pages = JSON.parse(readFileSync(`${dir}/pages.json`, "utf8"));
} catch {}
const urls = [...new Set(Object.values(candidates).flatMap((c) => c.urls))];
let index = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (index < urls.length) {
      const url = urls[index++];
      if (
        !pages[url] ||
        (process.argv.includes("--refresh-text") && pages[url].accessStatus === "ok" && pages[url].text.includes("-->")) ||
        (process.argv.includes("--retry-failed") &&
          pages[url].accessStatus === "network_error")
      ) {
        pages[url] = await fetchPage(url);
        writeFileSync(`${dir}/pages.json`, JSON.stringify(pages, null, 2));
      }
      console.log(
        `${Object.keys(pages).length}/${urls.length} ${pages[url].accessStatus} ${url}`,
      );
    }
  }),
);
