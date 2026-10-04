import { extractOfficialPageImageCandidates } from "./official-page-image-candidates";

export type MunicipalRichHours = {
  start_time: string;
  end_time: string | null;
  human_time_text: string;
};

export type MunicipalRichImage = {
  url: string;
  alt: string | null;
};

export type MunicipalRichProgram = {
  name: string;
  description: string | null;
  schedule_text: string | null;
};

export type MunicipalRichDetail = {
  summary: string | null;
  operating_hours: MunicipalRichHours[];
  price_text: string | null;
  contact_phone: string | null;
  images: MunicipalRichImage[];
  programs: MunicipalRichProgram[];
};

const BLOCK_END = /<\/(?:p|div|li|dd|dt|tr|td|th|section|article|h[1-6])\s*>/gi;

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lsquo;/gi, "‘")
    .replace(/&rsquo;/gi, "’")
    .replace(/&ldquo;/gi, "“")
    .replace(/&rdquo;/gi, "”")
    .replace(/&hellip;/gi, "…")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

export function municipalRichText(html: string) {
  return decodeHtml(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
      .replace(BLOCK_END, "\n")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const compact = (value: string) =>
  municipalRichText(value).replace(/\s+/g, " ").trim();

const normalizedLabel = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s:：|·ㆍ]/g, "")
    .toLocaleLowerCase();

type Pair = { label: string; value: string };
type HeadingEntry = {
  level: number;
  title: string;
  start: number;
  end: number;
};
type RichParseContext = {
  text: string;
  pairs: Pair[];
  headings: HeadingEntry[];
};

function explicitPairs(html: string): Pair[] {
  const pairs: Pair[] = [];

  const dl =
    /<dt\b[^>]*>([\s\S]*?)<\/dt\s*>\s*<dd\b[^>]*>([\s\S]*?)<\/dd\s*>/gi;
  for (const match of html.matchAll(dl))
    pairs.push({ label: compact(match[1]), value: compact(match[2]) });

  const rows = html.match(/<tr\b[\s\S]*?<\/tr\s*>/gi) ?? [];
  for (const row of rows) {
    const cells = [
      ...row.matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi),
    ].map((match) => ({
      tag: match[1].toLowerCase(),
      text: compact(match[2]),
    }));
    for (let index = 0; index < cells.length - 1; index += 1) {
      if (cells[index].tag === "th" && cells[index + 1].tag === "td") {
        const label = cells[index].text;
        const value = cells[index + 1].text;
        if (label && value) pairs.push({ label, value });
      }
    }
    if (
      cells.length >= 2 &&
      cells[0].tag !== "th" &&
      cells[0].text &&
      cells[1].text
    )
      pairs.push({
        label: cells[0].text,
        value: cells
          .slice(1)
          .map((cell) => cell.text)
          .join(" "),
      });
  }

  const strongRows =
    html.match(/<(?:li|p|div)\b[^>]*>[\s\S]*?<\/(?:li|p|div)\s*>/gi) ?? [];
  for (const row of strongRows) {
    const label =
      /<(?:strong|b|em|span)\b[^>]*>([\s\S]*?)<\/(?:strong|b|em|span)\s*>/i.exec(
        row,
      )?.[1];
    if (!label) continue;
    const labelText = compact(label);
    const rowText = compact(row);
    const value = rowText.startsWith(labelText)
      ? rowText.slice(labelText.length).replace(/^\s*[:：|]?\s*/, "")
      : "";
    if (labelText && value) pairs.push({ label: labelText, value });
  }

  return pairs;
}

function firstPairValue(context: RichParseContext, labels: readonly string[]) {
  const wanted = new Set(labels.map(normalizedLabel));
  for (const pair of context.pairs)
    if (wanted.has(normalizedLabel(pair.label))) return pair.value;
  return null;
}

