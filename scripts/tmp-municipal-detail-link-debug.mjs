import {
  extractMunicipalCandidates,
} from "../shared/municipal-discovery.ts";
import {
  municipalSourceByKey,
} from "../shared/municipal-source-registry.ts";

const keys = [
  "hwaseong",
  "bucheon",
  "taebaek",
  "gyeongbuk-상주",
  "gyeonggi-평택",
  "gyeonggi-여주",
  "gyeongbuk-경산",
  "busan-해운대",
  "ulsan-jung",
];

const text = (html) =>
  html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

const esc = (value) => value.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");

function candidateBlock(html, title) {
  for (const tag of ["li", "tr", "article", "section", "div"]) {
    const re = new RegExp("<" + tag + "\\b[\\s\\S]*?<\\/" + tag + "\\s*>", "gi");
    for (const match of html.matchAll(re)) {
      if (text(match[0]).includes(title)) return match[0];
    }
  }
  const needle = title.slice(0, Math.min(title.length, 20));
  const index = html.search(new RegExp(esc(needle), "i"));
  return index >= 0 ? html.slice(Math.max(0, index - 1800), index + 2400) : "";
}

function attrs(block) {
  const out = [];
  for (const match of block.matchAll(
    /\b(?:href|onclick|data-href|data-url|data-link|data-[a-z0-9_-]*(?:id|idx|sn|seq|uid))\s*=\s*["']([^"']+)["']/gi,
  )) {
    out.push(match[0].replace(/\s+/g, " ").slice(0, 500));
  }
  return [...new Set(out)].slice(0, 20);
}

for (const key of keys) {
  const source = municipalSourceByKey(key);
  if (!source) continue;
  try {
    const response = await fetch(source.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
      headers: { "user-agent": "GaltteumDetailLinkDebug/1.0 read-only" },
    });
    const html = await response.text();
    const extraction = extractMunicipalCandidates(source, html);
    const first = extraction.candidates[0];
    const block = first ? candidateBlock(html, first.title) : "";
    console.log(JSON.stringify({
      source: key,
      http: response.status,
      mode: extraction.mode,
      candidate_count: extraction.candidates.length,
      title: first?.title ?? null,
      official_url: first?.official_url ?? null,
      source_url: source.url,
      block_text: block ? text(block).slice(0, 800) : null,
      attrs: block ? attrs(block) : [],
    }));
  } catch (error) {
    console.log(JSON.stringify({
      source: key,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}


for (const key of ["gyeonggi-평택", "gyeonggi-여주", "gyeongbuk-경산"]) {
  const source = municipalSourceByKey(key);
  if (!source) continue;
  try {
    const response = await fetch(source.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
      headers: { "user-agent": "GaltteumDetailPatternDebug/1.0 read-only" },
    });
    const html = await response.text();
    const patterns =
      key === "gyeonggi-평택"
        ? [/[^\n]{0,250}pfmcView\.do[^\n]{0,450}/gi]
        : key === "gyeonggi-여주"
          ? [/[^\n]{0,250}(?:reserve\/board|jnPrgReserveBoard|board\/1\/M)[^\n]{0,450}/gi]
          : [
              /function\s+goDetail[\s\S]{0,1000}/gi,
              /[^\n]{0,250}goDetail\s*\([^\n]{0,450}/gi,
              /[^\n]{0,250}performance[^\n]{0,450}/gi,
            ];
    const matches = patterns.flatMap((pattern) =>
      [...html.matchAll(pattern)].map((match) =>
        match[0].replace(/\s+/g, " ").slice(0, 900),
      ),
    );
    console.log(JSON.stringify({
      pattern_source: key,
      matches: [...new Set(matches)].slice(0, 12),
    }));
  } catch (error) {
    console.log(JSON.stringify({
      pattern_source: key,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}
