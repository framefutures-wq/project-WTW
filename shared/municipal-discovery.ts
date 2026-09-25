import { normalizeMunicipalTitle } from "./municipal-duplicate";
import {
  assessMunicipalSourceDocument,
  municipalSourceAllowsUrl,
  type MunicipalSourceDefinition,
} from "./municipal-source-registry";

export type SelectionGate = "MAIN" | "NEARBY_ONLY" | "EXCLUDE" | "REVIEW";
export type MunicipalCandidate = {
  source: string;
  source_candidate_id: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  region: string;
  locality: string;
  venue: string | null;
  official_url: string;
  category: string | null;
  snippet: string | null;
  image_candidate: { url: string; source_url: string } | null;
  parse_error?: string;
};

/** A list-only observation is never publishable; its detail must complete core. */
export type MunicipalListDetailPartial = {
  source: string;
  source_candidate_id: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  venue: string | null;
  region: string;
  locality: string;
  official_url: string;
  category: string | null;
  snippet: string | null;
};

const clean = (value: string) =>
  value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    // HTML element names are ASCII; preserve literal Korean angle-bracket text
    // such as `뮤지컬 <광화문연가>` while still removing real markup.
    .replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&(?:#039|apos);/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
const absolute = (base: string, value: string | undefined) =>
  value ? new URL(value, base).toString() : null;
const validRange = (start: string, end: string) =>
  /^20\d{2}-\d{2}-\d{2}$/.test(start) &&
  /^20\d{2}-\d{2}-\d{2}$/.test(end) &&
  start <= end;

const blockText = (value: string) =>
  clean(
    value
      .replace(/<br\s*\/?>/gi, " | ")
      .replace(/<\/(?:td|th|li|p|div|article|section|h[1-6])\s*>/gi, " | "),
  );

const htmlAttribute = (html: string, attribute: string) =>
  new RegExp(`${attribute}=["']([^"']+)["']`, "i").exec(html)?.[1] ?? null;

const classValue = (html: string, classPattern: string) => {
  const attributes = `(?:[^"'>]|"[^"]*"|'[^']*')*`;
  const element = new RegExp(
    `<([a-z0-9]+)${attributes}class=["'][^"']*${classPattern}[^"']*["']${attributes}>([\\s\\S]*?)<\\/\\1>`,
    "i",
  ).exec(html);
  return element ? clean(element[2]) || null : null;
};

const labeledValue = (text: string, labels: string[]) => {
  const label = labels.map((value) => value.split("").join("\\s*")).join("|");
  const match = new RegExp(`(?:${label})\\s*[:：]\\s*([^\\n|｜]+)`, "i").exec(
    text,
  );
  return match ? match[1].trim() || null : null;
};

const inlineLabeledValue = (text: string, labels: string[]) => {
  const label = labels.map((value) => value.split("").join("\\s*")).join("|");
  const match = new RegExp(
    `(?:○|•|-)?\\s*(?:${label})\\s*(?:[-–:：])\\s*([^\\n|｜]+?)(?=\\s*(?:○|•|-)\\s*[^|｜]+?\\s*(?:[-–:：])|\\s*[|｜]|$)`,
    "i",
  ).exec(text);
  return match ? match[1].trim() || null : null;
};

const definitionValue = (html: string, labels: string[]) => {
  const label = `(?:${labels.join("|")})`;
  const pair = new RegExp(
    `<(?:dt|th)\\b[^>]*>\\s*${label}\\s*<\\/(?:dt|th)>\\s*<(?:dd|td)\\b[^>]*>([\\s\\S]*?)<\\/(?:dd|td)>`,
    "i",
  ).exec(html);
  return pair ? clean(pair[1]) || null : null;
};

/** Common card/detail label-value markup without assuming one site's tags. */
const classPairValue = (html: string, labels: string[]) => {
  const label = labels.map((value) => value.split("").join("\\s*")).join("|");
  const pair = new RegExp(
    `<(?:div|span|p|strong|em)\\b[^>]*class=["'][^"']*(?:name|label|title)[^"']*["'][^>]*>\\s*(?:${label})\\s*<\\/(?:div|span|p|strong|em)\\s*>\\s*<(?:div|span|p|strong|em)\\b[^>]*class=["'][^"']*(?:detail|value|text|content)[^"']*["'][^>]*>([\\s\\S]*?)<\\/(?:div|span|p|strong|em)\\s*>`,
    "i",
  ).exec(html);
  return pair ? clean(pair[1]) || null : null;
};

/**
 * Some official cards render a date and venue as separate lines inside one
 * explicitly named information block. Keep that fallback inside the same
 * repeated card and reject placeholder values such as `기타`.
 */
const metadataVenueFromBlock = (html: string) => {
  const metadata = new RegExp(
    `<([a-z0-9]+)\\b[^>]*class=["'][^"']*(?:info|meta(?:data)?|desc)[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
    "gi",
  );
  for (const match of html.matchAll(metadata)) {
    const values = blockText(match[2].replace(/<\/span\s*>/gi, " | "))
      .split(/\s*[|｜]\s*/)
      .map((value) => value.trim())
      .filter(Boolean);
    const dateIndex = values.findIndex((value) => explicitDateRange(value));
    const venue = values.slice(dateIndex + 1).find(isValidVenue);
    if (venue) return venue;
  }
  return null;
};

const toExplicitDate = (year: string, month: string, day: string) =>
  `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;

/** Accepts only dates that print their calendar year; generic extraction never fills one in. */
const explicitDateRange = (value: string) => {
  const text = value.replace(/\s+/g, " ");
  const date =
    "(20\\d{2})\\s*(?:년|[.\\-/])\\s*(\\d{1,2})\\s*(?:월|[.\\-/])\\s*(\\d{1,2})\\s*(?:일|\\.)?(?:\\s*\\([^)]*\\))?(?:\\s+\\d{1,2}(?:시|:)\\s*\\d{0,2}(?:분)?)?";
  const range = new RegExp(`${date}\\s*(?:[~∼]|부터|[-–])\\s*${date}`);
  const matchedRange = range.exec(text);
  if (matchedRange) {
    const start_date = toExplicitDate(
      matchedRange[1],
      matchedRange[2],
      matchedRange[3],
    );
    const end_date = toExplicitDate(
      matchedRange[4],
      matchedRange[5],
      matchedRange[6],
    );
    return validRange(start_date, end_date) ? { start_date, end_date } : null;
  }

  // Official cards often print the year once, then omit it from the range
  // tail (for example 2026.10.17~10.18 or 2026.10.17~18). Reuse the
  // explicitly printed start year only inside that same range expression;
  // never infer across years.
  const compactStart =
    "(20\\d{2})\\s*(?:년|[.\\-/])\\s*(\\d{1,2})\\s*(?:월|[.\\-/])\\s*(\\d{1,2})\\s*(?:일|\\.)?(?:\\s*\\([^)]*\\))?";
  const compactTail = new RegExp(
    `${compactStart}\\s*(?:[~∼]|부터|[-–])\\s*(?:(\\d{1,2})\\s*(?:월|[.\\-/])\\s*)?(\\d{1,2})\\s*(?:일|\\.)?(?:\\s*\\([^)]*\\))?`,
  ).exec(text);
  if (compactTail) {
    const start_date = toExplicitDate(
      compactTail[1],
      compactTail[2],
      compactTail[3],
    );
    const end_date = toExplicitDate(
      compactTail[1],
      compactTail[4] ?? compactTail[2],
      compactTail[5],
    );
    return validRange(start_date, end_date) ? { start_date, end_date } : null;
  }

  const dates = [...text.matchAll(new RegExp(date, "g"))];
  if (dates.length !== 1) return null;
  const start_date = toExplicitDate(dates[0][1], dates[0][2], dates[0][3]);
  return validRange(start_date, start_date)
    ? { start_date, end_date: start_date }
    : null;
};

const singleExplicitDate = (value: string) => {
  const dates = explicitDateRange(value);
  return dates && dates.start_date === dates.end_date ? dates.start_date : null;
};

const invalidVenueLabels = new Set([
  "장소",
  "행사장",
  "위치",
  "venue",
  "location",
  "place",
  "기타",
  "미정",
  "추후 공지",
  "장소 미정",
  "온라인",
  "기간",
  "일시",
  "시간",
  "운영시간",
  "문의",
  "전화",
  "프로그램",
  "무료",
  "유료",
]);

const isValidVenue = (value: string) => {
  const venue = clean(value).replace(/\s+/g, " ").trim();
  if (venue.length < 2 || venue.length > 120) return false;
  if (invalidVenueLabels.has(venue.toLocaleLowerCase())) return false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(venue)) return false;
  if (
    /^(?:https?:\/\/|www\.)/i.test(venue) ||
    /^(?:[\w-]+\.)+(?:com|net|org|kr|go\.kr|or\.kr)(?:[/:?#]|$)/i.test(
      venue,
    )
  )
    return false;
  if (
    /^(?:\+?82[-. ]?)?0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}$/.test(venue) ||
    /^0\d{8,10}$/.test(venue)
  )
    return false;
  if (
    /^(?:(?:오전|오후)\s*)?\d{1,2}(?::\d{2}|시(?:\s*\d{1,2}분)?)(?:\s*[~∼–-]\s*(?:(?:오전|오후)\s*)?\d{1,2}(?::\d{2}|시(?:\s*\d{1,2}분)?))?$/.test(
      venue,
    )
  )
    return false;
  if (
    explicitDateRange(venue) ||
    /^(?:20\d{2}[.\-/년]\s*)?\d{1,2}(?:월\s*|[.\-/])\s*\d{1,2}(?:일|[.\-/])?$/.test(
      venue,
    )
  )
    return false;
  return true;
};

const firstValidVenue = (...values: Array<string | null>) =>
  values.find((value): value is string => Boolean(value && isValidVenue(value))) ??
  null;

const titleFromBlock = (html: string, text: string) =>
  htmlAttribute(html, "data-title") ??
  classValue(html, "tit_view_sub\\b") ??
  classValue(
    html,
    "(?:reservation-name|title|tit(?:_|\\b)|subject|name\\b|heading(?:-|\\b))",
  ) ??
  definitionValue(html, ["행사명", "축제명", "공연명", "제목"]) ??
  labeledValue(text, ["행사명", "축제명", "공연명", "제목"]);

const venueFromBlock = (html: string, text: string) =>
  firstValidVenue(
    htmlAttribute(html, "data-venue"),
    definitionValue(html, ["행사장", "장소", "위치", "venue", "location"]),
    classPairValue(html, ["행사장", "장소", "위치", "venue", "location"]),
    labeledValue(text, ["행사장", "장소", "위치", "venue", "location"]),
    inlineLabeledValue(text, ["행사장", "장소", "위치", "venue", "location"]),
    classValue(html, "(?:venue|location|place)"),
    metadataVenueFromBlock(html),
  );

const dateFromBlock = (html: string, text: string) => {
  const explicit =
    htmlAttribute(html, "data-date") ??
    classValue(html, "(?:date|period|schedule)") ??
    definitionValue(html, [
      "행사기간",
      "기간",
      "일시",
      "행사일",
      "일자",
      "날짜",
      "date",
    ]) ??
    classPairValue(html, [
      "행사기간",
      "기간",
      "일시",
      "행사일",
      "일자",
      "날짜",
      "date",
    ]) ??
    labeledValue(text, [
      "행사기간",
      "기간",
      "일시",
      "행사일",
      "일자",
      "날짜",
      "date",
    ]);
  // A date remains safe when it is explicitly printed in this one repeated
  // card, even if the card uses a presentational `info`/`desc` class rather
  // than a date-specific one. `explicitDateRange` still rejects year-less
  // values and ambiguous multiple dates.
  return explicitDateRange(explicit ?? text);
};

const categoryFromBlock = (html: string, text: string) =>
  classValue(html, "(?:cate|category|event-type)") ??
  definitionValue(html, ["행사종류", "행사유형", "분류"]) ??
  labeledValue(text, ["행사종류", "행사유형", "분류"]);

const officialUrlFromBlock = (
  source: MunicipalSourceDefinition,
  html: string,
) => {
  const rawHref = /<a\b[^>]*href=["']([^"']+)["']/i.exec(html)?.[1];
  const href = rawHref ? clean(rawHref) : null;
  if (!href) return source.url;
  if (/^(?:javascript:|#)/i.test(href.trim())) return source.url;
  const resolved = absolute(source.url, href);
  return resolved && municipalSourceAllowsUrl(source, resolved)
    ? resolved
    : null;
};

const genericCandidateFromBlock = (
  source: MunicipalSourceDefinition,
  html: string,
): MunicipalCandidate | null => {
  const text = blockText(html);
  const title = titleFromBlock(html, text);
  const dates = dateFromBlock(html, text);
  const venue = venueFromBlock(html, text);
  const category = categoryFromBlock(html, text);
  const official_url = officialUrlFromBlock(source, html);
  if (
    !title ||
    !dates ||
    !venue ||
    !official_url ||
    (source.genericAllowedCategories &&
      (!category ||
        !source.genericAllowedCategories.some((allowed) =>
          category.includes(allowed),
        )))
  )
    return null;
  const rawIdentity = `${official_url}|${title}|${dates.start_date}|${dates.end_date}|${venue}`;
  return {
    source: source.key,
    source_candidate_id: normalizeMunicipalTitle(rawIdentity).slice(0, 120),
    title,
    ...dates,
    region: source.region,
    locality: source.locality,
    venue,
    official_url,
    category: category ?? "공식 HTML 행사",
    snippet: null,
    image_candidate: null,
  };
};

const tableRows = (source: MunicipalSourceDefinition, html: string) => {
  const tables = html.match(/<table\b[\s\S]*?<\/table>/gi) ?? [];
  return tables.flatMap((table) => {
    const rows = table.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
    const header = rows.find((row) => /<th\b/i.test(row));
    const verticalCandidate = genericCandidateFromBlock(source, table);
    if (!header) return verticalCandidate ? [verticalCandidate] : [];
    const labels = [...header.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(
      (cell) => clean(cell[1]),
    );
    const indexFor = (pattern: RegExp) =>
      labels.findIndex((label) => pattern.test(label));
    const titleIndex = indexFor(/행사명|축제명|공연명|제목/);
    const dateIndex = indexFor(/행사기간|기간|일시|행사일|날짜/);
    const startDateIndex = indexFor(/행사?시작일자?|시작일자?/);
    const endDateIndex = indexFor(/행사?종료일자?|종료일자?/);
    const venueIndex = indexFor(/행사장|장소|위치/);
    const categoryIndex = indexFor(/테마|행사종류|행사유형|분류|카테고리/);
    if (titleIndex < 0 || dateIndex < 0 || venueIndex < 0)
      if (
        titleIndex < 0 ||
        venueIndex < 0 ||
        (dateIndex < 0 && (startDateIndex < 0 || endDateIndex < 0))
      )
        return verticalCandidate ? [verticalCandidate] : [];
    const horizontalCandidates = rows.flatMap<MunicipalCandidate>((row) => {
      if (!/<td\b/i.test(row)) return [];
      const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
        (cell) => cell[1],
      );
      if (
        !cells[titleIndex] ||
        !cells[venueIndex] ||
        (dateIndex < 0 && (!cells[startDateIndex] || !cells[endDateIndex])) ||
        (dateIndex >= 0 && !cells[dateIndex])
      )
        return [];
      const title = clean(cells[titleIndex]);
      const dates =
        dateIndex >= 0
          ? explicitDateRange(blockText(cells[dateIndex]))
          : (() => {
              const start = singleExplicitDate(
                blockText(cells[startDateIndex]),
              );
              const end = singleExplicitDate(blockText(cells[endDateIndex]));
              return start && end && validRange(start, end)
                ? { start_date: start, end_date: end }
                : null;
            })();
      const rawVenue = clean(cells[venueIndex]) || null;
      const venue = rawVenue && isValidVenue(rawVenue) ? rawVenue : null;
      const official_url = officialUrlFromBlock(source, cells[titleIndex]);
      const category = categoryIndex >= 0 ? clean(cells[categoryIndex]) : null;
      if (
        !title ||
        !dates ||
        !venue ||
        !official_url ||
        (source.genericAllowedCategories &&
          (!category ||
            !source.genericAllowedCategories.some((allowed) =>
              category.includes(allowed),
            )))
      )
        return [];
      const rawIdentity = `${official_url}|${title}|${dates.start_date}|${dates.end_date}|${venue}`;
      return [
        {
          source: source.key,
          source_candidate_id: normalizeMunicipalTitle(rawIdentity).slice(
            0,
            120,
          ),
          title,
          ...dates,
          region: source.region,
          locality: source.locality,
          venue,
          official_url,
          category: category ?? "공식 HTML 행사",
          snippet: null,
          image_candidate: null,
        },
      ];
    });
    return verticalCandidate
      ? [...horizontalCandidates, verticalCandidate]
      : horizontalCandidates;
  });
};

const elementBlocks = (html: string, tag: string, classPattern?: string) => {
  const opening = new RegExp(
    `<${tag}\\b[^>]*${classPattern ? `class=["'][^"']*${classPattern}[^"']*["']` : ""}[^>]*>`,
    "gi",
  );
  const blocks: string[] = [];
  for (const match of html.matchAll(opening)) {
    const start = match.index ?? 0;
    const tags = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
    tags.lastIndex = start;
    let depth = 0;
    for (let current = tags.exec(html); current; current = tags.exec(html)) {
      depth += current[0].startsWith("</") ? -1 : 1;
      if (depth === 0) {
        blocks.push(html.slice(start, tags.lastIndex));
        break;
      }
    }
  }
  return blocks;
};

/** Reads only repeated, self-contained blocks. It intentionally never joins fields across blocks. */
export function parseGenericMunicipalHtml(
  source: MunicipalSourceDefinition,
  html: string,
): MunicipalCandidate[] {
  const document = html.replace(/<!--[\s\S]*?-->/g, "");
  const tableCandidates = tableRows(source, document);
  const listBlocks = elementBlocks(document, "li");
  const cardBlocks = [
    ...elementBlocks(document, "article", "(?:card|item|event)"),
    ...elementBlocks(document, "div", "(?:card|item|event)"),
    ...elementBlocks(document, "section", "(?:card|item|event)"),
  ];
  const blockCandidates = [...listBlocks, ...cardBlocks]
    .map((block) => genericCandidateFromBlock(source, block))
    .filter((candidate): candidate is MunicipalCandidate => candidate !== null);
  return [
    ...new Map(
      [...tableCandidates, ...blockCandidates].map((candidate) => [
        candidate.source_candidate_id,
        candidate,
      ]),
    ).values(),
  ];
}

/**
 * Reads only a repeated list/card block with an explicit event signal and a
 * first-party detail URL.  This deliberately does not make a candidate from
 * navigation links, and its output must be completed by a detail fetch.
 */
export function parseGenericMunicipalListDetailPartials(
  source: MunicipalSourceDefinition,
  html: string,
): MunicipalListDetailPartial[] {
  if (!source.listDetailFollowup) return [];
  const document = html.replace(/<!--[\s\S]*?-->/g, "");
  const blocks = [
    ...elementBlocks(document, "li"),
    ...elementBlocks(document, "article", "(?:card|item|event)"),
    ...elementBlocks(document, "div", "(?:card|item|event)"),
    ...elementBlocks(document, "section", "(?:card|item|event)"),
  ];
  const partials = blocks.flatMap<MunicipalListDetailPartial>((block) => {
    const text = blockText(block);
    const title = titleFromBlock(block, text);
    const dates = dateFromBlock(block, text);
    const category = categoryFromBlock(block, text);
    const official_url = officialUrlFromBlock(source, block);
    const eventSignal =
      Boolean(dates || category) ||
      /(?:행사명|축제명|공연명|행사기간|기간|일시|축제|페스티벌|공연|전시|문화제)/.test(
        text,
      );
    if (
      !title ||
      !official_url ||
      official_url === source.url ||
      !eventSignal ||
      (source.genericAllowedCategories &&
        (!category ||
          !source.genericAllowedCategories.some((allowed) =>
            category.includes(allowed),
          )))
    )
      return [];
    return [
      {
        source: source.key,
        source_candidate_id: normalizeMunicipalTitle(
          `${official_url}|${title}`,
        ).slice(0, 120),
        title,
        start_date: dates?.start_date ?? null,
        end_date: dates?.end_date ?? null,
        venue: venueFromBlock(block, text),
        region: source.region,
        locality: source.locality,
        official_url,
        category: category ?? "공식 HTML 행사",
        snippet: null,
      },
    ];
  });
  return [
    ...new Map(
      partials.map((partial) => [partial.official_url, partial]),
    ).values(),
  ];
}

/** Parses one official detail document without permitting fields from its list. */
export function parseGenericMunicipalDetail(
  source: MunicipalSourceDefinition,
  html: string,
): MunicipalCandidate | null {
  return genericCandidateFromBlock(source, html);
}

export function parsePajuList(html: string): MunicipalCandidate[] {
  const rows = html.match(/<li>[\s\S]*?<\/li>/gi) ?? [];
  return rows.flatMap<MunicipalCandidate>((row) => {
    const id = /jsCulturalView\((\d+)\)/.exec(row)?.[1];
    const title = clean(
      /<span class="titl">([\s\S]*?)<\/span>/.exec(row)?.[1] ?? "",
    )
      .replace(/^\[[^\]]+\]/, "")
      .trim();
    const info = clean(
      /<span class="list-info">([\s\S]*?)<\/span>/.exec(row)?.[1] ?? "",
    );
    const dates =
      /행사\s*:\s*(20\d{2}-\d{2}-\d{2})\s*~\s*(20\d{2}-\d{2}-\d{2})/.exec(info);
    if (!id || !title || !dates) return [];
    const start_date = dates[1],
      end_date = dates[2];
    const venue =
      /장소\s*:\s*([^비]+?)(?:\s*비용\s*:|$)/.exec(info)?.[1]?.trim() ?? null;
    const image = absolute(
      "https://tour.paju.go.kr",
      /<img[^>]+src="([^"]+)"/i.exec(row)?.[1],
    );
    return [
      {
        source: "paju",
        source_candidate_id: id,
        title,
        start_date,
        end_date,
        venue,
        region: "경기",
        locality: "파주",
        official_url: `https://tour.paju.go.kr/user/link/cultural/BD_selectCulturalView.do?cultMstSn=${id}`,
        category:
          /\[([^\]]+)\]/.exec(
            clean(/<span class="titl">([\s\S]*?)<\/span>/.exec(row)?.[1] ?? ""),
          )?.[1] ?? null,
        snippet:
          clean(
            /<span class="list-con">([\s\S]*?)<\/span>/.exec(row)?.[1] ?? "",
          ) || null,
        image_candidate: image
          ? {
              url: image,
              source_url:
                "https://tour.paju.go.kr/user/link/cultural/BD_index.do",
            }
          : null,
        ...(!validRange(start_date, end_date)
          ? { parse_error: "invalid_date_range" }
          : {}),
      },
    ];
  });
}

export function parseSuwonList(html: string): MunicipalCandidate[] {
  const rows = html.match(/<tr>[\s\S]*?<\/tr>/gi) ?? [];
  return rows.flatMap((row) => {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (match) => match[1],
    );
    if (cells.length < 4) return [];
    const category = clean(cells[0]),
      dates = /(20\d{2}-\d{2}-\d{2})\s*~\s*(20\d{2}-\d{2}-\d{2})/.exec(
        clean(cells[1]),
      );
    const href = /href="([^"]+)"/.exec(cells[2])?.[1];
    const title = clean(cells[2])
      .replace(/재단행사/g, "")
      .trim();
    if (!dates || !href || !title) return [];
    const start_date = dates[1],
      end_date = dates[2];
    const url = absolute("https://www.swcf.or.kr", href)!;
    return [
      {
        source: "suwon",
        source_candidate_id: new URL(url).searchParams.get("idx") ?? url,
        title,
        start_date,
        end_date,
        venue: clean(cells[3]) || null,
        region: "경기",
        locality: "수원",
        official_url: url,
        category: category || null,
        snippet: null,
        image_candidate: null,
        ...(!validRange(start_date, end_date)
          ? { parse_error: "invalid_date_range" }
          : {}),
      },
    ];
  });
}

