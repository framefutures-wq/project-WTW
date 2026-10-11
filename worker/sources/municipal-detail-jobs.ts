import type { MunicipalCandidate } from "../../shared/municipal-discovery";
import { extractMunicipalRichDetail, type MunicipalRichDetail } from "../../shared/municipal-rich-detail";
import { municipalSourceAllowsUrl, municipalSourceByKey } from "../../shared/municipal-source-registry";
import { persistMunicipalRichDetail } from "./municipal-rich-detail";

export const MUNICIPAL_DETAIL_RAW_HTML_MAX_BYTES = 300 * 1024;
export const MUNICIPAL_DETAIL_NORMALIZED_MAX_BYTES = 64 * 1024;
export const MUNICIPAL_DETAIL_TTL_MS = 15 * 60_000;
export type MunicipalDetailStage = "FETCH_PENDING" | "PARSE_PENDING" | "PERSIST_PENDING" | "DONE" | "RETRY";
type Job = { id:string; source_key:string; candidate_id:string; event_id:string; official_url:string; candidate_json:string; stage:MunicipalDetailStage; retry_stage:MunicipalDetailStage|null; raw_html:string|null; normalized_json:string|null; attempt_count:number; expires_at:string };
const now = () => new Date().toISOString();
const size = (value: string) => new TextEncoder().encode(value).byteLength;
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2,"0")).join("");
const retryAt = (attempt: number) => new Date(Date.now() + Math.min(24 * 60, 5 * 2 ** Math.min(attempt, 8)) * 60_000).toISOString();
const normalized = (detail: MunicipalRichDetail) => JSON.stringify(detail);
const browserHeaders = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.5",
  "cache-control": "no-cache", pragma: "no-cache", "upgrade-insecure-requests": "1",
};
const retryableFetch = (error: unknown) => {
  if (error instanceof TypeError) return true;
  const name = error && typeof error === "object" && "name" in error ? String((error as {name?:unknown}).name ?? "") : "";
  if (name === "AbortError" || name === "TimeoutError") return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  const http = /^official_http_(\d{3})$/.exec(message);
  return /fetch failed|network|timeout/i.test(message) || Boolean(http && (Number(http[1]) === 429 || Number(http[1]) >= 500));
};
const officialUrls = (source: NonNullable<ReturnType<typeof municipalSourceByKey>>, raw: string) => {
  const original = new URL(raw), urls = [original.toString()], family = original.hostname.replace(/^www\./, "");
  for (const host of source.allowedHosts) if (host.replace(/^www\./, "") === family && host !== original.hostname) { const next = new URL(original); next.hostname = host; if (municipalSourceAllowsUrl(source,next.toString())) urls.push(next.toString()); }
  return urls;
};
export async function fetchMunicipalDetailTransport(source: NonNullable<ReturnType<typeof municipalSourceByKey>>, url: string, fetcher: typeof fetch = fetch) {
  const urls=officialUrls(source,url); let last: unknown;
  for (const candidate of urls) for(let attempt=0;attempt<2;attempt++) try {
    const response=await fetcher(candidate,{redirect:"follow",headers:browserHeaders,signal:AbortSignal.timeout(20_000)});
    if(!response.ok) throw new Error(`official_http_${response.status}`);
    return {html:await response.text(),finalUrl:response.url||candidate};
  } catch(error) {last=error;if(!retryableFetch(error)) throw error;}
  throw last ?? new Error("official_fetch_failed");
}
const claim = async (db:D1Database, stage:MunicipalDetailStage): Promise<Job|null> => {
  const candidate = await db.prepare("SELECT * FROM municipal_detail_jobs WHERE (stage=? OR (stage='RETRY' AND retry_stage=?)) AND available_at<=? AND expires_at>? ORDER BY available_at,id LIMIT 1").bind(stage,stage,now(),now()).first<Job>();
  if (!candidate) return null;
  const result = await db.prepare("UPDATE municipal_detail_jobs SET stage=?,retry_stage=NULL,available_at=?,updated_at=? WHERE id=? AND (stage=? OR (stage='RETRY' AND retry_stage=?)) AND available_at<=?").bind(stage,new Date(Date.now()+60_000).toISOString(),now(),candidate.id,stage,stage,now()).run();
  return result.meta.changes ? {...candidate,stage,retry_stage:null} : null;
};
const fail = (db:D1Database, job:Job, category:string) => db.prepare("UPDATE municipal_detail_jobs SET stage='RETRY',retry_stage='FETCH_PENDING',attempt_count=attempt_count+1,retry_at=?,available_at=?,safe_error_category=?,raw_html=NULL,normalized_json=NULL,updated_at=? WHERE id=? AND stage!= 'DONE'").bind(retryAt(job.attempt_count+1),retryAt(job.attempt_count+1),category,now(),job.id).run();

