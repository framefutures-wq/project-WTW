import { koreaDate, type EventItem, REGIONS } from "../../shared/domain";
import { assessCost } from "../../shared/cost-status";
import type { Env } from "../env";
import { alertDedupeKey, alertId, cancellationConfirmed, scheduleChanged, type AlertCore, type AlertType } from "../../shared/alert-engine";
import {
  classifyFactTags,
  FACT_CLASSIFIER,
  FACT_RULE_VERSION,
} from "../../shared/fact-tags";
import {
  classifyCompanionSuitability,
  COMPANION_CLASSIFIER,
} from "../../shared/companion-suitability";

export const TOUR_API_BASE = "https://apis.data.go.kr/B551011/KorService2";
export const TOUR_API_DOC = "https://www.data.go.kr/data/15101578/openapi.do";
export type TourApiRow = Record<string, unknown>;
type Row = TourApiRow;
const FACT_FIELDS = ["title", "overview", "program", "subevent", "eventplace", "placeinfo", "playtime", "parking", "parkinginfo", "agelimit", "usetimefestival"];
const COST_FIELDS = ["usetimefestival", "usefee", "usetime"];
function costDetails(row: Row) {
  return COST_FIELDS.map((field) => text(row[field])).filter(Boolean).join(" · ") || null;
}
function factDocuments(event: NonNullable<ReturnType<typeof mapFestival>>, raw: Row, sourceId: string, checkedAt: string) {
  const docs = [{ text: event.title, field: "title", source: sourceId, source_type: "tourapi", checked_at: checkedAt, scope: "event_level", strength: "direct_field" }];
  for (const field of FACT_FIELDS) {
    const value = text(raw[field]);
    if (value) docs.push({ text: value, field, source: sourceId, source_type: "tourapi", checked_at: checkedAt, scope: ["program", "subevent", "playtime"].includes(field) ? "program_level" : "event_level", strength: "direct_field" });
  }
  return docs;
}
function changedFactInput(previousRaw: string | null, raw: Row, event: NonNullable<ReturnType<typeof mapFestival>>, previous: Record<string, unknown> | null) {
  if (!previous) return true;
  const previousValues = (() => { try { return JSON.parse(previousRaw || "{}"); } catch { return {}; } })();
  const rawChanged = FACT_FIELDS.some((field) => text(previousValues[field]) !== text(raw[field]));
  const eventChanged = ["title", "description", "region", "venue", "address", "start_date", "end_date", "lat", "lng", "status"].some((field) => String(previous[field] ?? "") !== String((event as Record<string, unknown>)[field] ?? ""));
  return rawChanged || eventChanged;
}
function object(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("TourAPI response shape invalid");
  return value as Row;
}
export function text(value: unknown): string {
  return typeof value === "string"
    ? value.trim()
    : typeof value === "number"
      ? String(value)
      : "";
}
export function tourApiReadiness(env: Env) {
  if (env.TOUR_API_ENABLED !== "true") return "TourAPI 수집 비활성";
  if (!env.TOUR_API_KEY) return "TourAPI Secret 미설정: 수집하지 않았습니다.";
  return "TourAPI 수집 준비 완료";
}
export function parseTourResponse(value: unknown) {
  const response = object(object(value).response);
  const code = text(object(response.header).resultCode);
  if (code !== "0000" && code !== "00")
    throw new Error(
      `TourAPI provider resultCode=${/^\d{2,4}$/.test(code) ? code : "invalid"}`,
    );
  const body = object(response.body);
  if (body.totalCount == null || body.totalCount === "")
    throw new Error("TourAPI totalCount missing");
  const total = Number(body.totalCount);
  if (!Number.isSafeInteger(total) || total < 0)
    throw new Error("TourAPI totalCount invalid");
  const item =
    body.items && typeof body.items === "object"
      ? object(body.items).item
      : undefined;
  const items =
    item == null || item === ""
      ? []
      : (Array.isArray(item) ? item : [item]).map(object);
  if (total > 0 && items.length === 0)
    throw new Error("TourAPI unexpected empty page");
  return { items, total };
}
export async function tourApiRequest(
  key: string,
  endpoint: string,
  params: Record<string, string>,
) {
  const url = new URL(`${TOUR_API_BASE}/${endpoint}`);
  url.search = new URLSearchParams({
    serviceKey: key,
    MobileOS: "WEB",
    MobileApp: "project-WTW",
    _type: "json",
    ...params,
  }).toString();
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    const errorName =
      error instanceof Error &&
      ["TypeError", "Error", "TimeoutError", "AbortError"].includes(error.name)
        ? error.name
        : "unknown";
    const reason =
      error instanceof Error && error.message.includes("preview")
        ? "preview_restriction"
        : error instanceof Error && error.message.includes("SSL")
          ? "tls_failure"
          : error instanceof Error &&
              error.message.includes("timeout is not a function")
            ? "timeout_api_unavailable"
            : "network";
    throw new Error(
      `TourAPI ${endpoint} network/timeout failure (${errorName},${reason})`,
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`TourAPI ${endpoint} HTTP ${response.status}`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`TourAPI ${endpoint} non-JSON response`);
  }
  return parseTourResponse(payload);
}
async function pages(
  key: string,
  endpoint: string,
  params: Record<string, string>,
) {
  const rows: Row[] = [];
  let total: number | undefined;
  for (let page = 1; page <= 20; page++) {
    const result = await tourApiRequest(key, endpoint, {
      ...params,
      numOfRows: "1000",
      pageNo: String(page),
    });
    if (total !== undefined && result.total !== total)
      throw new Error("TourAPI dataset changed during pagination; retry later");
    total = result.total;
    rows.push(...result.items);
    if (rows.length === total) return rows;
    if (rows.length > total) throw new Error("TourAPI pagination invalid");
  }
  throw new Error("TourAPI pagination budget exceeded");
}
export function date(value: unknown) {
  const raw = text(value);
  if (!/^\d{8}$/.test(raw)) return null;
  const formatted = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const parsed = new Date(`${formatted}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === formatted
    ? formatted
    : null;
}
export function regionName(name: string): string | null {
  const aliases: Record<string, string> = {
    서울특별시: "서울",
    부산광역시: "부산",
    대구광역시: "대구",
    인천광역시: "인천",
    광주광역시: "광주",
    전남광주통합특별시: "전남광주",
    대전광역시: "대전",
    울산광역시: "울산",
    세종특별자치시: "세종",
    경기도: "경기",
    강원특별자치도: "강원",
    강원도: "강원",
    충청북도: "충북",
    충청남도: "충남",
    전북특별자치도: "전북",
    전라북도: "전북",
    전라남도: "전남",
    경상북도: "경북",
    경상남도: "경남",
    제주특별자치도: "제주",
    제주도: "제주",
  };
  return (
    aliases[name] ??
    (REGIONS.includes(name as (typeof REGIONS)[number]) ? name : null)
  );
}
export function rejectionReasons(row: Row, regions: Map<string, string>) {
  const reasons: string[] = [];
  if (!/^\d{1,40}$/.test(text(row.contentid)))
    reasons.push("INVALID_CONTENT_ID");
  if (text(row.contenttypeid) !== "15")
    reasons.push("NOT_FESTIVAL_CONTENT_TYPE");
  if (!text(row.title)) reasons.push("MISSING_TITLE");
  if (!regions.has(text(row.lDongRegnCd))) reasons.push("UNKNOWN_REGION_CODE");
  if (![text(row.addr1), text(row.addr2)].some(Boolean))
    reasons.push("MISSING_ADDRESS");
  const start = date(row.eventstartdate),
    end = date(row.eventenddate);
  if (!start) reasons.push("INVALID_START_DATE");
  if (!end) reasons.push("INVALID_END_DATE");
  if (start && end && start > end) reasons.push("START_AFTER_END");
  if (
    ![
      "",
      "선택안함",
      "선택 안함",
      "취소",
      "행사연기",
      "행사 연기",
      "연기",
    ].includes(text(row.progresstype))
  )
    reasons.push("UNSUPPORTED_PROGRESS_TYPE");
  return reasons;
}
type Rejection = { raw: Row; reasons: string[] };
export class TourApiSnapshotError extends Error {
  constructor(
    message: string,
    readonly rejections: Rejection[],
  ) {
    super(message);
  }
}
export async function saveRejections(
  db: D1Database,
  syncRunId: string,
  rejections: Rejection[],
) {
  if (!rejections.length) return;
  const rejectedAt = new Date().toISOString();
  // Separate transaction: rejected records survive a normal-event transaction rollback.
  await db.batch(
    rejections.map(({ raw, reasons }) =>
      db
        .prepare(
          "INSERT INTO tourapi_rejections(sync_run_id,content_id,title,raw_payload,reason,rejected_at) VALUES(?,?,?,?,?,?)",
        )
        .bind(
          syncRunId,
          text(raw.contentid) || null,
          text(raw.title) || null,
          JSON.stringify(raw),
          JSON.stringify(reasons),
          rejectedAt,
        ),
    ),
  );
}
export function mapFestival(
  row: Row,
  regions: Map<string, string>,
  checkedAt: string,
) {
  const start = date(row.eventstartdate),
    end = date(row.eventenddate);
  const id = text(row.contentid),
    title = text(row.title);
  const region = regions.get(text(row.lDongRegnCd));
  const address = [text(row.addr1), text(row.addr2)].filter(Boolean).join(" ");
  if (rejectionReasons(row, regions).length || !start || !end || !region)
    return null;
  const progress = text(row.progresstype);
  const price_text = costDetails(row);
  const cost = assessCost(price_text, Number(start.slice(0, 4))).status;
  // "선택안함" is NOT evidence of a scheduled or non-cancelled event.
  const status: EventItem["status"] =
    progress === "취소"
      ? "cancelled"
      : ["행사연기", "행사 연기", "연기"].includes(progress)
        ? "postponed"
        : "unknown";
  const x = text(row.mapx),
    y = text(row.mapy),
    lng = Number(x),
    lat = Number(y);
  const coordinates =
    x !== "" &&
    y !== "" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0);
  return {
    id: `tourapi-${id}`,
    title,
    description:
      "한국관광공사 TourAPI에 등록된 행사입니다. 요금·동행 조건 및 개최 여부는 출발 전 공식 공지를 확인해 주세요.",
    region,
    // List has an address, not the organizer's eventplace. Preserve the exact address.
    venue: address,
    address,
    start_date: start,
    end_date: end,
    lat: coordinates ? lat : null,
    lng: coordinates ? lng : null,
    cost,
    price_text,
    pet_policy: "unknown" as const,
    status,
    checked_at: checkedAt,
    progress,
  };
}
export async function collectFestivals(key: string, now = new Date()) {
  const regions = new Map<string, string>();
  const provinces = await pages(key, "ldongCode2", { lDongListYn: "N" });
  for (const row of provinces) {
    const name = regionName(text(row.name));
    if (name) regions.set(text(row.code), name);
  }
  const available = new Set(regions.values());
  const required = REGIONS.filter(
    (name) => !["광주", "전남", "전남광주"].includes(name),
  );
  if (
    required.some((name) => !available.has(name)) ||
    (!available.has("전남광주") &&
      !(available.has("광주") && available.has("전남")))
  )
    throw new Error(
      "TourAPI province code coverage incomplete: " +
        provinces
          .map(
            (row) =>
              text(row.code).replace(/[^0-9]/g, "") +
              ":" +
              text(row.name).replace(/[^가-힣 ]/g, ""),
          )
          .join(","),
    );
  // Broad lower bound includes ongoing festivals; no end bound that drops long festivals.
  const raw = await pages(key, "searchFestival2", {
    eventStartDate: "19000101",
    arrange: "A",
  });
  return selectFestivalSnapshot(raw, regions, now);
}
export function selectFestivalSnapshot(
  raw: Row[],
  regions: Map<string, string>,
  now = new Date(),
) {
  const today = koreaDate(now);
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 30);
  const until = end.toISOString().slice(0, 10);
  const checkedAt = now.toISOString();
  const candidates: {
    event: NonNullable<ReturnType<typeof mapFestival>>;
    raw: Row;
  }[] = [];
  const rejections: Rejection[] = [];
  let duplicate = false;
  const seen = new Set<string>();
  for (const row of raw) {
    const event = mapFestival(row, regions, checkedAt);
    if (!event) {
      rejections.push({ raw: row, reasons: rejectionReasons(row, regions) });
      continue;
    }
    if (seen.has(event.id)) {
      duplicate = true;
      rejections.push({ raw: row, reasons: ["DUPLICATE_CONTENT_ID"] });
      continue;
    }
    seen.add(event.id);
    if (event.start_date <= until && event.end_date >= today)
      candidates.push({ event, raw: row });
  }
  if (duplicate)
    throw new TourApiSnapshotError(
      "TourAPI duplicate content id; snapshot rejected",
      [
        ...rejections,
        ...candidates.map(({ raw }) => ({
          raw,
          reasons: ["SNAPSHOT_DUPLICATE_ABORTED"],
        })),
      ],
    );
  if (raw.length === 0 || candidates.length === 0)
    throw new TourApiSnapshotError(
      "TourAPI empty discovery window; preserve existing dataset",
      rejections,
    );
  return {
    candidates,
    rejections,
    rejected: rejections.length,
    fetched: raw.length,
    today,
    until,
    checkedAt,
  };
}
export async function syncTourApi(env: Env, syncRunId: string) {
  if (env.TOUR_API_ENABLED !== "true" || !env.TOUR_API_KEY) return null;
  let snapshot: Awaited<ReturnType<typeof collectFestivals>>;
  try {
    snapshot = await collectFestivals(env.TOUR_API_KEY);
  } catch (error) {
    if (error instanceof TourApiSnapshotError)
      await saveRejections(env.DB, syncRunId, error.rejections);
    throw error;
  }
  await saveRejections(env.DB, syncRunId, snapshot.rejections);
  try {
    return await saveFestivalSnapshot(env.DB, snapshot);
  } catch {
    await saveRejections(
      env.DB,
      syncRunId,
      snapshot.candidates.map(({ raw }) => ({
        raw,
        reasons: ["EVENT_TRANSACTION_FAILED"],
      })),
    );
    throw new Error(
      "TourAPI event transaction failed; rejection records retained",
    );
  }
}
export async function saveFestivalSnapshot(
  db: D1Database,
  snapshot: Awaited<ReturnType<typeof collectFestivals>>,
) {
  let statements: D1PreparedStatement[] = [];
  for (const [index, { event: e, raw }] of snapshot.candidates.entries()) {
    const source = `${e.id}-source`;
    const previous = await db.prepare(
      `SELECT e.*,s.raw_payload AS previous_raw FROM events e LEFT JOIN sources s ON s.id=e.primary_source_id WHERE e.id=?`,
    ).bind(e.id).first<Record<string, unknown> & { previous_raw: string | null }>();
    const sourceOwned = !previous || previous.primary_source_id === source;
    const shouldReclassify = sourceOwned && changedFactInput(previous?.previous_raw ?? null, raw, e, previous);
    // Store response fields only, never the request URL containing serviceKey.
    statements.push(
      db
        .prepare(
          `INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload) VALUES(?,'tourapi',3,'한국관광공사 TourAPI',?,?,?)
      ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at,raw_payload=excluded.raw_payload`,
        )
        .bind(source, TOUR_API_DOC, snapshot.checkedAt, JSON.stringify(raw)),
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO event_changes(event_id,reason,before_json,after_json)
      SELECT id,'TourAPI 일정·주소·상태 갱신',json_object('start_date',start_date,'end_date',end_date,'address',address,'status',status),json_object('start_date',?,'end_date',?,'address',?,'status',?)
      FROM events WHERE id=? AND primary_source_id=? AND (start_date!=? OR end_date!=? OR address!=? OR status!=?)`,
        )
        .bind(
          e.start_date,
          e.end_date,
          e.address,
          e.status,
          e.id,
          source,
          e.start_date,
          e.end_date,
          e.address,
          e.status,
        ),
    );
    const before: AlertCore | null = previous ? { start_date: previous.start_date as string | null, end_date: previous.end_date as string | null, status: previous.status as string | null } : null;
    const after: AlertCore = { start_date: e.start_date, end_date: e.end_date, status: e.status };
    const addAlert = (type: AlertType, oldValue: AlertCore | null, newValue: AlertCore) => {
      const dedupe = alertDedupeKey(type, e.id, newValue);
      statements.push(
        db.prepare(
          `INSERT OR IGNORE INTO alert_events(id,event_id,alert_type,dedupe_key,created_at,effective_at,before_json,after_json,source_id)
           VALUES(?,?,?,?,?,?,?,?,?)`,
        ).bind(
          alertId(dedupe), e.id, type, dedupe, snapshot.checkedAt, snapshot.checkedAt,
          oldValue ? JSON.stringify(oldValue) : null, JSON.stringify(newValue), source,
        ),
      );
    };
    statements.push(
      db
        .prepare(
          `INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,lat,lng,cost,price_text,pet_policy,status,verification,is_sample,primary_source_id,checked_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'unknown',?,'verified',0,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,region=excluded.region,venue=CASE WHEN EXISTS (SELECT 1 FROM event_evidence WHERE event_id=events.id AND source_id=events.id || '-detail' AND field='venue') THEN events.venue ELSE excluded.venue END,address=excluded.address,start_date=excluded.start_date,end_date=excluded.end_date,lat=excluded.lat,lng=excluded.lng,cost=CASE WHEN EXISTS (SELECT 1 FROM event_evidence WHERE event_id=events.id AND source_id=events.id || '-detail' AND field='price') THEN events.cost ELSE excluded.cost END,price_text=CASE WHEN EXISTS (SELECT 1 FROM event_evidence WHERE event_id=events.id AND source_id=events.id || '-detail' AND field='price') THEN events.price_text ELSE excluded.price_text END,pet_policy='unknown',status=excluded.status,verification='verified',primary_source_id=excluded.primary_source_id,checked_at=excluded.checked_at,updated_at=excluded.checked_at
      WHERE events.primary_source_id=?`,
        )
        .bind(
          e.id,
          e.title,
          e.description,
          e.region,
          e.venue,
          e.address,
          e.start_date,
          e.end_date,
          e.lat,
          e.lng,
          e.cost,
          e.price_text,
          e.status,
          source,
          snapshot.checkedAt,
          source,
        ),
    );
    if (!previous && sourceOwned) addAlert("NEW_EVENT", null, { start_date: e.start_date, end_date: e.end_date });
    else if (sourceOwned && scheduleChanged(before, after)) addAlert("SCHEDULE_CHANGED", { start_date: before?.start_date ?? null, end_date: before?.end_date ?? null }, { start_date: e.start_date, end_date: e.end_date });
    if (sourceOwned && cancellationConfirmed(before, after)) addAlert("CANCELLED_OR_POSTPONED", { status: before?.status ?? null }, { status: e.status });
    const evidence: Record<string, string> = {
      schedule: `eventstartdate=${text(raw.eventstartdate)}, eventenddate=${text(raw.eventenddate)}`,
      venue: `addr1=${text(raw.addr1)}, addr2=${text(raw.addr2)} (행사장 명칭은 미제공)`,
      status: `progresstype=${e.progress || "(미제공)"}${e.status === "unknown" ? " · 개최/취소 여부 미확인" : ""}`,
    };
    if (e.cost !== "unknown" && e.price_text) evidence.price = e.price_text;
    statements.push(
      db
        .prepare("DELETE FROM event_evidence WHERE event_id=? AND source_id=?")
        .bind(e.id, source),
    );
    if (e.lat !== null) evidence.coordinates = `mapx=${e.lng}, mapy=${e.lat}`;
    for (const [field, excerpt] of Object.entries(evidence))
      statements.push(
        db
          .prepare(
            "INSERT INTO event_evidence(event_id,source_id,field,excerpt,checked_at) VALUES(?,?,?,?,?)",
          )
          .bind(e.id, source, field, excerpt, snapshot.checkedAt),
      );
    if (shouldReclassify) {
      const factResult = classifyFactTags(e, factDocuments(e, raw, source, snapshot.checkedAt));
      const companionResult = classifyCompanionSuitability(factResult.candidates);
      statements.push(
        db.prepare(
          "DELETE FROM event_tags WHERE event_id=? AND classifier_type=? AND rule_version=?",
        ).bind(e.id, FACT_CLASSIFIER, FACT_RULE_VERSION),
      );
      for (const candidate of factResult.candidates)
        statements.push(
          db.prepare(
            `INSERT INTO event_tags(event_id,tag,classifier_type,rule_version,rule_id,evidence_source_ref,evidence_field,evidence_excerpt,updated_at)
             VALUES(?,?,?,?,?,?,?,?,?)`,
          ).bind(
            e.id,
            candidate.tag,
            FACT_CLASSIFIER,
            FACT_RULE_VERSION,
            candidate.rule_id,
            candidate.evidence_source,
            candidate.field,
            candidate.evidence_text.slice(0, 1000),
            snapshot.checkedAt,
          ),
        );
      for (const companion of companionResult)
        statements.push(
          db.prepare(
            `INSERT INTO event_companion_suitability(event_id,companion_type,suitability_state,classifier_type,rule_version,rule_id,positive_reason_codes,caution_reason_codes,source_fact_tags,updated_at)
             VALUES(?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(event_id,companion_type) DO UPDATE SET
               suitability_state=excluded.suitability_state,classifier_type=excluded.classifier_type,rule_version=excluded.rule_version,rule_id=excluded.rule_id,
               positive_reason_codes=excluded.positive_reason_codes,caution_reason_codes=excluded.caution_reason_codes,source_fact_tags=excluded.source_fact_tags,updated_at=excluded.updated_at
             WHERE event_companion_suitability.classifier_type='deterministic_rule'`,
          ).bind(e.id, companion.companion_type, companion.suitability_state, COMPANION_CLASSIFIER, companion.rule_version, companion.rule_id, JSON.stringify(companion.positive_reason_codes), JSON.stringify(companion.caution_reason_codes), JSON.stringify(companion.source_fact_tags), snapshot.checkedAt),
        );
    }
    if ((index + 1) % 20 === 0) {
      await db.batch(statements);
      statements = [];
    }
  }
  // Each event chunk is atomic; missing API records become stale, never guessed cancelled.
  statements.push(
    db
      .prepare(
        `UPDATE events SET verification='stale',updated_at=? WHERE is_sample=0 AND primary_source_id=id || '-source' AND id LIKE 'tourapi-%' AND checked_at!=?`,
      )
      .bind(snapshot.checkedAt, snapshot.checkedAt),
  );
  if (statements.length) await db.batch(statements);
  return {
    imported: snapshot.candidates.length,
    rejected: snapshot.rejected,
    fetched: snapshot.fetched,
    range: { start: snapshot.today, end: snapshot.until },
  };
}