/** Parses only representative-festival blocks with an explicit calendar year. Recurring dates stay out. */
export function parseGoyangList(html: string): MunicipalCandidate[] {
  const blocks = html.split(/<div\s+class="con_item\b/i).slice(1);
  return blocks.flatMap((block) => {
    const title = clean(/<h3[^>]*>\s*([\s\S]*?)<\/h3>/i.exec(block)?.[1] ?? "");
    const venue =
      clean(
        /(?:장소|장소\s*:)\s*<\/span>\s*<span[^>]*class="text"[^>]*>([\s\S]*?)<\/span>/i.exec(
          block,
        )?.[1] ?? "",
      ) || null;
    const period = clean(
      /(?:기간|일시)\s*:\s*<\/span>\s*<span[^>]*class="text"[^>]*>([\s\S]*?)<\/span>/i.exec(
        block,
      )?.[1] ?? "",
    );
    const first = /(20\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})\./.exec(period);
    const rangeEnd =
      /[~∼-]\s*(?:(20\d{2})\.\s*)?(?:(\d{1,2})\.\s*)?(\d{1,2})\./.exec(period);
    const href = /<a\s+href="([^"]*contents\.do\?key=\d+[^"]*)"/i.exec(
      block,
    )?.[1];
    if (!title || !venue || !first || !rangeEnd || !href) return [];
    const start_date = `${first[1]}-${first[2].padStart(2, "0")}-${first[3].padStart(2, "0")}`;
    const end_date = `${rangeEnd[1] ?? first[1]}-${(rangeEnd[2] ?? first[2]).padStart(2, "0")}-${rangeEnd[3].padStart(2, "0")}`;
    const official_url = absolute(
      "https://goyang.go.kr",
      href.replaceAll("&amp;", "&"),
    );
    const source_candidate_id = new URL(official_url!).searchParams.get("key");
    if (!source_candidate_id) return [];
    const image = absolute(
      "https://goyang.go.kr/visitgoyang/www/",
      /<img[^>]+src="([^"]+)"/i.exec(block)?.[1],
    );
    return [
      {
        source: "goyang",
        source_candidate_id,
        title,
        start_date,
        end_date,
        venue,
        region: "경기",
        locality: "고양",
        official_url: official_url!,
        category: "고양특례시 대표축제",
        snippet:
          clean(/<div class="txt">([\s\S]*?)<\/div>/i.exec(block)?.[1] ?? "") ||
          null,
        image_candidate: image
          ? {
              url: image,
              source_url:
                "https://goyang.go.kr/visitgoyang/www/contents.do?key=595&searchCtgry=1674023925303",
            }
          : null,
        ...(!validRange(start_date, end_date)
          ? { parse_error: "invalid_date_range" }
          : {}),
      },
    ];
  });
}

