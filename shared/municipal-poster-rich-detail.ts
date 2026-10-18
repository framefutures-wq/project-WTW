import type { MunicipalRichDetail } from "./municipal-rich-detail";

type VerifiedCore = {
  title: string;
  start_date: string;
  end_date: string;
  venue: string;
};

const compact = (value: string) =>
  value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

function posterDates(text: string) {
  return [...text.matchAll(/(20\d{2})\s*(?:[.\/-]|년)\s*(\d{1,2})\s*(?:[.\/-]|월)\s*(\d{1,2})/gu)]
    .map((match) => `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`);
}

export function posterMatchesVerifiedEvent(text: string, event: VerifiedCore) {
  const dates = posterDates(text);
  if (!dates.includes(event.start_date) && !dates.includes(event.end_date))
    return false;
  const normalized = compact(text);
  const quotedTitle = /[「“"]([^」”"]{4,})[」”"]/.exec(event.title)?.[1];
  const titleKey = compact(quotedTitle ?? event.title)
    .replace(/20\d{2}/g, "")
    .replace(/^제\d+회/, "")
    .replace(/개최$/, "");
  const titleMatch = titleKey.length >= 6 && normalized.includes(titleKey);
  const venueKey = compact(event.venue.split(/[（(]/)[0]).slice(0, 11);
  const venueMatch = venueKey.length >= 6 && normalized.includes(venueKey);
  return titleMatch || venueMatch;
}

const lineText = (value: string) =>
  value.replace(/^\s*(?:#{1,6}\s*|[•·▪◦*\-–—]\s*)/, "")
    .replace(/\*\*/g, "")
    .trim();

// OCR preserves poster layout as lines, so a program card's explanatory copy
// can follow its heading without punctuation. Keep only concise title-like
// lines and reject Korean connective/sentence fragments.
const posterProgramProse = /(?:의|과|와|에서|으로|에게|하는|펼쳐지는|즐길\s*수|다채로운|풍성한|누구나|프로그램|참여업소|소비영수증|선착순|경품|볼거리|만남|인증하면|제출\s*시)$/u;

const isExplicitPosterProgramName = (line: string) =>
  !posterProgramProse.test(line) &&
  !/[,:：]/u.test(line) &&
  !/^\S+\s+(?:에서|으로|에게|하는|펼쳐지는|즐길|다채로운|풍성한|누구나)/u.test(line);

export function parseMunicipalPosterRichDetail(text: string): MunicipalRichDetail {
  const lines = text.replace(/\r/g, "").split("\n").map(lineText).filter(Boolean);
  const result: MunicipalRichDetail = {
    summary: null,
    operating_hours: [],
    price_text: null,
    contact_phone: null,
    images: [],
    programs: [],
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1] ?? "";
    if (/^(?:행사\s*소개|축제\s*소개|행사\s*개요)\s*[:：]?$/u.test(line)) {
      if (next.length >= 30 && /[.!。다요]$/u.test(next))
        result.summary = next.slice(0, 900);
    }
    const timeLine = line + " " + next;
    if (
      !result.operating_hours.length &&
      (/(?:일\s*시|행사\s*시간|운영\s*시간)\s*[:：]/u.test(line) ||
        posterDates(timeLine).length > 0)
    ) {
      const range = /([01]?\d|2[0-3]):([0-5]\d)\s*(?:~|∼|～|-|–)\s*([01]?\d|2[0-3]):([0-5]\d)/u.exec(timeLine);
      if (range)
        result.operating_hours.push({
          start_time: `${range[1].padStart(2, "0")}:${range[2]}`,
          end_time: `${range[3].padStart(2, "0")}:${range[4]}`,
          human_time_text: range[0],
        });
    }
    const phone = /^(?:문의|문의처|연락처)\s*[:：|]\s*((?:02|0[3-6][1-5])[-.\s]?\d{3,4}[-.\s]?\d{4})/u.exec(line);
    if (phone) result.contact_phone = phone[1].replace(/[.\s]/g, "-");
    const price = /^(?:입장료|참가비|이용료|요금)\s*[:：]\s*(.{1,100})$/u.exec(line);
    if (price) result.price_text = price[1].trim();
  }

  let inPrograms = false;
  const seen = new Set<string>();
  const organizationLabels = /^(?:(?:주최(?:기관)?|주관(?:기관)?|후원|협찬|운영(?:\s*기관)?|문의처?|연락처)(?:\s*[·ㆍ/|]\s*(?:주최(?:기관)?|주관(?:기관)?|후원|협찬|운영(?:\s*기관)?|문의처?|연락처))*)\s*(?:[|:：\-–—]\s*|\s|$)/u;
  for (const line of lines) {
    if (/^(?:주요\s*)?(?:프로그램(?:\s*안내)?|행사\s*내용|주요\s*내용)\s*[:：]?$/u.test(line)) {
      inPrograms = true;
      continue;
    }
    if (!inPrograms) continue;
    // QR-related instructions and organizer/contact metadata are individual
    // non-program rows. Continue scanning because valid program names may
    // follow them in the OCR reading order.
    if (/QR/iu.test(line) || organizationLabels.test(line) ||
      /^(?:장소|일\s*시|시간|행사\s*개요|오시는\s*길)(?:\s|[:：|]|$)/u.test(line))
      continue;
    if (
      line.length < 2 || line.length > 32 ||
      /\d{1,2}:\d{2}|20\d{2}[.\/-]|[:：]|[.!。]/u.test(line) ||
      !isExplicitPosterProgramName(line) ||
      seen.has(line)
    ) continue;
    seen.add(line);
    result.programs.push({ name: line, description: null, schedule_text: null });
    if (result.programs.length >= 8) break;
  }
  return result;
}
