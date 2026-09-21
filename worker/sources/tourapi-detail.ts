import { koreaDate } from "../../shared/domain";
import { assessCost } from "../../shared/cost-status";
import { TOUR_API_DOC, text, tourApiRequest, type TourApiRow } from "./tourapi";
import type { Env } from "../env";

export const MAX_DETAIL_EVENTS_PER_RUN = 25;
export const MAX_TOURAPI_DETAIL_REQUESTS_PER_RUN = 75;
export const DETAIL_REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DETAIL_ENDPOINTS = ["detailCommon2", "detailIntro2", "detailInfo2"] as const;
const GENERIC_DESCRIPTION = "한국관광공사 TourAPI에 등록된 행사입니다.";
type Candidate = {
  id: string; title: string; venue: string; address: string; start_date: string; end_date: string;
  summary_priority: number | null; venue_priority: number | null; price_priority: number | null;
  programs_priority: number | null; hours_priority: number | null; failure_count: number | null;
};
type DetailPayload = { common: TourApiRow; intro: TourApiRow; info: TourApiRow[] };
type DetailResult = { candidates: number; requested: number; enriched: number; empty: number; failed: number };

function cleanText(value: unknown) {
  return text(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}
function usefulOverview(value: unknown) {
  const summary = cleanText(value);
  return summary && !summary.startsWith(GENERIC_DESCRIPTION) ? summary : null;
}
function wholeEventHours(value: unknown) {
  const match = cleanText(value).match(/^(?:운영시간\s*[:：]?\s*)?((?:[01]\d|2[0-3]):[0-5]\d)\s*(?:~|∼|-)\s*((?:[01]\d|2[0-3]):[0-5]\d)$/);
  return match ? { start: match[1], end: match[2] } : null;
}
function stableProgram(row: TourApiRow, eventId: string) {
  const serial = text(row.serialnum);
  const name = cleanText(row.infoname);
  const description = cleanText(row.infotext);
  // detailInfo2 is usually category prose (for example 행사소개/행사내용), not a schedule.
  // Only an explicitly typed, individually named program can become a program row.
  if (!/^\d{1,8}$/.test(serial) || !name || !description || /^(행사소개|행사내용|프로그램|기타)$/u.test(name) || cleanText(row.fldgubun) !== "프로그램") return null;
  return { id: `${eventId}-tourapi-program-${serial}`, name, description, sort: Number(serial) };
}
function detailSourceId(eventId: string) { return `${eventId}-detail`; }
function allowed(priority: number | null) { return priority === null || priority >= 3; }
function excerpt(field: string, value: string) { return `${field}=${value}`.slice(0, 1000); }

export async function selectTourApiDetailCandidates(db: D1Database, now = new Date(), limit = MAX_DETAIL_EVENTS_PER_RUN) {
  const today = koreaDate(now);
  const until = new Date(`${today}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + 30);
  const ttl = new Date(now.getTime() - DETAIL_REFRESH_TTL_MS).toISOString();
  const rows = await db.prepare(
    `SELECT e.id,e.title,e.venue,e.address,e.start_date,e.end_date,
      (SELECT MIN(s.priority) FROM event_enrichments en JOIN sources s ON s.id=en.source_id WHERE en.event_id=e.id) AS summary_priority,
      (SELECT MIN(s.priority) FROM event_evidence ev JOIN sources s ON s.id=ev.source_id WHERE ev.event_id=e.id AND ev.field='venue') AS venue_priority,
      (SELECT MIN(s.priority) FROM event_evidence ev JOIN sources s ON s.id=ev.source_id WHERE ev.event_id=e.id AND ev.field='price') AS price_priority,
      (SELECT MIN(s.priority) FROM event_programs p JOIN sources s ON s.id=p.source_id WHERE p.event_id=e.id) AS programs_priority,
      (SELECT MIN(s.priority) FROM event_operating_hours h JOIN sources s ON s.id=h.source_id WHERE h.event_id=e.id) AS hours_priority,
      ds.failure_count
     FROM events e JOIN sources ps ON ps.id=e.primary_source_id
     LEFT JOIN tourapi_detail_state ds ON ds.event_id=e.id
     WHERE e.is_sample=0 AND e.verification='verified' AND ps.kind='tourapi'
       AND e.end_date>=? AND e.start_date<=?
       AND (ds.last_success_at IS NULL OR ds.last_success_at<?)
       AND (ds.next_retry_at IS NULL OR ds.next_retry_at<=?)
     ORDER BY CASE WHEN e.start_date<=? THEN 0 ELSE 1 END,e.start_date,e.id LIMIT ?`,
  ).bind(today, until.toISOString().slice(0, 10), ttl, now.toISOString(), today, limit).all<Candidate>();
  return rows.results;
}

async function fetchPayload(key: string, contentId: string) {
  const common = await tourApiRequest(key, "detailCommon2", { contentId, numOfRows: "1", pageNo: "1" });
  const intro = await tourApiRequest(key, "detailIntro2", { contentId, contentTypeId: "15", numOfRows: "1", pageNo: "1" });
  const info = await tourApiRequest(key, "detailInfo2", { contentId, contentTypeId: "15", numOfRows: "20", pageNo: "1" });
  for (const result of [common, intro, info])
    if (result.items.some((row) => text(row.contentid) !== contentId || text(row.contenttypeid) !== "15"))
      throw new Error("TourAPI detail content_id_mismatch");
  if (common.items.length > 1 || intro.items.length > 1 || info.total > 20)
    throw new Error("TourAPI detail response exceeds bound");
  return { common: common.items[0] ?? {}, intro: intro.items[0] ?? {}, info: info.items } satisfies DetailPayload;
}

async function saveSuccess(db: D1Database, candidate: Candidate, payload: DetailPayload, checkedAt: string) {
  const sourceId = detailSourceId(candidate.id);
  const contentId = candidate.id.slice("tourapi-".length);
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload) VALUES(?,'tourapi',3,'한국관광공사 TourAPI 상세',?,?,?)
      ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at,raw_payload=excluded.raw_payload`)
      .bind(sourceId, TOUR_API_DOC, checkedAt, JSON.stringify(payload)),
  ];
  let changed = 0;
  const summary = usefulOverview(payload.common.overview);
  if (summary && allowed(candidate.summary_priority)) {
    statements.push(db.prepare(`INSERT INTO event_enrichments(event_id,summary,source_id,evidence_excerpt,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(event_id) DO UPDATE SET summary=excluded.summary,source_id=excluded.source_id,evidence_excerpt=excluded.evidence_excerpt,updated_at=excluded.updated_at
      WHERE (SELECT priority FROM sources WHERE id=event_enrichments.source_id)>=3`).bind(candidate.id, summary, sourceId, excerpt("overview", summary), checkedAt));
    changed++;
  }
  const venue = cleanText(payload.intro.eventplace);
  if (venue && candidate.venue === candidate.address && allowed(candidate.venue_priority)) {
    statements.push(db.prepare("UPDATE events SET venue=?,updated_at=? WHERE id=? AND venue=address").bind(venue, checkedAt, candidate.id));
    statements.push(db.prepare("INSERT INTO event_evidence(event_id,source_id,field,excerpt,checked_at) VALUES(?,?,?,?,?) ON CONFLICT(event_id,source_id,field) DO UPDATE SET excerpt=excluded.excerpt,checked_at=excluded.checked_at").bind(candidate.id, sourceId, "venue", excerpt("eventplace", venue), checkedAt));
    changed++;
  }
  const fee = cleanText(payload.intro.usetimefestival);
  const assessed = assessCost(fee || null, Number(candidate.start_date.slice(0, 4)));
  if (fee && assessed.status !== "unknown" && allowed(candidate.price_priority)) {
    statements.push(db.prepare("UPDATE events SET cost=?,price_text=?,updated_at=? WHERE id=?").bind(assessed.status, fee, checkedAt, candidate.id));
    statements.push(db.prepare("INSERT INTO event_evidence(event_id,source_id,field,excerpt,checked_at) VALUES(?,?,?,?,?) ON CONFLICT(event_id,source_id,field) DO UPDATE SET excerpt=excluded.excerpt,checked_at=excluded.checked_at").bind(candidate.id, sourceId, "price", excerpt("usetimefestival", fee), checkedAt));
    changed++;
  }
  const hours = wholeEventHours(payload.intro.playtime);
  if (hours && allowed(candidate.hours_priority)) {
    statements.push(db.prepare(`INSERT INTO event_operating_hours(id,event_id,start_date,end_date,start_time,end_time,human_time_text,sort_order,source_id,evidence_excerpt) VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(event_id,start_date,end_date,sort_order) DO UPDATE SET start_time=excluded.start_time,end_time=excluded.end_time,human_time_text=excluded.human_time_text,source_id=excluded.source_id,evidence_excerpt=excluded.evidence_excerpt`)
      .bind(`${candidate.id}-tourapi-hours`, candidate.id, candidate.start_date, candidate.end_date, hours.start, hours.end, null, 0, sourceId, excerpt("playtime", cleanText(payload.intro.playtime))));
    changed++;
  }
  if (allowed(candidate.programs_priority)) for (const program of payload.info.map((row) => stableProgram(row, candidate.id)).filter((value): value is NonNullable<typeof value> => value !== null)) {
    statements.push(db.prepare(`INSERT INTO event_programs(id,event_id,program_name,program_date,start_time,end_time,schedule_text,venue_name,description,featured,sort_order,source_id,evidence_excerpt,updated_at) VALUES(?,?,?,NULL,NULL,NULL,NULL,NULL,?,0,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET program_name=excluded.program_name,description=excluded.description,sort_order=excluded.sort_order,source_id=excluded.source_id,evidence_excerpt=excluded.evidence_excerpt,updated_at=excluded.updated_at`)
      .bind(program.id, candidate.id, program.name, program.description, program.sort, sourceId, excerpt("infoname", program.name), checkedAt));
    changed++;
  }
  const status = changed ? "success" : "empty";
  statements.push(db.prepare(`INSERT INTO tourapi_detail_state(event_id,source_id,content_id,last_checked_at,last_success_at,status,failure_count,next_retry_at,updated_at) VALUES(?,?,?,?,?,?,0,NULL,?)
    ON CONFLICT(event_id) DO UPDATE SET source_id=excluded.source_id,content_id=excluded.content_id,last_checked_at=excluded.last_checked_at,last_success_at=excluded.last_success_at,status=excluded.status,failure_count=0,next_retry_at=NULL,updated_at=excluded.updated_at`)
    .bind(candidate.id, sourceId, contentId, checkedAt, checkedAt, status, checkedAt));
  await db.batch(statements);
  return status as "success" | "empty";
}