/** The official city schedule has no individual detail pages; the canonical table is the candidate detail source. */
export function parseHwaseongList(html: string): MunicipalCandidate[] {
  const year = /<h1[^>]*>\s*(20\d{2})년\s+화성시\s+주요\s+축제/i.exec(
    html,
  )?.[1];
  const table =
    /<table[^>]+class="[^"]*listBoard[^"]*"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i.exec(
      html,
    )?.[1];
  if (!year || !table) return [];
  const rows = table.match(/<tr>[\s\S]*?<\/tr>/gi) ?? [];
  return rows.flatMap<MunicipalCandidate>((row) => {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (match) => clean(match[1]),
    );
    if (cells.length < 5) return [];
    const [number, dateText, title, department, venue, host] = cells;
    const start = /(\d{1,2})\.\s*(\d{1,2})\./.exec(dateText);
    const rangeEnd = /[~∼-]\s*(?:(\d{1,2})\.\s*)?(\d{1,2})\./.exec(dateText);
    if (!number || !title || !venue || !/^\d+$/.test(number)) return [];
    const durableId = `${year}-${normalizeMunicipalTitle(title).slice(0, 60)}`;
    if (!start)
      return [
        {
          source: "hwaseong",
          source_candidate_id: durableId,
          title,
          start_date: null,
          end_date: null,
          venue,
          locality: "화성",
          region: "경기",
          official_url: "https://tour.hscity.go.kr/NEW/6festival/festival5.jsp",
          category: department || null,
          snippet: host ? `주최/주관: ${host}` : null,
          image_candidate: null,
          parse_error: "unparseable_date",
        },
      ];
    const toDate = (month: string, day: string) =>
      `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    const start_date = toDate(start[1], start[2]);
    // Korean schedules can omit the end month for a same-month range.
    const end_date = rangeEnd
      ? toDate(rangeEnd[1] ?? start[1], rangeEnd[2])
      : start_date;
    return [
      {
        source: "hwaseong",
        source_candidate_id: durableId,
        title,
        start_date,
        end_date,
        venue,
        locality: "화성",
        region: "경기",
        official_url: "https://tour.hscity.go.kr/NEW/6festival/festival5.jsp",
        category: department || null,
        snippet: host ? `주최/주관: ${host}` : null,
        image_candidate: null,
        ...(!validRange(start_date, end_date)
          ? { parse_error: "invalid_date_range" }
          : {}),
      },
    ];
  });
}

/** Parses Bucheon Festa's official autumn event page. The page is a canonical city-maintained schedule without per-event detail URLs. */
export function parseBucheonAutumnList(html: string): MunicipalCandidate[] {
  const sourceUrl =
    "https://www.bucheon.go.kr/site/homepage/menu/viewMenu?menuid=145007003";
  const year =
    /\b(20\d{2})\s*(?:년|\.)?\s*부천/i.exec(clean(html))?.[1] ??
    /\b(20\d{2})\b/.exec(clean(html))?.[1];
  if (!year) return [];
  const headings = [...html.matchAll(/<h5[^>]*>([\s\S]*?)<\/h5>/gi)];
  return headings.flatMap<MunicipalCandidate>((heading, index) => {
    const title = clean(heading[1] ?? "");
    if (!title) return [];
    const start = (heading.index ?? 0) + heading[0].length;
    const end =
      index + 1 < headings.length
        ? (headings[index + 1].index ?? html.length)
        : html.length;
    const block = clean(html.slice(start, end));
    const period =
      /기\s*간\s*[:：]\s*(\d{1,2})\.\s*(\d{1,2})\.(?:\([^)]*\))?(?:\s*[~∼-]\s*(?:(\d{1,2})\.\s*)?(\d{1,2})\.(?:\([^)]*\))?)?/.exec(
        block,
      );
    const venue =
      /장\s*소\s*[:：]\s*(.+?)(?=\s+(?:주요\s*내용|주요내용)\s*[:：]|$)/
        .exec(block)?.[1]
        ?.trim() ?? null;
    if (!period || !venue) return [];
    const toDate = (month: string, day: string) =>
      `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    const start_date = toDate(period[1], period[2]);
    const end_date = period[4]
      ? toDate(period[3] ?? period[1], period[4])
      : start_date;
    const source_candidate_id = `${year}-${normalizeMunicipalTitle(title).slice(0, 60)}`;
    const snippet =
      /(?:주요\s*내용|주요내용)\s*[:：]\s*(.+)$/.exec(block)?.[1]?.trim() ??
      null;
    return [
      {
        source: "bucheon",
        source_candidate_id,
        title,
        start_date,
        end_date,
        venue,
        region: "경기",
        locality: "부천",
        official_url: sourceUrl,
        category: "부천페스타·가을",
        snippet,
        image_candidate: null,
        ...(!validRange(start_date, end_date)
          ? { parse_error: "invalid_date_range" }
          : {}),
      },
    ];
  });
}