/** Enqueue only. Existing scheduled municipal execution deliberately never calls this yet. */
export async function enqueueMunicipalDetailJob(db:D1Database, input:{ sourceKey:string; candidate:MunicipalCandidate; eventId:string }) {
  const source=municipalSourceByKey(input.sourceKey);
  if (!source || input.candidate.source!==input.sourceKey || !municipalSourceAllowsUrl(source,input.candidate.official_url)) throw new Error("municipal_detail_job_invalid_source");
  const id=`municipal-detail-${input.sourceKey}-${await hash(`${input.candidate.source_candidate_id}|${input.candidate.official_url}`)}`;
  const timestamp=now(), expires=new Date(Date.now()+MUNICIPAL_DETAIL_TTL_MS).toISOString();
  await db.prepare("INSERT INTO municipal_detail_jobs(id,source_key,candidate_id,event_id,official_url,candidate_json,stage,available_at,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?, 'FETCH_PENDING',?,?,?,?) ON CONFLICT(source_key,candidate_id,official_url) DO NOTHING").bind(id,input.sourceKey,input.candidate.source_candidate_id,input.eventId,input.candidate.official_url,JSON.stringify(input.candidate),timestamp,timestamp,timestamp,expires).run();
  return id;
}
export async function detailFetchOne(db:D1Database, fetcher:typeof fetch=fetch) {
  const job=await claim(db,"FETCH_PENDING"); if(!job) return null;
  const source=municipalSourceByKey(job.source_key);
  if(!source || !municipalSourceAllowsUrl(source,job.official_url)){ await fail(db,job,"detail_host_not_allowed"); return {id:job.id,stage:"RETRY" as const}; }
  try { const {html}=await fetchMunicipalDetailTransport(source,job.official_url,fetcher); if(size(html)>MUNICIPAL_DETAIL_RAW_HTML_MAX_BYTES){await fail(db,job,"raw_html_too_large");return {id:job.id,stage:"RETRY" as const};} await db.prepare("UPDATE municipal_detail_jobs SET raw_html=?,raw_html_sha256=?,stage='PARSE_PENDING',available_at=?,safe_error_category=NULL,updated_at=? WHERE id=? AND stage='FETCH_PENDING'").bind(html,await hash(html),now(),now(),job.id).run(); return {id:job.id,stage:"PARSE_PENDING" as const}; } catch { await fail(db,job,"network_or_timeout"); return {id:job.id,stage:"RETRY" as const}; }
}
export async function detailParseOne(db:D1Database) {
  const job=await claim(db,"PARSE_PENDING"); if(!job) return null;
  if(!job.raw_html){await fail(db,job,"missing_raw_html");return {id:job.id,stage:"RETRY" as const};}
  try { const value=normalized(extractMunicipalRichDetail(job.official_url,job.raw_html)); if(size(value)>MUNICIPAL_DETAIL_NORMALIZED_MAX_BYTES){await fail(db,job,"normalized_detail_too_large");return {id:job.id,stage:"RETRY" as const};} await db.prepare("UPDATE municipal_detail_jobs SET raw_html=NULL,raw_html_sha256=NULL,normalized_json=?,stage='PERSIST_PENDING',available_at=?,safe_error_category=NULL,updated_at=? WHERE id=? AND stage='PARSE_PENDING'").bind(value,now(),now(),job.id).run(); return {id:job.id,stage:"PERSIST_PENDING" as const}; } catch {await fail(db,job,"detail_parse_failed");return {id:job.id,stage:"RETRY" as const};}
}
export async function detailPersistOne(db:D1Database) {
  const job=await claim(db,"PERSIST_PENDING"); if(!job) return null;
  try { const candidate=JSON.parse(job.candidate_json) as MunicipalCandidate; const detail=JSON.parse(job.normalized_json ?? "null") as MunicipalRichDetail|null; if(!detail || !candidate.start_date || !candidate.end_date) throw new Error("missing_normalized_detail"); await persistMunicipalRichDetail(db,{eventId:job.event_id,startDate:candidate.start_date,endDate:candidate.end_date,sourceId:`municipal-source-${job.event_id}`,sourceName:`${candidate.source} 공식 행사 안내`,sourceUrl:job.official_url,checkedAt:now(),detail}); await db.prepare("UPDATE municipal_detail_jobs SET stage='DONE',normalized_json=NULL,safe_error_category=NULL,updated_at=? WHERE id=? AND stage='PERSIST_PENDING'").bind(now(),job.id).run(); return {id:job.id,stage:"DONE" as const}; } catch {await fail(db,job,"detail_persist_failed");return {id:job.id,stage:"RETRY" as const};}
}
/** DONE rows are observability-only and share the short checkpoint TTL. */
export const cleanupExpiredMunicipalDetailJobs = async (db:D1Database, at=now()) => {
  const retainUntil=new Date(Date.parse(at)+14*86400000).toISOString();
  const results=await db.batch([
    db.prepare("UPDATE municipal_detail_jobs SET stage='DONE',retry_stage=NULL,raw_html=NULL,raw_html_sha256=NULL,normalized_json=NULL,safe_error_category='terminal_'||COALESCE(safe_error_category,'expired'),retry_at=NULL,expires_at=?,updated_at=? WHERE stage<>'DONE' AND expires_at<=?").bind(retainUntil,at,at),
    db.prepare("DELETE FROM municipal_detail_jobs WHERE stage='DONE' AND expires_at<=?").bind(at),
  ]);
  return {meta:{changes:results.reduce((count,result)=>count+(result.meta.changes??0),0)}};
};
