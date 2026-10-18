export type AnalyticsRuntimeConfig = {
  enabled: boolean;
  ga4: { enabled: boolean; measurementId: string | null };
  cloudflare: { enabled: boolean; token: string | null };
};

export const validGa4MeasurementId = (value: unknown): value is string =>
  typeof value === "string" && /^G-[A-Z0-9]+$/i.test(value.trim());

export const validCloudflareWebAnalyticsToken = (
  value: unknown,
): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value.trim());

export function analyticsRuntimeConfig(env: {
  APP_MODE?: string;
  ANALYTICS_ENABLED?: string;
  GA4_MEASUREMENT_ID?: string;
  CLOUDFLARE_WEB_ANALYTICS_TOKEN?: string;
}): AnalyticsRuntimeConfig {
  const enabled =
    env.APP_MODE === "production" && env.ANALYTICS_ENABLED === "true";
  const measurementId =
    enabled && validGa4MeasurementId(env.GA4_MEASUREMENT_ID)
      ? env.GA4_MEASUREMENT_ID.trim()
      : null;
  const token =
    enabled &&
    validCloudflareWebAnalyticsToken(env.CLOUDFLARE_WEB_ANALYTICS_TOKEN)
      ? env.CLOUDFLARE_WEB_ANALYTICS_TOKEN.trim()
      : null;
  return {
    enabled: Boolean(measurementId || token),
    ga4: { enabled: Boolean(measurementId), measurementId },
    cloudflare: { enabled: Boolean(token), token },
  };
}