export function parseDaeguSeoMusicSchedule(html: string): MunicipalCandidate[] {
  const marker = '"listMonthly"';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return [];

  const start = html.lastIndexOf("{", markerIndex);
  if (start < 0) return [];

  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }
  if (end < 0) return [];

  let payload: unknown;
  try {
    payload = JSON.parse(html.slice(start, end));
  } catch {
    return [];
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return [];
  const months = (payload as { listMonthly?: unknown }).listMonthly;
  if (!Array.isArray(months)) return [];

  const candidates = months.flatMap<MunicipalCandidate>((day) => {
    if (!day || typeof day !== "object" || Array.isArray(day)) return [];
    const playList = (day as { playList?: unknown }).playList;
    if (!Array.isArray(playList)) return [];
    return playList.flatMap<MunicipalCandidate>((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      const title =
        typeof record.title === "string" ? clean(record.title) : "";
      const venue =
        typeof record.place === "string" ? clean(record.place) || null : null;
      const start_date =
        typeof record.startDate === "string"
          ? /^(20\d{2}-\d{2}-\d{2})/.exec(record.startDate.trim())?.[1] ?? null
          : null;
      const end_date =
        typeof record.endDate === "string"
          ? /^(20\d{2}-\d{2}-\d{2})/.exec(record.endDate.trim())?.[1] ?? start_date
          : start_date;
      if (!title || !venue || !start_date || !end_date) return [];
      const rawId =
        typeof record.idx === "number" || typeof record.idx === "string"
          ? String(record.idx)
          : `${title}|${start_date}|${venue}`;
      return [
        {
          source: "daegu-서",
          source_candidate_id: rawId,
          title,
          start_date,
          end_date,
          venue,
          region: "대구",
          locality: "서구",
          official_url:
            "https://www.dgs.go.kr/music/contents.do?mid=0400000000",
          category:
            typeof record.category === "string"
              ? `비원뮤직홀 category ${record.category}`
              : "비원뮤직홀 공연",
          snippet: null,
          image_candidate: null,
          ...(!validRange(start_date, end_date)
            ? { parse_error: "invalid_date_range" }
            : {}),
        },
      ];
    });
  });

  return [
    ...new Map(
      candidates.map((candidate) => [candidate.source_candidate_id, candidate]),
    ).values(),
  ];
}


