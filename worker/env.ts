import type { MunicipalMarkdownAI } from "../shared/municipal-document-fallback";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Optional until the production Workers AI binding is explicitly enabled. */
  AI?: MunicipalMarkdownAI;
  /** Cost guard. AI document conversion stays off unless this is exactly "true". */
  MUNICIPAL_DOCUMENT_AI_ENABLED?: string;
  APP_MODE: "sample" | "production";
  TOUR_API_ENABLED: string;
  /** Cloudflare Secret 전용. 현재 값 없음. */
  TOUR_API_KEY?: string;
  WEB_PUSH_ENABLED?: string;
  WEB_PUSH_VAPID_PUBLIC_KEY?: string;
  /** Cloudflare Secret 전용. 절대 응답하거나 로그에 남기지 않는다. */
  WEB_PUSH_VAPID_PRIVATE_KEY?: string;
  WEB_PUSH_VAPID_SUBJECT?: string;
  ANALYTICS_ENABLED?: string;
  GA4_MEASUREMENT_ID?: string;
  CLOUDFLARE_WEB_ANALYTICS_TOKEN?: string;
}


export function municipalDocumentAI(env: Env) {
  return env.MUNICIPAL_DOCUMENT_AI_ENABLED === "true" ? env.AI : undefined;
}
