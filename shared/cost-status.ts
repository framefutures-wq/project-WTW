export const COST_STATUS_LABELS = {
  free: "무료",
  paid: "유료",
  unknown: "비용 정보 확인 필요",
} as const;

export const USER_COST_FILTERS = [
  { queryValue: "", label: "전체" },
  { queryValue: "free", label: "무료" },
  { queryValue: "paid", label: "유료" },
] as const;

export type CostStatus = keyof typeof COST_STATUS_LABELS;
export type CostAssessment = { status: CostStatus; reason: string };

const SERVICE_ONLY = /(무료|유료)\s*(주차|셔틀|셔틀버스|배송)/;
const PARTIAL_FEE =
  /(체험|프로그램|부대).{0,12}(유료|비용\s*별도)|일부.{0,12}(무료|유료)|무료.{0,12}일부/;
const FREE_EVENT = /(입장|관람|참가비|참가|체험).{0,10}무료|무료.{0,10}(입장|관람|참가비|참가|체험)/;
const PAID_EVENT = /(입장권|입장료|관람료|참가비|성인|청소년|어린이).{0,16}\d[\d,]*\s*원|(?:입장|관람|참가비|행사).{0,8}유료/;
const ANY_PRICE = /\d[\d,]*\s*원/;
const PROGRAM_ONLY_FEE = /(체험권|체험비|프로그램).{0,12}\d[\d,]*\s*원/;

/** Conservative normalization for an already stored official price excerpt. */
export function assessCost(value: string | null | undefined): CostAssessment {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { status: "unknown", reason: "missing_cost_text" };
  if (SERVICE_ONLY.test(text) && !FREE_EVENT.test(text) && !PAID_EVENT.test(text))
    return { status: "unknown", reason: "service_only_fee" };
  const free = FREE_EVENT.test(text);
  const paid = PAID_EVENT.test(text);
  if (free && (paid || PARTIAL_FEE.test(text)))
    return { status: "unknown", reason: "mixed_or_partial_fee" };
  if (PROGRAM_ONLY_FEE.test(text) && !/(입장|관람|참가비)/.test(text))
    return { status: "unknown", reason: "program_only_fee" };
  if (paid) return { status: "paid", reason: "explicit_event_fee" };
  if (free) return { status: "free", reason: "explicit_event_free" };
  if (ANY_PRICE.test(text) && !/(주차|셔틀|배송)/.test(text))
    return { status: "paid", reason: "explicit_price" };
  return { status: "unknown", reason: "insufficient_context" };
}