export function parseOkcheonFestivalList(html: string): MunicipalCandidate[] {
  const sourceUrl =
    "https://oc.go.kr/tour/selectTnTursmResrceListU.do?key=2529&rcpp=9&sa1=%EC%B6%95%EC%A0%9C%EC%B2%B4%ED%97%98&so1=ORDR";
  return elementBlocks(html, "li", "photo_item").flatMap<MunicipalCandidate>(
    (block) => {
      const title = classValue(block, "info_title") ?? "";
      const venue = classValue(block, "info_item\\s+type1");
      const period = classValue(block, "info_item\\s+type3");
      const dates = period ? explicitDateRange(period) : null;
      const href = /<a\b[^>]*href=["']([^"']+)["']/i.exec(block)?.[1];
      const official_url = href ? absolute(sourceUrl, clean(href)) : null;
      const source_candidate_id = official_url
        ? new URL(official_url).searchParams.get("resrceNo")
        : null;
      if (
        !title ||
        !venue ||
        !dates ||
        !official_url ||
        !source_candidate_id ||
        !isValidVenue(venue)
      )
        return [];
      return [
        {
          source: "chungbuk-옥천",
          source_candidate_id,
          title,
          ...dates,
          venue,
          region: "충북",
          locality: "옥천",
          official_url,
          category: "축제/체험",
          snippet: null,
          image_candidate: null,
        },
      ];
    },
  );
}

export function parseAndongCultureList(html: string): MunicipalCandidate[] {
  const sourceUrl =
    "https://andongculture.com/index.do?menuId=00000235&ordBy=1&pageIndex=1&pageSize=12&progStat=&realmDcd=&searchDiv=&searchTxt=&ym=";
  return elementBlocks(html, "li", "ct_list_li").flatMap<MunicipalCandidate>(
    (block) => {
      const title = classValue(block, "ct_list_subj") ?? "";
      const venue = classValue(block, "ct_list_subtxt");
      const period = classValue(block, "ct_list_date");
      const dates = period ? explicitDateRange(period) : null;
      const category = classValue(block, "ct_list_cat");
      const href =
        /<a\b[^>]*href=["']([^"']*mode=detail[^"']*)["']/i.exec(block)?.[1];
      const official_url = href ? absolute(sourceUrl, clean(href)) : null;
      const source_candidate_id = official_url
        ? new URL(official_url).searchParams.get("clturEventId")
        : null;
      if (
        !title ||
        !venue ||
        !dates ||
        !official_url ||
        !source_candidate_id ||
        !isValidVenue(venue)
      )
        return [];
      return [
        {
          source: "gyeongbuk-안동",
          source_candidate_id,
          title,
          ...dates,
          venue,
          region: "경북",
          locality: "안동",
          official_url,
          category: category ?? "문화행사",
          snippet: null,
          image_candidate: null,
        },
      ];
    },
  );
}

export function parseBusanDongCultureList(html: string): MunicipalCandidate[] {
  const sourceUrl =
    "https://www.bsdonggu.go.kr/tour/board/list.donggu?boardId=BBS_0000336&contentsSid=2300&cpath=%2Ftour&menuCd=DOM_000000312001001000";
  return elementBlocks(html, "li").flatMap<MunicipalCandidate>((block) => {
    const title = clean(/<dt\b[^>]*>([\s\S]*?)<\/dt>/i.exec(block)?.[1] ?? "");
    const period = clean(
      /<li\b[^>]*>\s*<span\b[^>]*>\s*기간\s*<\/span>\s*([\s\S]*?)<\/li>/i.exec(
        block,
      )?.[1] ?? "",
    );
    const venue = clean(
      /<li\b[^>]*>\s*<span\b[^>]*>\s*장소\s*<\/span>\s*([\s\S]*?)<\/li>/i.exec(
        block,
      )?.[1] ?? "",
    );
    const dates = period ? explicitDateRange(period) : null;
    const href = /<a\b[^>]*href=["']([^"']*dataSid=\d+[^"']*)["']/i.exec(
      block,
    )?.[1];
    const official_url = href ? absolute(sourceUrl, clean(href)) : null;
    const source_candidate_id = official_url
      ? new URL(official_url).searchParams.get("dataSid")
      : null;
    if (
      !title ||
      !venue ||
      !dates ||
      !official_url ||
      !source_candidate_id ||
      !isValidVenue(venue)
    )
      return [];
    return [
      {
        source: "busan-동",
        source_candidate_id,
        title,
        ...dates,
        venue,
        region: "부산",
        locality: "동구",
        official_url,
        category: "공연·전시",
        snippet: null,
        image_candidate: null,
      },
    ];
  });
}


export function parseYeongjuCultureCalendar(html: string): MunicipalCandidate[] {
  const sourceUrl =
    "https://www.yeongju.go.kr/open_content/main/page.do?mnu_uid=10617";
  const candidates = elementBlocks(html, "li").flatMap<MunicipalCandidate>(
    (block) => {
      const titleMatch =
        /<p\b[^>]*class=["'][^"']*\btit\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(
          block,
        );
      const href =
        /<a\b[^>]*href=["']([^"']*mon_uid=\d+[^"']*)["']/i.exec(block)?.[1];
      if (!titleMatch || !href) return [];

      const paragraphs = [
        ...block.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi),
      ].map((match) => ({
        attrs: match[1],
        value: clean(match[2]),
      }));
      const titleRaw = clean(titleMatch[1]);
      const categoryMatch = /^\[([^\]]+)\]\s*/.exec(titleRaw);
      const title = titleRaw.replace(/^\[[^\]]+\]\s*/, "").trim();
      const dateEntry = paragraphs.find((entry) => explicitDateRange(entry.value));
      const dates = dateEntry ? explicitDateRange(dateEntry.value) : null;
      const titleIndex = paragraphs.findIndex((entry) =>
        /\btit\b/i.test(entry.attrs),
      );
      const dateIndex = dateEntry ? paragraphs.indexOf(dateEntry) : -1;
      const venue =
        titleIndex >= 0 && dateIndex > titleIndex + 1
          ? paragraphs
              .slice(titleIndex + 1, dateIndex)
              .map((entry) => entry.value)
              .find((value) => isValidVenue(value)) ?? null
          : null;
      const official_url = absolute(sourceUrl, clean(href));
      const source_candidate_id = official_url
        ? new URL(official_url).searchParams.get("mon_uid")
        : null;
      if (
        !title ||
        !venue ||
        !dates ||
        !official_url ||
        !source_candidate_id
      )
        return [];
      return [
        {
          source: "gyeongbuk-영주",
          source_candidate_id,
          title,
          ...dates,
          venue,
          region: "경북",
          locality: "영주",
          official_url,
          category: categoryMatch?.[1] ?? "문화행사",
          snippet: null,
          image_candidate: null,
        },
      ];
    },
  );
  return [
    ...new Map(
      candidates.map((candidate) => [candidate.source_candidate_id, candidate]),
    ).values(),
  ];
}


