export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_MODE: "sample" | "production";
  TOUR_API_ENABLED: string;
  /** Cloudflare Secret 전용. 현재 값 없음. */
  TOUR_API_KEY?: string;
}