async function saveFailure(db: D1Database, candidate: Candidate, checkedAt: string) {
  const failures = (candidate.failure_count ?? 0) + 1;
  const retry = new Date(Date.now() + Math.min(24, 2 ** Math.min(failures, 5)) * 3600_000).toISOString();
  const sourceId = detailSourceId(candidate.id);
  await db.batch([
    db.prepare(`INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload) VALUES(?,'tourapi',3,'한국관광공사 TourAPI 상세',?,?,NULL)
      ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at`)
      .bind(sourceId, TOUR_API_DOC, checkedAt),
    db.prepare(`INSERT INTO tourapi_detail_state(event_id,source_id,content_id,last_checked_at,last_success_at,status,failure_count,next_retry_at,updated_at) VALUES(?,?,?,?,NULL,'failed',?,?,?)
      ON CONFLICT(event_id) DO UPDATE SET source_id=excluded.source_id,last_checked_at=excluded.last_checked_at,status='failed',failure_count=excluded.failure_count,next_retry_at=excluded.next_retry_at,updated_at=excluded.updated_at`)
      .bind(candidate.id, sourceId, candidate.id.slice("tourapi-".length), checkedAt, failures, retry, checkedAt),
  ]);
}

export async function enrichTourApiDetails(env: Env, now = new Date()): Promise<DetailResult> {
  if (env.TOUR_API_ENABLED !== "true" || !env.TOUR_API_KEY) return { candidates: 0, requested: 0, enriched: 0, empty: 0, failed: 0 };
  const candidates = await selectTourApiDetailCandidates(env.DB, now);
  const result: DetailResult = { candidates: candidates.length, requested: 0, enriched: 0, empty: 0, failed: 0 };
  for (const candidate of candidates) {
    const checkedAt = new Date().toISOString();
    try {
      result.requested += DETAIL_ENDPOINTS.length;
      const payload = await fetchPayload(env.TOUR_API_KEY, candidate.id.slice("tourapi-".length));
      const status = await saveSuccess(env.DB, candidate, payload, checkedAt);
      result[status === "success" ? "enriched" : "empty"]++;
    } catch (error) {
      result.failed++;
      await saveFailure(env.DB, candidate, checkedAt);
      console.error("tourapi_detail_failed", { eventId: candidate.id, error: error instanceof Error ? error.name : "unknown" });
    }
  }
  return result;
}