function headingEntries(html: string) {
  const rows: HeadingEntry[] = [];
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi;
  for (const match of html.matchAll(re))
    rows.push({
      level: Number(match[1]),
      title: compact(match[2]),
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  return rows;
}

const genericHeadings =
  /^(?:상세내용|상세 내용|행사소개|행사 소개|행사내용|행사 내용|행사개요|행사 개요|프로그램|주요 프로그램|세부 프로그램|행사일정|행사 일정|안내 및 문의|행사위치목록|행사 위치)$/;

function sectionText(
  html: string,
  headings: readonly HeadingEntry[],
  titles: RegExp,
  minimumLength = 30,
): string | null {
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    if (!titles.test(heading.title)) continue;
    const next = headings
      .slice(index + 1)
      .find((candidate) => candidate.level <= heading.level);
    const body = municipalRichText(
      html.slice(heading.end, next?.start ?? html.length),
    )
      .replace(/\n{2,}/g, "\n")
      .trim();
    if (body.length >= minimumLength) return body.slice(0, 900);
  }
  return null;
}

const exhibitionSummaryLabel =
  /^(?:전시서문|전시\s*소개|전시\s*개요|전시\s*안내)$/u;
const metadataProgramLabel =
  /^(?:관람\s*시간|운영\s*시간|공연\s*시간|이용\s*시간|대표\s*전화|문의|문의\s*전화|연락처|전화|기간|일시|장소|요금|입장료|관람료|주최|주관|후원)$/u;

type RichBreakChunk = {
  text: string;
  bold: boolean;
  start: number;
  end: number;
};

function breakChunks(html: string): RichBreakChunk[] {
  const output: RichBreakChunk[] = [];
  const re = /([^<]*(?:<(?!br\b)[^>]*>[^<]*)*)<br\s*\/?\s*>/gi;
  let cursor = 0;
  for (const match of html.matchAll(re)) {
    const start = match.index ?? 0;
    const raw = match[1];
    output.push({
      text: compact(raw),
      bold: /<(?:b|strong|h[1-6])\b|font-weight\s*:\s*bold/i.test(raw),
      start,
      end: start + match[0].length,
    });
    cursor = start + match[0].length;
  }
  if (cursor < html.length)
    output.push({
      text: compact(html.slice(cursor)),
      bold: /<(?:b|strong|h[1-6])\b|font-weight\s*:\s*bold/i.test(
        html.slice(cursor),
      ),
      start: cursor,
      end: html.length,
    });
  return output;
}

function detailContentHtml(html: string) {
  const marker =
    /<div\b[^>]*class=["'][^"']*\bdetail_view_area\b[^"']*["'][^>]*>/i.exec(
      html,
    );
  if (!marker) return html;
  const contentStart = (marker.index ?? 0) + marker[0].length;
  const tags = /<\/?div\b[^>]*>/gi;
  let depth = 1;
  for (const match of html.slice(contentStart).matchAll(tags)) {
    const tag = match[0];
    if (/^<\//.test(tag)) depth -= 1;
    else if (!/\/\s*>$/.test(tag)) depth += 1;
    if (depth === 0)
      return html.slice(contentStart, contentStart + (match.index ?? 0));
  }
  return html.slice(contentStart);
}

function labelledExhibitionSection(
  html: string,
  labels: RegExp,
  minimumLength = 30,
) {
  const chunks = breakChunks(html);
  for (let index = 0; index < chunks.length; index += 1) {
    const current = chunks[index];
    if (!labels.test(current.text.replace(/^[|｜_\s]+|[|｜_\s]+$/g, "")))
      continue;
    const content: string[] = [];
    for (let next = index + 1; next < chunks.length; next += 1) {
      const chunk = chunks[next];
      if (chunk.bold && chunk.text && !/^[_|｜]+$/.test(chunk.text)) break;
      if (chunk.text && !/^[_|｜]+$/.test(chunk.text)) content.push(chunk.text);
    }
    const value = content
      .join("\n")
      .replace(/\n{2,}/g, "\n")
      .trim();
    if (value.length >= minimumLength) return value.slice(0, 900);
  }
  return null;
}

function metaContent(html: string, key: string) {
  const escaped = key.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  const patterns = [
    new RegExp(
      "<meta\\b[^>]*(?:property|name)=[\"']" +
        escaped +
        "[\"'][^>]*content=[\"']([^\"']+)[\"'][^>]*>",
      "i",
    ),
    new RegExp(
      "<meta\\b[^>]*content=[\"']([^\"']+)[\"'][^>]*(?:property|name)=[\"']" +
        escaped +
        "[\"'][^>]*>",
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const value = pattern.exec(html)?.[1];
    if (value) return compact(value);
  }
  return null;
}

function extractSummary(html: string, context: RichParseContext) {
  const exhibition = labelledExhibitionSection(
    detailContentHtml(html),
    exhibitionSummaryLabel,
  );
  if (exhibition) return exhibition;
  const section = sectionText(
    html,
    context.headings,
    /^(?:상세내용|상세 내용|행사소개|행사 소개|행사내용|행사 내용|행사개요|행사 개요|개요|주요내용|주요 내용|행사안내|행사 안내|소개|전시서문|전시\s*소개|전시\s*개요|전시\s*안내)$/,
  );
  if (section) return section;
  // Site-wide meta descriptions are frequently present on municipal detail
  // pages. Without an explicitly labelled event-content section, treating one
  // as an event introduction creates unsupported copy in the public UI.
  return null;
}

function normalizeTime(hour: string, minute: string) {
  return hour.padStart(2, "0") + ":" + minute.padStart(2, "0");
}

function extractOperatingHours(
  context: RichParseContext,
): MunicipalRichHours[] {
  const labels = [
    "시간",
    "행사시간",
    "운영시간",
    "공연시간",
    "관람시간",
    "이용시간",
    "일시",
  ] as const;
  const fallback =
    /(?:^|\n)\s*(?:시간|행사시간|운영시간|공연시간|관람시간|이용시간|일시)\s*[:：]?\s*([^\n]{1,240})/i.exec(
      context.text,
    )?.[1] ?? null;
  const labelledLine = context.text
    .split("\n")
    .map((line) => line.trim())
    .find(
      (line) =>
        /(?:일\s*시|행사\s*시간|운영\s*시간|공연\s*시간|관람\s*시간|이용\s*시간)\s*[:：]/i.test(
          line,
        ) &&
        /(?:[01]?\d|2[0-3]):[0-5]\d\s*(?:~|∼|～|-)\s*(?:[01]?\d|2[0-3]):[0-5]\d/.test(
          line,
        ),
    );
  const raw =
    (
      firstPairValue(context, labels) ??
      fallback ??
      labelledLine ??
      null
    )?.replace(/([01]?\d|2[0-3]):\s+(\d{2})/g, "$1:$2") ?? null;
  if (!raw) return [];

  const ranges = [
    ...raw.matchAll(
      /(?:^|[^0-9])([01]?\d|2[0-3]):([0-5]\d)\s*(?:~|∼|～|-)\s*([01]?\d|2[0-3]):([0-5]\d)/g,
    ),
  ];
  if (ranges.length)
    return ranges.slice(0, 6).map((match) => ({
      start_time: normalizeTime(match[1], match[2]),
      end_time: normalizeTime(match[3], match[4]),
      human_time_text: raw.slice(0, 240),
    }));

  const korean = [
    ...raw.matchAll(
      /(?:(오전|오후)\s*)?(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?\s*(?:~|∼|～|-)\s*(?:(오전|오후)\s*)?(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/g,
    ),
  ];
  if (korean.length)
    return korean.slice(0, 6).flatMap((match) => {
      const convert = (
        period: string | undefined,
        hourText: string,
        minuteText?: string,
      ) => {
        let hour = Number(hourText);
        const minute = Number(minuteText ?? "0");
        if (period === "오후" && hour < 12) hour += 12;
        if (period === "오전" && hour === 12) hour = 0;
        if (
          !Number.isInteger(hour) ||
          hour < 0 ||
          hour > 23 ||
          !Number.isInteger(minute) ||
          minute < 0 ||
          minute > 59
        )
          return null;
        return normalizeTime(String(hour), String(minute));
      };
      const start = convert(match[1], match[2], match[3]);
      const end = convert(match[4] ?? match[1], match[5], match[6]);
      return start && end
        ? [
            {
              start_time: start,
              end_time: end,
              human_time_text: raw.slice(0, 240),
            },
          ]
        : [];
    });

  const single = /(?:^|[^0-9])([01]?\d|2[0-3]):([0-5]\d)(?:[^0-9]|$)/.exec(raw);
  return single
    ? [
        {
          start_time: normalizeTime(single[1], single[2]),
          end_time: null,
          human_time_text: raw.slice(0, 240),
        },
      ]
    : [];
}

function extractPhone(context: RichParseContext) {
  const labels = [
    "문의처",
    "문의하기",
    "문의",
    "전화",
    "연락처",
    "대표전화",
    "문의전화",
  ] as const;
  const fallback =
    /(?:^|\n)\s*(?:문의처|문의하기|문의|전화|연락처|대표전화|문의전화)\s*[:：]?\s*([^\n]{1,160})/i.exec(
      context.text,
    )?.[1] ?? null;
  const raw = firstPairValue(context, labels) ?? fallback;
  if (!raw) return null;
  const normal = /\b(?:02|0[3-6][1-5])[-.\s]?\d{3,4}[-.\s]?\d{4}\b/.exec(
    raw,
  )?.[0];
  if (normal) return normal.replace(/[.\s]+/g, "-");
  const mobile = /\b01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b/.exec(raw)?.[0];
  if (mobile) return mobile.replace(/[.\s]+/g, "-");
  const short = /(?:^|\s)(\d{3,4})(?:\s|$)/.exec(raw)?.[1];
  return short ?? null;
}

function extractPrice(context: RichParseContext) {
  const labels = [
    "이용요금",
    "이용료",
    "요금",
    "관람료",
    "입장료",
    "참가비",
    "참가료",
    "비용",
  ] as const;
  const fallback =
    /(?:^|\n)\s*(?:이용요금|이용료|요금|관람료|입장료|참가비|참가료|비용)\s*[:：]?\s*([^\n]{1,220})/i.exec(
      context.text,
    )?.[1] ?? null;
  return firstPairValue(context, labels) ?? fallback;
}

function absoluteHttps(pageUrl: string, raw: string) {
  try {
    const value = new URL(decodeHtml(raw), pageUrl);
    return value.protocol === "https:" ? value.toString() : null;
  } catch {
    return null;
  }
}

const decorativeImage =
  /(?:^|[\/_-])(?:logo|icon|ico|sprite|spacer|blank|captcha|sns|facebook|instagram|youtube|naver|kakao|favicon|noimg|no_image|default_img|all_menu|menu_show|btn)(?:[\/_\-.]|$)/i;

function extractImages(pageUrl: string, html: string): MunicipalRichImage[] {
  const pageHost = new URL(pageUrl).hostname;
  const output: MunicipalRichImage[] = [];
  const seen = new Set<string>();
  const add = (
    raw: string | null | undefined,
    alt: string | null,
    force = false,
  ) => {
    if (!raw) return;
    const url = absoluteHttps(pageUrl, raw);
    if (!url || seen.has(url)) return;
    const parsed = new URL(url);
    if (
      !force &&
      parsed.hostname !== pageHost &&
      !parsed.hostname.endsWith("." + pageHost)
    )
      return;
    if (
      decorativeImage.test(parsed.pathname) ||
      /\/inc\/img\/common\//i.test(parsed.pathname) ||
      (alt && decorativeImage.test(alt))
    )
      return;
    seen.add(url);
    output.push({ url, alt: alt ? compact(alt).slice(0, 160) : null });
  };

  add(metaContent(html, "og:image"), null, true);

  for (const candidate of extractOfficialPageImageCandidates(
    pageUrl,
    html,
    10,
  )) {
    const eventImageSignal =
      candidate.signal !== "IMG" ||
      /(?:\/comm\/getImage\b|\/data\/editor\/|\/file\/down\b|\/uploads?\/|poster|festival|event)/i.test(
        candidate.url,
      ) ||
      /(?:포스터|행사|축제|공연|전시|뮤지컬)/i.test(candidate.alt ?? "");
    if (!eventImageSignal) continue;
    add(candidate.url, candidate.alt, true);
    if (output.length >= 5) return output.slice(0, 5);
  }

  for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = match[1];
    const src =
      /\bsrc=["']([^"']+)["']/i.exec(attrs)?.[1] ??
      /\bdata-src=["']([^"']+)["']/i.exec(attrs)?.[1] ??
      /\bdata-original=["']([^"']+)["']/i.exec(attrs)?.[1] ??
      /\bdata-lazy-src=["']([^"']+)["']/i.exec(attrs)?.[1];
    const alt = /\balt=["']([^"']*)["']/i.exec(attrs)?.[1] ?? null;
    const width = Number(/\bwidth=["']?(\d+)/i.exec(attrs)?.[1] ?? 0);
    const height = Number(/\bheight=["']?(\d+)/i.exec(attrs)?.[1] ?? 0);
    if ((width && width < 140) || (height && height < 100)) continue;
    add(src, alt);
    if (output.length >= 5) break;
  }
  return output.slice(0, 5);
}

function programMarker(title: string) {
  return /(?:프로그램|공연.*체험|체험.*공연|세부.*일정|주요.*내용|세계.*문화)/.test(
    title,
  );
}

export function municipalEventTimeOnlyLabel(value: string) {
  return /^[\s□▪•·◦*\-–—]*(?:일\s*시|행사\s*시간|운영\s*시간|공연\s*시간|관람\s*시간|이용\s*시간|기간)\s*[:：]/u.test(
    value,
  );
}

function extractPrograms(
  html: string,
  context: RichParseContext,
): MunicipalRichProgram[] {
  const headings = context.headings;
  const output: MunicipalRichProgram[] = [];
  const seen = new Set<string>();

  const addProgram = (nameValue: string, descriptionValue: string) => {
    const name = nameValue.replace(/^[|｜*•·▪◦\-–—\s]+/, "").trim();
    const description = descriptionValue
      .replace(/\n{2,}/g, "\n")
      .trim()
      .slice(0, 700);
    if (
      !name ||
      name.length < 2 ||
      name.length > 100 ||
      !description ||
      genericHeadings.test(name) ||
      metadataProgramLabel.test(name) ||
      /^(?:프로그램|전시연계\s*프로그램|주요\s*프로그램|세부\s*프로그램)$/u.test(
        name,
      ) ||
      municipalEventTimeOnlyLabel(name) ||
      /^(?:평일|주말|토요일|일요일|공휴일)(?:\s|$)/u.test(name) ||
      seen.has(name)
    )
      return;
    seen.add(name);
    const timeText =
      description
        .match(
          /(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*(?:~|∼|～|-|–)\s*(?:[01]?\d|2[0-3]):[0-5]\d)?/g,
        )
        ?.join(", ") ?? null;
    output.push({ name, description, schedule_text: timeText });
  };

  const chunks = breakChunks(detailContentHtml(html));
  for (let index = 0; index < chunks.length; index += 1) {
    const section = chunks[index];
    const title = section.text.replace(/^[|｜_\s]+|[|｜_\s]+$/g, "");
    if (!section.bold || !programMarker(title)) continue;
    const details: string[] = [];
    for (let next = index + 1; next < chunks.length; next += 1) {
      const chunk = chunks[next];
      if (chunk.bold && chunk.text && !/^[_|｜]+$/.test(chunk.text)) break;
      if (chunk.text && !/^[_|｜]+$/.test(chunk.text)) details.push(chunk.text);
    }
    if (details.length) addProgram(title, details.join("\n"));
  }

  for (let index = 0; index < headings.length; index += 1) {
    const section = headings[index];
    if (!programMarker(section.title)) continue;
    const sectionEnd =
      headings
        .slice(index + 1)
        .find((candidate) => candidate.level <= section.level)?.start ??
      html.length;
    const children = headings.filter(
      (candidate) =>
        candidate.start > section.end &&
        candidate.start < sectionEnd &&
        candidate.level > section.level,
    );
    for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
      const child = children[childIndex];
      const name = child.title.trim();
      if (
        !name ||
        name.length < 2 ||
        name.length > 100 ||
        genericHeadings.test(name) ||
        municipalEventTimeOnlyLabel(name) ||
        /^(?:시간|운영\s*시간|행사\s*시간|공연\s*시간|관람\s*시간|이용\s*시간|기간|일시|차량\s*통제)$/u.test(
          name,
        ) ||
        seen.has(name) ||
        metadataProgramLabel.test(name) ||
        /^(?:평일|주말|토요일|일요일|공휴일)(?:\s|$)/u.test(name)
      )
        continue;
      const nextStart = children[childIndex + 1]?.start ?? sectionEnd;
      const description = municipalRichText(html.slice(child.end, nextStart))
        .replace(/\n{2,}/g, "\n")
        .trim()
        .slice(0, 700);
      if (!description) continue;
      addProgram(name, description);
      if (output.length >= 8) return output;
    }
  }

  if (!output.length) {
    for (const line of context.text.split("\n").map((value) => value.trim())) {
      if (!line || line.length > 180) continue;
      const schedule =
        line
          .match(
            /(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*(?:~|∼|～|-)\s*(?:[01]?\d|2[0-3]):[0-5]\d)?/g,
          )
          ?.join(", ") ?? null;
      if (!schedule) continue;
      const firstTime = line.search(/(?:[01]?\d|2[0-3]):[0-5]\d/);
      const name = firstTime > 1 ? line.slice(0, firstTime).trim() : "";
      if (
        !name ||
        name.length < 2 ||
        name.length > 100 ||
        genericHeadings.test(name) ||
        municipalEventTimeOnlyLabel(name) ||
        seen.has(name) ||
        metadataProgramLabel.test(name) ||
        /^(?:평일|주말|토요일|일요일|공휴일)(?:\s|$)/u.test(name)
      )
        continue;
      addProgram(name, line);
      if (output.length >= 8) break;
    }
  }
  return output;
}

export function extractMunicipalRichDetail(
  pageUrl: string,
  html: string,
): MunicipalRichDetail {
  // Rich municipal detail pages can be large. Build the expensive whole-page
  // text/pair/heading views once and share them across field extractors instead
  // of rescanning the same HTML for every field.
  const context: RichParseContext = {
    text: municipalRichText(html),
    pairs: explicitPairs(html),
    headings: headingEntries(html),
  };
  return {
    summary: extractSummary(html, context),
    operating_hours: extractOperatingHours(context),
    price_text: extractPrice(context),
    contact_phone: extractPhone(context),
    images: extractImages(pageUrl, html),
    programs: extractPrograms(html, context),
  };
}