export function parseHaeundaeAnnualEvents(html: string): MunicipalCandidate[] {
  const sourceUrl =
    "https://www.haeundae.go.kr/index.do?menuCd=DOM_000000104002004000";
  const year =
    /<caption\b[^>]*>[\s\S]*?(20\d{2})년\s*해운대\s*행사\s*캘린더/i.exec(
      html,
    )?.[1] ?? null;
  if (!year) return [];

  const yearlessDates = (value: string) => {
    const text = clean(value);
    const explicit = explicitDateRange(text);
    if (explicit) return explicit;

    const range =
      /^(\d{1,2})\.(\d{1,2})\.\s*~\s*(?:(\d{1,2})\.)?(\d{1,2})\.\s*$/.exec(
        text,
      );
    if (range) {
      const start_date = toExplicitDate(year, range[1], range[2]);
      const end_date = toExplicitDate(
        year,
        range[3] ?? range[1],
        range[4],
      );
      return validRange(start_date, end_date)
        ? { start_date, end_date }
        : null;
    }
    const single = /^(\d{1,2})\.(\d{1,2})\.\s*$/.exec(text);
    if (!single) return null;
    const start_date = toExplicitDate(year, single[1], single[2]);
    return validRange(start_date, start_date)
      ? { start_date, end_date: start_date }
      : null;
  };

  return (html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []).flatMap<MunicipalCandidate>(
    (row) => {
      if (/<th\b[^>]*>\s*행사명\s*<\/th>/i.test(row)) return [];
      const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
        (match) => clean(match[1]),
      );
      if (cells.length < 4) return [];
      const [title, period, venue] = cells;
      const dates = yearlessDates(period);
      if (!title || !dates || !venue || !isValidVenue(venue)) return [];
      return [
        {
          source: "busan-해운대",
          source_candidate_id: normalizeMunicipalTitle(
            title +
              "|" +
              dates.start_date +
              "|" +
              dates.end_date +
              "|" +
              venue,
          ).slice(0, 120),
          title,
          ...dates,
          venue,
          region: "부산",
          locality: "해운대",
          official_url: sourceUrl,
          category: "연간행사",
          snippet: null,
          image_candidate: null,
        },
      ];
    },
  );
}


export function parseGyeongjuCultureList(html: string): MunicipalCandidate[] {
  const sourceUrl =
    "https://www.gyeongju.go.kr/tour/page.do?mnu_uid=4609&listType=list";
  return elementBlocks(html, "dl").flatMap<MunicipalCandidate>((block) => {
    const titleBlock =
      /<p\b[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(
        block,
      )?.[1] ?? "";
    if (!titleBlock) return [];
    const category =
      /<span\b[^>]*>([\s\S]*?)<\/span>/i.exec(titleBlock)?.[1] ?? null;
    const title = clean(titleBlock.replace(/<span\b[\s\S]*?<\/span>/i, " "));
    const period = clean(
      /<li\b[^>]*>\s*<span\b[^>]*>\s*기간\s*<\/span>\s*([\s\S]*?)<\/li>/i.exec(
        block,
      )?.[1] ?? "",
    );
    const venue = clean(
      /<li\b[^>]*>\s*<span\b[^>]*>\s*장소\s*<\/span>\s*([\s\S]*?)<\/li>/i.exec(
        block,
      )?.[1] ?? "",
    );
    const dates = period ? explicitDateRange(period) : null;
    const href =
      /<a\b[^>]*href=["']([^"']*con_uid=\d+[^"']*)["']/i.exec(block)?.[1];
    const official_url = href ? absolute(sourceUrl, clean(href)) : null;
    const source_candidate_id = official_url
      ? new URL(official_url).searchParams.get("con_uid")
      : null;
    if (
      !title ||
      !venue ||
      !dates ||
      !official_url ||
      !source_candidate_id ||
      !isValidVenue(venue)
    )
      return [];
    return [
      {
        source: "gyeongbuk-경주",
        source_candidate_id,
        title,
        ...dates,
        venue,
        region: "경북",
        locality: "경주",
        official_url,
        category: category ? clean(category) : "문화행사",
        snippet: null,
        image_candidate: null,
      },
    ];
  });
}


export function parseUlsanJungCultureSchedule(
  html: string,
): MunicipalCandidate[] {
  const sourceUrl =
    "https://www.junggu.ulsan.kr/tour/index.ulsan?menuCd=DOM_000002208005006002";
  const section =
    /<h4\b[^>]*>\s*공연분과\s*\(\s*(20\d{2})\.\s*(\d{1,2})월\s*\)[\s\S]*?<table\b[^>]*>([\s\S]*?)<\/table>/i.exec(
      html,
    );
  if (!section) return [];

  const year = section[1];
  const tableBody = section[3];
  const rows = elementBlocks("<table>" + tableBody + "</table>", "tr");
  let carried: Record<number, { value: string; left: number }> = {};
  const candidates: MunicipalCandidate[] = [];

  for (const row of rows) {
    const rawCells = [
      ...row.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi),
    ];
    if (!rawCells.length) continue;

    const expanded: string[] = [];
    const newCarry: Record<number, { value: string; left: number }> = {};
    let column = 0;

    for (const cell of rawCells) {
      while (carried[column]) {
        expanded[column] = carried[column].value;
        column += 1;
      }
      const value = clean(cell[2].replace(/<br\s*\/?>/gi, " "));
      expanded[column] = value;
      const rowspan = Number(
        /rowspan\s*=\s*["']?(\d+)/i.exec(cell[1])?.[1] ?? "1",
      );
      if (rowspan > 1)
        newCarry[column] = { value, left: rowspan - 1 };
      column += 1;
    }
    while (column < 6) {
      if (carried[column]) expanded[column] = carried[column].value;
      column += 1;
    }

    const nextCarry: Record<number, { value: string; left: number }> = {};
    for (const [key, value] of Object.entries(carried)) {
      if (value.left > 1)
        nextCarry[Number(key)] = { value: value.value, left: value.left - 1 };
    }
    carried = { ...nextCarry, ...newCarry };

    const title = (expanded[1] ?? "")
      .replace(/^\s*•\s*/, "")
      .replace(/\s*•\s*/g, " / ")
      .trim();
    const dateText = expanded[2] ?? "";
    const venue = expanded[3] ?? "";
    if (!title || /^미정$/i.test(title) || !venue || !isValidVenue(venue))
      continue;

    const monthDays = [
      ...dateText.matchAll(
        /(\d{1,2})\.\s*(\d{1,2})\.\s*(?:\([^)]*\))?/g,
      ),
    ];
    if (!monthDays.length || monthDays.length > 2) continue;
    const start_date = toExplicitDate(
      year,
      monthDays[0][1],
      monthDays[0][2],
    );
    const endMatch = monthDays[1] ?? monthDays[0];
    const end_date = toExplicitDate(year, endMatch[1], endMatch[2]);
    if (!validRange(start_date, end_date)) continue;

    candidates.push({
      source: "ulsan-jung",
      source_candidate_id: normalizeMunicipalTitle(
        title + "|" + start_date + "|" + end_date + "|" + venue,
      ).slice(0, 120),
      title,
      start_date,
      end_date,
      venue,
      region: "울산",
      locality: "중구",
      official_url: sourceUrl,
      category: "공연",
      snippet: null,
      image_candidate: null,
    });
  }

  return [
    ...new Map(
      candidates.map((candidate) => [candidate.source_candidate_id, candidate]),
    ).values(),
  ];
}


export function parsePohangCultureApi(
  body: string,
): MunicipalCandidate[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return [];
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return [];
  const list = (payload as { list?: unknown }).list;
  if (!Array.isArray(list)) return [];

  return list.flatMap<MunicipalCandidate>((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const stringValue = (key: string) =>
      typeof record[key] === "string" ? clean(record[key] as string) : "";

    const eventId = stringValue("event_id");
    const title = stringValue("event_title");
    const start_date =
      /^(20\d{2}-\d{2}-\d{2})/.exec(stringValue("start_date"))?.[1] ?? null;
    const end_date =
      /^(20\d{2}-\d{2}-\d{2})/.exec(stringValue("end_date"))?.[1] ??
      start_date;
    const status = stringValue("event_status").toUpperCase();
    if (status === "CANCELLED" || status === "CANCELED") return [];

    const spaceName = stringValue("space_name");
    const eventVenue = stringValue("event_venue");
    const venue =
      spaceName && spaceName !== "기타"
        ? spaceName
        : eventVenue.includes("포항")
          ? eventVenue
          : "";
    if (
      !eventId ||
      !title ||
      !start_date ||
      !end_date ||
      !validRange(start_date, end_date) ||
      !venue ||
      !isValidVenue(venue)
    )
      return [];

    const eventCategory = stringValue("event_category").toUpperCase();
    const eventField = stringValue("event_field").toUpperCase();
    const contentType = stringValue("content_type").toUpperCase();
    const detailPath =
      contentType === "FESTIVAL"
        ? "/phcf/festival_detail/view.do?festivalId=" +
          encodeURIComponent(eventId)
        : eventCategory === "REGION" && eventField === "FESTIVAL"
          ? "/phcf/region_detail/view.do?eventId=" +
            encodeURIComponent(eventId) +
            "&menu_site_id=region_detail"
          : "/phcf/performance_detail/view.do?eventId=" +
            encodeURIComponent(eventId) +
            "&menu_site_id=performance_detail";
    const official_url = absolute(
      "https://www.phcf.or.kr",
      detailPath,
    );
    if (!official_url) return [];

    const category =
      contentType === "FESTIVAL" || eventField === "FESTIVAL"
        ? "축제"
        : eventCategory === "PERFORMANCE"
          ? "공연"
          : eventCategory === "EXHIBITION"
            ? "전시"
            : eventCategory === "EDUCATION"
              ? "교육"
              : eventCategory === "EVENT"
                ? "행사"
                : "기타";
    const rawSummary = stringValue("event_summary");

    return [
      {
        source: "gyeongbuk-포항",
        source_candidate_id: eventId,
        title,
        start_date,
        end_date,
        venue,
        region: "경북",
        locality: "포항",
        official_url,
        category,
        snippet: rawSummary ? rawSummary.slice(0, 280) : null,
        image_candidate: null,
      },
    ];
  });
}


