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
