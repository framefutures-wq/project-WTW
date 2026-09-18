import type { Env } from "../env";
export function tourApiReadiness(env: Env) {
  if (env.TOUR_API_ENABLED !== "true")
    return "TourAPI 수집 비활성: 첫 단계는 샘플 데이터만 사용합니다.";
  if (!env.TOUR_API_KEY) return "TourAPI Secret 미설정: 수집하지 않았습니다.";
  return "TourAPI 어댑터 준비 단계: 공식 API 계약 및 근거 검증 구현 전에는 수집하지 않습니다.";
}