export function parsePocheonHomepageEvents(html: string): MunicipalCandidate[] {
  const sourceUrl = "https://www.pcfac.or.kr/";
  const rowValue = (block: string, label: string) =>
    clean(
      new RegExp(
        "<tr\\b[^>]*>\\s*<td\\b[^>]*>\\s*" +
          label +
          "\\s*<\\/td>\\s*<td\\b[^>]*>([\\s\\S]*?)<\\/td>\\s*<\\/tr>",
        "i",
      ).exec(block)?.[1] ?? "",
    );

  return elementBlocks(html, "li", "mainBx").flatMap<MunicipalCandidate>(
    (block) => {
      const title = classValue(block, "performtit") ?? "";
      const period = rowValue(block, "일자");
      const venue = rowValue(block, "장소");
      const category = rowValue(block, "장르") || null;
      const dates = period ? explicitDateRange(period) : null;
      const route =
        /onclick=["'][^"']*location\.href\s*=\s*['"]([^'"]+)['"]/i.exec(
          block,
        )?.[1] ?? null;
      const official_url = route ? absolute(sourceUrl, clean(route)) : null;
      const source_candidate_id = official_url
        ? new URL(official_url).searchParams.get("uid")
        : null;
      if (
        !title ||
        !dates ||
        !venue ||
        !isValidVenue(venue) ||
        !official_url ||
        !source_candidate_id ||
        !official_url.startsWith("https://www.pcfac.or.kr/")
      )
        return [];
      return [
        {
          source: "gyeonggi-포천",
          source_candidate_id,
          title,
          ...dates,
          venue,
          region: "경기",
          locality: "포천",
          official_url,
          category,
          snippet: null,
          image_candidate: null,
        },
      ];
    },
  );
}


export function parseGeojeMonthlyEvents(html: string): MunicipalCandidate[] {
  const sourceUrl =
    "https://geoje.go.kr/board/list.geoje?boardId=FESTIVAL&contentsSid=8213&menuCd=DOM_000008504014001000";
  const pageYear =
    /(?:^|[>\s])(20\d{2})년\s*\d{1,2}월\s*행사일정표/i.exec(html)?.[1] ??
    /(?:^|[>\s])(20\d{2})년\s*\d{1,2}월/i.exec(html)?.[1] ??
    null;
  if (!pageYear) return [];

  const table =
    (html.match(/<table\b[\s\S]*?<\/table>/gi) ?? []).find((candidate) => {
      const text = clean(candidate);
      return (
        /축제\/행사\/공연명/.test(text) &&
        /장소/.test(text) &&
        /기간/.test(text)
      );
    }) ?? null;
  if (!table) return [];

  const rows = table.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  const header = rows.find((row) => /<th\b/i.test(row));
  if (!header) return [];
  const labels = [...header.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(
    (cell) => clean(cell[1]),
  );
  const titleIndex = labels.findIndex((label) =>
    /축제\/행사\/공연명|행사명|공연명|축제명/.test(label),
  );
  const venueIndex = labels.findIndex((label) => /장소/.test(label));
  const periodIndex = labels.findIndex((label) => /기간/.test(label));
  if (titleIndex < 0 || venueIndex < 0 || periodIndex < 0) return [];

  const shortYear = pageYear.slice(2);
  return rows.flatMap<MunicipalCandidate>((row) => {
    if (!/<td\b/i.test(row)) return [];
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (cell) => cell[1],
    );
    if (!cells[titleIndex] || !cells[venueIndex] || !cells[periodIndex])
      return [];

    const titleRaw = clean(cells[titleIndex]);
    const category = /^\[([^\]]+)\]\s*/.exec(titleRaw)?.[1] ?? null;
    const title = titleRaw.replace(/^\[[^\]]+\]\s*/, "").trim();
    const venue = clean(cells[venueIndex]);
    const period = clean(cells[periodIndex]);
    const range =
      /^(\d{2})\.(\d{1,2})\.(\d{1,2})\s*~\s*(\d{2})\.(\d{1,2})\.(\d{1,2})$/.exec(
        period,
      );
    if (
      !title ||
      !venue ||
      !isValidVenue(venue) ||
      !range ||
      range[1] !== shortYear ||
      range[4] !== shortYear
    )
      return [];

    const start_date = toExplicitDate(pageYear, range[2], range[3]);
    const end_date = toExplicitDate(pageYear, range[5], range[6]);
    if (!validRange(start_date, end_date)) return [];

    const href = /<a\b[^>]*href=["']([^"']+)["']/i.exec(
      cells[titleIndex],
    )?.[1];
    const resolved =
      href && !/^(?:javascript:|#)/i.test(href)
        ? absolute(sourceUrl, clean(href))
        : null;
    const official_url =
      resolved &&
      /^https:\/\/(?:[^/]+\.)?geoje\.go\.kr\//i.test(resolved)
        ? resolved
        : sourceUrl;
    const source_candidate_id =
      (official_url !== sourceUrl
        ? new URL(official_url).searchParams.get("dataSid") ||
          new URL(official_url).searchParams.get("idx") ||
          new URL(official_url).searchParams.get("seq")
        : null) ??
      normalizeMunicipalTitle(
        title + "|" + start_date + "|" + end_date + "|" + venue,
      ).slice(0, 120);

    return [
      {
        source: "gyeongnam-거제",
        source_candidate_id,
        title,
        start_date,
        end_date,
        venue,
        region: "경남",
        locality: "거제",
        official_url,
        category,
        snippet: null,
        image_candidate: null,
      },
    ];
  });
}

export function selectMunicipalGate(candidate: MunicipalCandidate): {
  gate: SelectionGate;
  reason: string;
} {
  if (
    candidate.parse_error ||
    !candidate.start_date ||
    !candidate.end_date ||
    !candidate.venue
  )
    return {
      gate: "REVIEW",
      reason: candidate.parse_error ?? "missing_required_field",
    };
  const text = `${candidate.title} ${candidate.category ?? ""} ${candidate.snippet ?? ""}`;
  const education =
    /평생학습|교육|강좌|수강|모집|워크숍|설명회|세미나|포럼|성과공유|기념식|회원.?전용|온라인|대관|기관행사|행정|회의|간담회|협의회|위원회|심의회|업무|훈련|점검|보고회|출범|순방|임명|기탁식|협약(?:식)?|개소식/.test(
      text,
    );
  const outing =
    /거리축제|불꽃|드론쇼|야시장|퍼레이드|능행차|꽃|계절|야간개장|미디어아트|체험.{0,40}(공연|먹거리)|(공연|먹거리).{0,40}체험/.test(
      text,
    );
  if (education && !outing)
    return {
      gate: "EXCLUDE",
      reason: "education_or_admin_without_outing_evidence",
    };
  if (
    /축제|페스티벌|문화제|미디어아트|야행|거리축제|북앤컬처|능행차/.test(text)
  )
    return {
      gate: "MAIN",
      reason: "explicit_public_festival_or_destination_event",
    };
  if (/제\s*\d+회.*가요제|가요제.*제\s*\d+회/.test(text))
    return { gate: "MAIN", reason: "recurring_public_song_festival" };
  if (
    /뮤지컬|(?:토크|커피)?콘서트|연주회|독창회|독주회|오페라|발레|무용공연|연극|전시|개인전|회원(?:작품)?전|작가(?:회)?전|아트페어/.test(
      text,
    )
  )
    return {
      gate: "MAIN",
      reason: "explicit_public_culture_event",
    };
  if (/공연|음악회|연극|합창|가요제/.test(text))
    return {
      gate: "NEARBY_ONLY",
      reason: "single_public_culture_event_without_destination_signal",
    };
  return { gate: "REVIEW", reason: "deterministic_rules_not_conclusive" };
}

