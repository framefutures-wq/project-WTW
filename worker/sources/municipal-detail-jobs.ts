import type { MunicipalCandidate } from "../../shared/municipal-discovery";
import { extractMunicipalRichDetail, type MunicipalRichDetail } from "../../shared/municipal-rich-detail";
import { municipalSourceAllowsUrl, municipalSourceByKey } from "../../shared/municipal-source-registry";
import { persistMunicipalRichDetail } from "./municipal-rich-detail";

export const MUNICIPAL_DETAIL_RAW_HTML_MAX_BYTES = 300 * 1024;
export const MUNICIPAL_DETAIL_NORMALIZED_MAX_BYTES = 64 * 1024;
export const MUNICIPAL_DETAIL_TTL_MS = 15 * 60_000;
export type MunicipalDetailStage = "FETCH_PENDING" | "PARSE_PENDING" | "PERSIST_PENDING" | "DONE" | "RETRY";
type Job = { id:string; source_key:string; candidate_id:string; event_id:string; official_url:string; candidate_json:string; stage:MunicipalDetailStage; raw_html:string|null; normalized_json:string|null; attempt_count:number; expires_at:string };
const now = () => new Date().toISOString();
const size = (value: string) => new TextEncoder().encode(value).byteLength;
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2,"0")).join("");
const retryAt = (attempt: number) => new Date(Date.now() + Math.min(24 * 60, 5 * 2 ** Math.min(attempt, 8)) * 60_000).toISOString();
const normalized = (detail: MunicipalRichDetail) => JSON.stringify(detail);
const claim = async (db:D1Database, stage:MunicipalDetailStage): Promise<Job|null> => {
  const candidate = await db.prepare("SELECT * FROM municipal_detail_jobs WHERE stage=? AND available_at<=? AND expires_at>? ORDER BY available_at,id LIMIT 1").bind(stage,now(),now()).first<Job>();
  if (!candidate) return null;
  const result = await db.prepare("UPDATE municipal_detail_jobs SET available_at=?,updated_at=? WHERE id=? AND stage=? AND available_at<=?").bind(new Date(Date.now()+60_000).toISOString(),now(),candidate.id,stage,now()).run();
  return result.meta.changes ? candidate : null;
};
const fail = (db:D1Database, job:Job, category:string) => db.prepare("UPDATE municipal_detail_jobs SET stage='RETRY',attempt_count=attempt_count+1,retry_at=?,available_at=?,safe_error_category=?,raw_html=NULL,normalized_json=NULL,updated_at=? WHERE id=? AND stage!= 'DONE'").bind(retryAt(job.attempt_count+1),retryAt(job.attempt_count+1),category,now(),job.id).run();

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
  try { const response=await fetcher(job.official_url,{signal:AbortSignal.timeout(20_000)}); if(!response.ok) throw new Error(`official_http_${response.status}`); const html=await response.text(); if(size(html)>MUNICIPAL_DETAIL_RAW_HTML_MAX_BYTES){await fail(db,job,"raw_html_too_large");return {id:job.id,stage:"RETRY" as const};} await db.prepare("UPDATE municipal_detail_jobs SET raw_html=?,raw_html_sha256=?,stage='PARSE_PENDING',available_at=?,safe_error_category=NULL,updated_at=? WHERE id=? AND stage='FETCH_PENDING'").bind(html,await hash(html),now(),now(),job.id).run(); return {id:job.id,stage:"PARSE_PENDING" as const}; } catch { await fail(db,job,"network_or_timeout"); return {id:job.id,stage:"RETRY" as const}; }
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
export const cleanupExpiredMunicipalDetailJobs = (db:D1Database) => db.prepare("DELETE FROM municipal_detail_jobs WHERE expires_at<?").bind(now()).run();
