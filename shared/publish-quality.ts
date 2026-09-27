export const PUBLISH_QUALITY_RULE_VERSION = "publish_quality_v1" as const;

export type PublishQualityState = "PUBLIC" | "HOLD" | "EXCLUDE";

export type PublishQualityInput = {
  title: string;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  venue?: string | null;
  address?: string | null;
  source_kind?: string | null;
  source_url?: string | null;
};

export type PublishQualityDecision = {
  state: PublishQualityState;
  reason:
    | "missing_core"
    | "untrusted_or_missing_official_source"
    | "explicit_non_event"
    | "perpetual_facility_or_program"
    | "explicit_public_event"
    | "trusted_bounded_event"
    | "insufficient_event_signal";
  rule_version: typeof PUBLISH_QUALITY_RULE_VERSION;
};

const CORE_DATE = /^20\d{2}-\d{2}-\d{2}$/;
const TRUSTED_SOURCE_KINDS = new Set([
  "organizer",
  "municipality",
  "tourapi",
  "public_data",
]);

const NON_EVENT =
  /(?:^|\s)(?:모집|채용|접수|수강생|교육생|강사모집|정규\s*강좌|상시\s*강좌|평생학습|설명회|세미나|포럼|간담회|회의|협의회|위원회|심의회|업무보고|성과보고|기념식|협약식|개소식|출범식|순방|임명식|기탁식|대관(?:\s|$)|휴관\s*안내|점검\s*안내|기관\s*내부|직원\s*대상|회원\s*전용|온라인\s*교육)(?:\s|$)/;

const PUBLIC_EVENT =
  /축제|페스티벌|문화제|야행|미디어아트|불꽃|드론\s*(?:쇼|라이트쇼)|퍼레이드|야시장|특별전|기획전|전시|개인전|회원(?:작품)?전|아트페어|공연|콘서트|음악회|연주회|독주회|독창회|가요제|뮤지컬|연극|오페라|발레|무용|서커스|체험|박람회|플리마켓|마켓|야간개장|시즌\s*(?:행사|프로그램)|팝업/;

const PERPETUAL =
  /연중\s*(?:무휴|상시|운영)|365일|상시\s*(?:운영|개방|체험|프로그램)|매일\s*(?:운영|개방)|상설\s*(?:운영|체험|프로그램)/;

const FACILITY_LIKE =
  /수목원|박물관|미술관|전망대|공원|테마파크|체험장|관광지|시설|센터|전시관|기념관|휴양림|수련관/;

function nonBlank(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function validDate(value: string | null | undefined) {
  if (!value || !CORE_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validOfficialSource(kind: string | null | undefined, url: string | null | undefined) {
  if (!kind || !TRUSTED_SOURCE_KINDS.has(kind)) return false;
  if (!url) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function durationDays(start: string, end: string) {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}

/**
 * Common publication-quality decision for every provider.
 *
 * This does not replace source-specific parsing or duplicate/status logic.
 * It answers one product question only: is this record good enough to be a
 * user-facing Galteum event, should it wait for more evidence, or is it
 * clearly outside the product scope?
 */
export function decidePublishQuality(
  input: PublishQualityInput,
): PublishQualityDecision {
  const title = input.title?.trim() ?? "";
  const description = input.description?.trim() ?? "";
  const venue = input.venue?.trim() ?? "";
  const address = input.address?.trim() ?? "";
  const start = input.start_date ?? null;
  const end = input.end_date ?? null;
  const text = `${title} ${description}`.replace(/\s+/g, " ").trim();

  if (
    !title ||
    !validDate(start) ||
    !validDate(end) ||
    !start ||
    !end ||
    start > end ||
    (!nonBlank(venue) && !nonBlank(address))
  )
    return {
      state: "HOLD",
      reason: "missing_core",
      rule_version: PUBLISH_QUALITY_RULE_VERSION,
    };

  if (!validOfficialSource(input.source_kind, input.source_url))
    return {
      state: "HOLD",
      reason: "untrusted_or_missing_official_source",
      rule_version: PUBLISH_QUALITY_RULE_VERSION,
    };

  const explicitPublicEvent = PUBLIC_EVENT.test(text);

  if (NON_EVENT.test(text) && !explicitPublicEvent)
    return {
      state: "EXCLUDE",
      reason: "explicit_non_event",
      rule_version: PUBLISH_QUALITY_RULE_VERSION,
    };

  if (
    PERPETUAL.test(text) &&
    FACILITY_LIKE.test(text) &&
    !explicitPublicEvent
  )
    return {
      state: "EXCLUDE",
      reason: "perpetual_facility_or_program",
      rule_version: PUBLISH_QUALITY_RULE_VERSION,
    };

  if (explicitPublicEvent)
    return {
      state: "PUBLIC",
      reason: "explicit_public_event",
      rule_version: PUBLISH_QUALITY_RULE_VERSION,
    };

  // A bounded, official record can still be a real event even if its title
  // does not use one of the common event words. Keep the automatic path
  // conservative: short/medium windows with meaningful descriptive content
  // are public; sparse or very long ambiguous records wait for more evidence.
  const days = durationDays(start, end);
  const meaningfulDescription =
    description.length >= 40 &&
    !/^한국관광공사 TourAPI에 등록된 행사입니다/.test(description);

  if (days <= 62 && meaningfulDescription)
    return {
      state: "PUBLIC",
      reason: "trusted_bounded_event",
      rule_version: PUBLISH_QUALITY_RULE_VERSION,
    };

  return {
    state: "HOLD",
    reason: "insufficient_event_signal",
    rule_version: PUBLISH_QUALITY_RULE_VERSION,
  };
}
