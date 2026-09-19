import type { EventItem, TrustStatus } from "../shared/domain";

export const sourceTypeLabels: Record<string, string> = {
  event_official: "행사 공식 홈페이지",
  organizer_official: "주최기관 공식 안내",
  local_government: "지자체 공식 안내",
  visitkorea: "한국관광공사 관광정보",
};

export function trustTitle(status: TrustStatus | null) {
  if (status === "confirmed") return "공식정보 확인";
  if (status === "changed") return "공식정보 변경 확인";
  return "공식정보 확인 중";
}

export function trustDescription(status: TrustStatus | null) {
  if (status === "confirmed") return "공식 출처에서 주요 행사정보를 확인했습니다.";
  if (status === "changed") return "공식 출처에서 행사정보 변경을 확인했습니다.";
  return "공식 출처에서 일부 정보를 추가 확인 중입니다. 방문 전 공식 안내를 다시 확인해 주세요.";
}

export function trustChangeLabel(fields: string[]) {
  if (fields.includes("cancelled")) return "행사 취소 확인";
  if (fields.includes("postponed")) return "행사 연기 확인";
  if (fields.includes("start_date") || fields.includes("end_date"))
    return "일정 변경 확인";
  if (fields.includes("venue") || fields.includes("address"))
    return "장소 변경 확인";
  if (fields.includes("operation_change")) return "운영 변경 확인";
  return "행사정보 변경 확인";
}

export function formatTrustDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function officialSourceLabel(types: string[]) {
  return types.map((type) => sourceTypeLabels[type]).filter(Boolean).join(" · ") || null;
}

export function hasOfficialSource(event: Pick<EventItem, "trust_source_url" | "trust_source_types">) {
  return Boolean(event.trust_source_url && officialSourceLabel(event.trust_source_types));
}
