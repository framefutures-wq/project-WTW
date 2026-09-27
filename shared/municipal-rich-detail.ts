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
    .replace(/&#(\d+);/g, (_match, code) =>
      String.fromCodePoint(Number(code)),
    )
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
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const compact = (value: string) =>
  municipalRichText(value).replace(/\s+/g, " ").trim();

const normalizedLabel = (value: string) =>
  compact(value).replace(/[\s:：|·ㆍ]/g, "").toLocaleLowerCase();

type Pair = { label: string; value: string };

function explicitPairs(html: string): Pair[] {
  const pairs: Pair[] = [];

  const dl = /<dt\b[^>]*>([\s\S]*?)<\/dt\s*>\s*<dd\b[^>]*>([\s\S]*?)<\/dd\s*>/gi;
  for (const match of html.matchAll(dl))
    pairs.push({ label: compact(match[1]), value: compact(match[2]) });

  const rows = html.match(/<tr\b[\s\S]*?<\/tr\s*>/gi) ?? [];
  for (const row of rows) {
    const cells = [
      ...row.matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi),
    ].map((match) => compact(match[2]));
    if (cells.length >= 2 && cells[0] && cells[1])
      pairs.push({ label: cells[0], value: cells.slice(1).join(" ") });
  }

  const strongRows =
    html.match(
      /<(?:li|p|div)\b[^>]*>[\s\S]*?<\/(?:li|p|div)\s*>/gi,
    ) ?? [];
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

function firstPairValue(html: string, labels: readonly string[]) {
  const wanted = new Set(labels.map(normalizedLabel));
  for (const pair of explicitPairs(html))
    if (wanted.has(normalizedLabel(pair.label))) return pair.value;
  return null;
}

function headingEntries(html: string) {
  const rows: Array<{
    level: number;
    title: string;
    start: number;
    end: number;
  }> = [];
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
  titles: RegExp,
  minimumLength = 30,
): string | null {
  const headings = headingEntries(html);
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

function metaContent(html: string, key: string) {
  const escaped = key.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  const patterns = [
    new RegExp(
      '<meta\\b[^>]*(?:property|name)=["\']' +
        escaped +
        '["\'][^>]*content=["\']([^"\']+)["\'][^>]*>',
      "i",
    ),
    new RegExp(
      '<meta\\b[^>]*content=["\']([^"\']+)["\'][^>]*(?:property|name)=["\']' +
        escaped +
        '["\'][^>]*>',
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const value = pattern.exec(html)?.[1];
    if (value) return compact(value);
  }
  return null;
}

function extractSummary(html: string) {
  const section = sectionText(
    html,
    /^(?:상세내용|상세 내용|행사소개|행사 소개|행사내용|행사 내용|소개)$/,
  );
  if (section) return section;
  const meta =
    metaContent(html, "og:description") ?? metaContent(html, "description");
  return meta && meta.length >= 30 ? meta.slice(0, 900) : null;
}

function normalizeTime(hour: string, minute: string) {
  return hour.padStart(2, "0") + ":" + minute;
}

function extractOperatingHours(html: string): MunicipalRichHours[] {
  const raw = firstPairValue(html, [
    "시간",
    "행사시간",
    "운영시간",
    "공연시간",
    "관람시간",
    "일시",
  ]);
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

  const single = /(?:^|[^0-9])([01]?\d|2[0-3]):([0-5]\d)(?:[^0-9]|$)/.exec(
    raw,
  );
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

function extractPhone(html: string) {
  const raw = firstPairValue(html, [
    "문의처",
    "문의",
    "전화",
    "연락처",
    "대표전화",
  ]);
  if (!raw) return null;
  const normal = /\b(?:02|0[3-6][1-5])[-.\s]?\d{3,4}[-.\s]?\d{4}\b/.exec(
    raw,
  )?.[0];
  if (normal) return normal.replace(/[.\s]+/g, "-");
  const short = /(?:^|\s)(\d{3,4})(?:\s|$)/.exec(raw)?.[1];
  return short ?? null;
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
  /(?:^|[\/_-])(?:logo|icon|ico|sprite|spacer|blank|captcha|sns|facebook|instagram|youtube|naver|kakao)(?:[\/_\-.]|$)/i;

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
      (alt && decorativeImage.test(alt))
    )
      return;
    seen.add(url);
    output.push({ url, alt: alt ? compact(alt).slice(0, 160) : null });
  };

  add(metaContent(html, "og:image"), null, true);

  for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = match[1];
    const src = /\bsrc=["']([^"']+)["']/i.exec(attrs)?.[1];
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

function extractPrograms(html: string): MunicipalRichProgram[] {
  const headings = headingEntries(html);
  const output: MunicipalRichProgram[] = [];
  const seen = new Set<string>();

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
        seen.has(name)
      )
        continue;
      const nextStart = children[childIndex + 1]?.start ?? sectionEnd;
      const description = municipalRichText(
        html.slice(child.end, nextStart),
      )
        .replace(/\n{2,}/g, "\n")
        .trim()
        .slice(0, 700);
      if (!description) continue;
      const timeText =
        description.match(
          /(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*(?:~|∼|～|-)\s*(?:[01]?\d|2[0-3]):[0-5]\d)?/g,
        )?.join(", ") ?? null;
      seen.add(name);
      output.push({
        name,
        description,
        schedule_text: timeText,
      });
      if (output.length >= 8) return output;
    }
  }
  return output;
}

export function extractMunicipalRichDetail(
  pageUrl: string,
  html: string,
): MunicipalRichDetail {
  return {
    summary: extractSummary(html),
    operating_hours: extractOperatingHours(html),
    price_text: firstPairValue(html, [
      "이용요금",
      "이용료",
      "요금",
      "관람료",
      "입장료",
      "참가비",
      "참가료",
      "비용",
    ]),
    contact_phone: extractPhone(html),
    images: extractImages(pageUrl, html),
    programs: extractPrograms(html),
  };
}