export type EnrichmentCandidate = {
  summary: string | null;
  operating_hours: { start_time: string; end_time: string } | null;
  programs: Array<{ name: string; schedule_text: string }>;
  parse_error?: string;
};

/** Only explicit machine-readable detail facts can contradict list core facts; absence is not conflict. */
export function hasMunicipalDetailCoreConflict(
  candidate: MunicipalCandidate,
  detailHtml: string,
): boolean {
  const text = clean(detailHtml);
  const years = [...text.matchAll(/\b(20\d{2})[.년-]/g)].map(
    (match) => match[1],
  );
  if (
    years.length &&
    candidate.start_date &&
    years.every((year) => year !== candidate.start_date!.slice(0, 4))
  )
    return true;
  const detailDates = [
    ...text.matchAll(/\b(20\d{2})[-.]\s*(\d{1,2})[-.]\s*(\d{1,2})/g),
  ].map(
    (match) =>
      `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`,
  );
  if (
    detailDates.length &&
    candidate.start_date &&
    !detailDates.includes(candidate.start_date) &&
    !detailDates.includes(candidate.end_date ?? "")
  )
    return true;
  const venue = /(?:행사장|장소)\s*[:：]\s*([^\n]{2,80})/
    .exec(text)?.[1]
    ?.trim();
  return Boolean(
    venue &&
    candidate.venue &&
    !venue.includes(candidate.venue) &&
    !candidate.venue.includes(venue),
  );
}

export function createEnrichmentCandidate(
  candidate: MunicipalCandidate,
  detailHtml: string,
): EnrichmentCandidate {
  const text = clean(detailHtml);
  if (
    !normalizeMunicipalTitle(text).includes(
      normalizeMunicipalTitle(candidate.title),
    )
  )
    return {
      summary: null,
      operating_hours: null,
      programs: [],
      parse_error: "detail_title_mismatch",
    };
  const summary = candidate.snippet ? candidate.snippet.slice(0, 280) : null;
  const hours =
    /(?:운영\s*시간|운영시간|행사\s*시간)\s*[:：]?\s*(\d{1,2}:\d{2})\s*[~∼-]\s*(\d{1,2}:\d{2})/.exec(
      text,
    );
  return {
    summary,
    operating_hours: hours
      ? {
          start_time: hours[1].padStart(5, "0"),
          end_time: hours[2].padStart(5, "0"),
        }
      : null,
    programs: [],
  };
}

export const MUNICIPAL_PARSERS: Partial<
  Record<string, (html: string) => MunicipalCandidate[]>
> = {
  paju: parsePajuList,
  suwon: parseSuwonList,
  goyang: parseGoyangList,
  hwaseong: parseHwaseongList,
  bucheon: parseBucheonAutumnList,
  "daegu-서": parseDaeguSeoMusicSchedule,
  "chungbuk-옥천": parseOkcheonFestivalList,
  "gyeongbuk-안동": parseAndongCultureList,
  "busan-동": parseBusanDongCultureList,
  "gyeongbuk-영주": parseYeongjuCultureCalendar,
  "busan-해운대": parseHaeundaeAnnualEvents,
  "gyeongbuk-경주": parseGyeongjuCultureList,
  "ulsan-jung": parseUlsanJungCultureSchedule,
  "gyeongbuk-포항": parsePohangCultureApi,
  "gyeonggi-포천": parsePocheonHomepageEvents,
  "gyeongnam-거제": parseGeojeMonthlyEvents,
};

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const jsonLdEventNodes = (value: unknown): JsonRecord[] => {
  if (Array.isArray(value)) return value.flatMap(jsonLdEventNodes);
  const record = asRecord(value);
  if (!record) return [];
  const type = record["@type"];
  const types = Array.isArray(type) ? type : [type];
  const self = types.some((entry) => entry === "Event") ? [record] : [];
  const graph = jsonLdEventNodes(record["@graph"]);
  return [...self, ...graph];
};

const structuredDate = (value: unknown) => {
  if (typeof value !== "string") return null;
  return /^(20\d{2}-\d{2}-\d{2})(?:T|$)/.exec(value.trim())?.[1] ?? null;
};

const structuredVenue = (value: unknown): string | null => {
  if (typeof value === "string") return clean(value) || null;
  const location = asRecord(value);
  if (!location) return null;
  if (typeof location.name === "string") return clean(location.name) || null;
  if (typeof location.address === "string")
    return clean(location.address) || null;
  const address = asRecord(location.address);
  if (!address) return null;
  for (const key of ["name", "streetAddress"]) {
    if (typeof address[key] === "string" && clean(address[key] as string))
      return clean(address[key] as string);
  }
  return null;
};

const officialStructuredUrl = (
  source: MunicipalSourceDefinition,
  value: unknown,
) => {
  if (typeof value !== "string" || !value.trim()) return source.url;
  try {
    const resolved = new URL(value, source.url).toString();
    return municipalSourceAllowsUrl(source, resolved) ? resolved : source.url;
  } catch {
    return source.url;
  }
};

export function parseStructuredMunicipalEvents(
  source: MunicipalSourceDefinition,
  html: string,
): MunicipalCandidate[] {
  const scripts = [
    ...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  const nodes: JsonRecord[] = [];
  for (const script of scripts) {
    try {
      nodes.push(...jsonLdEventNodes(JSON.parse(script[1].trim())));
    } catch {
      // Malformed JSON-LD is not trusted as event evidence.
    }
  }

  return nodes.flatMap<MunicipalCandidate>((node) => {
    const title = typeof node.name === "string" ? clean(node.name) : "";
    if (!title) return [];
    const start_date = structuredDate(node.startDate);
    const end_date = structuredDate(node.endDate);
    const venue = structuredVenue(node.location);
    const official_url = officialStructuredUrl(source, node.url ?? node["@id"]);
    const rawIdentity =
      typeof node["@id"] === "string"
        ? node["@id"]
        : typeof node.url === "string"
          ? node.url
          : `${title}-${start_date ?? "unknown"}`;
    const source_candidate_id =
      normalizeMunicipalTitle(String(rawIdentity)).slice(0, 80) ||
      normalizeMunicipalTitle(title).slice(0, 60);
    const snippet =
      typeof node.description === "string"
        ? clean(node.description).slice(0, 280) || null
        : null;
    const missingCore = !start_date || !end_date || !venue;
    return [
      {
        source: source.key,
        source_candidate_id,
        title,
        start_date,
        end_date,
        region: source.region,
        locality: source.locality,
        venue,
        official_url,
        category: "구조화 공식행사",
        snippet,
        image_candidate: null,
        ...(missingCore
          ? { parse_error: "structured_event_missing_core" }
          : !validRange(start_date, end_date)
            ? { parse_error: "invalid_date_range" }
            : {}),
      },
    ];
  });
}

export function extractMunicipalCandidates(
  source: MunicipalSourceDefinition,
  html: string,
): {
  mode: "registered" | "structured_event" | "generic_html" | "retry";
  candidates: MunicipalCandidate[];
  partialCandidates?: MunicipalListDetailPartial[];
  assessment: ReturnType<typeof assessMunicipalSourceDocument>;
} {
  const assessment = assessMunicipalSourceDocument(source, html);
  const parser = MUNICIPAL_PARSERS[source.key];
  if (
    source.ingestion === "registered_parser" &&
    parser &&
    assessment.status === "healthy"
  )
    return {
      mode: "registered",
      candidates: parser(html),
      assessment,
    };

  if (assessment.observedSignals.includes("structured_event")) {
    const candidates = parseStructuredMunicipalEvents(source, html);
    if (candidates.length)
      return { mode: "structured_event", candidates, assessment };
  }

  if (
    source.ingestion === "generic_fallback" &&
    assessment.observedSignals.some(
      (signal) =>
        signal === "html_table" ||
        signal === "html_list" ||
        signal === "html_cards",
    )
  ) {
    const candidates = parseGenericMunicipalHtml(source, html);
    const partialCandidates = parseGenericMunicipalListDetailPartials(
      source,
      html,
    );
    if (candidates.length || partialCandidates.length)
      return {
        mode: "generic_html",
        candidates,
        partialCandidates,
        assessment,
      };
  }

  // PDF/image signals are intentionally detected but not guessed from here.
  // The municipal worker may pass them to its existing verified document fallback.
  return { mode: "retry", candidates: [], assessment };
}
