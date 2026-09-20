import { normalizeMunicipalTitle } from "./municipal-duplicate";

export type SelectionGate = "MAIN" | "NEARBY_ONLY" | "EXCLUDE" | "REVIEW";
export type MunicipalCandidate = {
  source: "paju" | "suwon";
  source_candidate_id: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  region: "경기";
  venue: string | null;
  official_url: string;
  category: string | null;
  snippet: string | null;
  image_candidate: { url: string; source_url: string } | null;
  parse_error?: string;
};

const clean = (value: string) => value
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&(?:nbsp|#160);/gi, " ")
  .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
  .replace(/&(?:#039|apos);/gi, "'").replace(/&quot;/gi, '"')
  .replace(/&amp;/gi, "&")
  .replace(/\s+/g, " ").trim();
const absolute = (base: string, value: string | undefined) => value ? new URL(value, base).toString() : null;
const validRange = (start: string, end: string) => /^20\d{2}-\d{2}-\d{2}$/.test(start) && /^20\d{2}-\d{2}-\d{2}$/.test(end) && start <= end;

export function parsePajuList(html: string): MunicipalCandidate[] {
  const rows = html.match(/<li>[\s\S]*?<\/li>/gi) ?? [];
  return rows.flatMap((row) => {
    const id = /jsCulturalView\((\d+)\)/.exec(row)?.[1];
    const title = clean(/<span class="titl">([\s\S]*?)<\/span>/.exec(row)?.[1] ?? "").replace(/^\[[^\]]+\]/, "").trim();
    const info = clean(/<span class="list-info">([\s\S]*?)<\/span>/.exec(row)?.[1] ?? "");
    const dates = /행사\s*:\s*(20\d{2}-\d{2}-\d{2})\s*~\s*(20\d{2}-\d{2}-\d{2})/.exec(info);
    if (!id || !title || !dates) return [];
    const start_date = dates[1], end_date = dates[2];
    const venue = /장소\s*:\s*([^비]+?)(?:\s*비용\s*:|$)/.exec(info)?.[1]?.trim() ?? null;
    const image = absolute("https://tour.paju.go.kr", /<img[^>]+src="([^"]+)"/i.exec(row)?.[1]);
    return [{
      source: "paju", source_candidate_id: id, title, start_date, end_date, venue,
      region: "경기", official_url: `https://tour.paju.go.kr/user/link/cultural/BD_selectCulturalView.do?cultMstSn=${id}`,
      category: /\[([^\]]+)\]/.exec(clean(/<span class="titl">([\s\S]*?)<\/span>/.exec(row)?.[1] ?? ""))?.[1] ?? null,
      snippet: clean(/<span class="list-con">([\s\S]*?)<\/span>/.exec(row)?.[1] ?? "") || null,
      image_candidate: image ? { url: image, source_url: "https://tour.paju.go.kr/user/link/cultural/BD_index.do" } : null,
      ...(!validRange(start_date, end_date) ? { parse_error: "invalid_date_range" } : {}),
    }];
  });
}

export function parseSuwonList(html: string): MunicipalCandidate[] {
  const rows = html.match(/<tr>[\s\S]*?<\/tr>/gi) ?? [];
  return rows.flatMap((row) => {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    if (cells.length < 4) return [];
    const category = clean(cells[0]), dates = /(20\d{2}-\d{2}-\d{2})\s*~\s*(20\d{2}-\d{2}-\d{2})/.exec(clean(cells[1]));
    const href = /href="([^"]+)"/.exec(cells[2])?.[1];
    const title = clean(cells[2]).replace(/재단행사/g, "").trim();
    if (!dates || !href || !title) return [];
    const start_date = dates[1], end_date = dates[2];
    const url = absolute("https://www.swcf.or.kr", href)!;
    return [{
      source: "suwon", source_candidate_id: new URL(url).searchParams.get("idx") ?? url,
      title, start_date, end_date, venue: clean(cells[3]) || null, region: "경기", official_url: url,
      category: category || null, snippet: null, image_candidate: null,
      ...(!validRange(start_date, end_date) ? { parse_error: "invalid_date_range" } : {}),
    }];
  });
}

export function selectMunicipalGate(candidate: MunicipalCandidate): { gate: SelectionGate; reason: string } {
  if (candidate.parse_error || !candidate.start_date || !candidate.end_date || !candidate.venue)
    return { gate: "REVIEW", reason: candidate.parse_error ?? "missing_required_field" };
  const text = `${candidate.title} ${candidate.category ?? ""} ${candidate.snippet ?? ""}`;
  if (/교육|강좌|모집|워크숍|설명회|회원.?전용|온라인|대관|상영 프로그램/.test(text)) return { gate: "EXCLUDE", reason: "education_or_recruitment_or_facility_program" };
  if (/축제|페스티벌|문화제|미디어아트|야행|거리축제|북앤컬처/.test(text)) return { gate: "MAIN", reason: "explicit_public_festival_or_destination_event" };
  if (/제\s*\d+회.*가요제|가요제.*제\s*\d+회/.test(text)) return { gate: "MAIN", reason: "recurring_public_song_festival" };
  if (/공연|음악회|연극|합창|가요제/.test(text)) return { gate: "NEARBY_ONLY", reason: "single_public_culture_event_without_destination_signal" };
  return { gate: "REVIEW", reason: "deterministic_rules_not_conclusive" };
}

export type EnrichmentCandidate = {
  summary: string | null;
  operating_hours: { start_time: string; end_time: string } | null;
  programs: Array<{ name: string; schedule_text: string }>;
  parse_error?: string;
};

export function createEnrichmentCandidate(candidate: MunicipalCandidate, detailHtml: string): EnrichmentCandidate {
  const text = clean(detailHtml);
  if (!normalizeMunicipalTitle(text).includes(normalizeMunicipalTitle(candidate.title)))
    return { summary: null, operating_hours: null, programs: [], parse_error: "detail_title_mismatch" };
  const summary = candidate.snippet ? candidate.snippet.slice(0, 280) : null;
  const hours = /(?:운영\s*시간|운영시간|행사\s*시간)\s*[:：]?\s*(\d{1,2}:\d{2})\s*[~∼-]\s*(\d{1,2}:\d{2})/.exec(text);
  const programMatches = [...text.matchAll(/(?:공연|상영|프로그램)\s*[:：]?\s*([^\n]{0,80}?\d{1,2}:\d{2}(?:\s*[~∼-]\s*\d{1,2}:\d{2})?)/g)];
  return {
    summary,
    operating_hours: hours ? { start_time: hours[1].padStart(5, "0"), end_time: hours[2].padStart(5, "0") } : null,
    programs: programMatches.slice(0, 4).map((match, index) => ({ name: `공식 프로그램 ${index + 1}`, schedule_text: match[1].trim() })),
  };
}
