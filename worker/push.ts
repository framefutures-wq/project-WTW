import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";
import { AUDIENCES, REGIONS, THEMES } from "../shared/domain";
import { USER_CONTENT_FILTER_BY_QUERY } from "../shared/content-filters";
import { audienceCompanionFilter, COMPANION_CLASSIFIER, COMPANION_RULE_VERSION } from "../shared/companion-suitability";
import { FACT_CLASSIFIER, FACT_RULE_VERSION } from "../shared/fact-tags";
import type { Env } from "./env";

const MAX_BODY_BYTES = 10_000, MAX_ENDPOINT_LENGTH = 2_048, MAX_ALERTS_PER_RUN = 25, MAX_DELIVERIES_PER_RUN = 200, MAX_ATTEMPTS = 3;
const base64url = /^[A-Za-z0-9_-]+$/;
type Preference = { region: string | null; audience: string | null; theme: string | null; new_event: boolean; schedule_changed: boolean; cancelled_or_postponed: boolean };
type StoredSubscription = PushSubscription & { id: string; disabled_at: string | null; failure_count: number };

export function pushStatus(env: Env): "enabled" | "disabled" | "misconfigured" {
  if (env.WEB_PUSH_ENABLED !== "true") return "disabled";
  return env.WEB_PUSH_VAPID_PUBLIC_KEY && env.WEB_PUSH_VAPID_PRIVATE_KEY && env.WEB_PUSH_VAPID_SUBJECT ? "enabled" : "misconfigured";
}

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  return origin !== null && origin === new URL(request.url).origin;
}

function bool(value: unknown, fallback: boolean) {
  return value === undefined ? fallback : typeof value === "boolean" ? value : null;
}
function optionalAllowed(value: unknown, allowed: readonly string[]) {
  return value === null || value === undefined || value === "" ? null : typeof value === "string" && allowed.includes(value) ? value : undefined;
}
function validKey(value: unknown, min: number, max: number) {
  return typeof value === "string" && value.length >= min && value.length <= max && base64url.test(value);
}
export function validPushEndpoint(value: unknown): value is string {
  try { const endpoint = new URL(String(value)); return endpoint.protocol === "https:" && endpoint.href.length <= MAX_ENDPOINT_LENGTH; } catch { return false; }
}
export function parseSubscriptionRequest(value: unknown): { subscription: PushSubscription; preferences: Preference } | null {
  if (!value || typeof value !== "object") return null;
  const body = value as { subscription?: unknown; preferences?: unknown };
  if (!body.subscription || typeof body.subscription !== "object" || !body.preferences || typeof body.preferences !== "object") return null;
  const sub = body.subscription as { endpoint?: unknown; expirationTime?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const pref = body.preferences as Record<string, unknown>;
  let endpoint: URL;
  try { endpoint = new URL(String(sub.endpoint)); } catch { return null; }
  if (!validPushEndpoint(endpoint.href) || !validKey(sub.keys?.p256dh, 40, 256) || !validKey(sub.keys?.auth, 16, 128)) return null;
  const region = optionalAllowed(pref.region, REGIONS), audience = optionalAllowed(pref.audience, Object.keys(AUDIENCES)), theme = optionalAllowed(pref.theme, Object.keys(THEMES));
  const new_event = bool(pref.new_event, true), schedule_changed = bool(pref.schedule_changed, true), cancelled_or_postponed = bool(pref.cancelled_or_postponed, true);
  if (region === undefined || audience === undefined || theme === undefined || new_event === null || schedule_changed === null || cancelled_or_postponed === null || (!region && !audience && !theme) || (!new_event && !schedule_changed && !cancelled_or_postponed)) return null;
  const expirationTime = sub.expirationTime === null || sub.expirationTime === undefined ? null : typeof sub.expirationTime === "number" && Number.isFinite(sub.expirationTime) && sub.expirationTime >= 0 ? Math.floor(sub.expirationTime) : null;
  return { subscription: { endpoint: endpoint.href, expirationTime, keys: { p256dh: sub.keys!.p256dh as string, auth: sub.keys!.auth as string } }, preferences: { region, audience, theme, new_event, schedule_changed, cancelled_or_postponed } };
}

export async function subscriptionId(endpoint: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return `push-${Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
export async function readPushBody(request: Request) {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json") || !Number.isFinite(length) || length > MAX_BODY_BYTES) return null;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return null;
    return JSON.parse(text) as unknown;
  } catch { return null; }
}
export async function upsertSubscription(env: Env, parsed: NonNullable<ReturnType<typeof parseSubscriptionRequest>>) {
  const id = await subscriptionId(parsed.subscription.endpoint), now = new Date().toISOString(), p = parsed.preferences, s = parsed.subscription;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO push_subscriptions(id,endpoint,p256dh,auth,expiration_time,created_at,updated_at,failure_count,disabled_at) VALUES(?,?,?,?,?,?,?,0,NULL) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,expiration_time=excluded.expiration_time,updated_at=excluded.updated_at,disabled_at=NULL").bind(id, s.endpoint, s.keys.p256dh, s.keys.auth, s.expirationTime, now, now),
    env.DB.prepare("INSERT INTO push_preferences(subscription_id,region,audience,theme,new_event,schedule_changed,cancelled_or_postponed,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(subscription_id) DO UPDATE SET region=excluded.region,audience=excluded.audience,theme=excluded.theme,new_event=excluded.new_event,schedule_changed=excluded.schedule_changed,cancelled_or_postponed=excluded.cancelled_or_postponed,updated_at=excluded.updated_at").bind(id, p.region, p.audience, p.theme, Number(p.new_event), Number(p.schedule_changed), Number(p.cancelled_or_postponed), now, now),
  ]);
  return id;
}
export async function disableSubscription(env: Env, endpoint: string) {
  const id = await subscriptionId(endpoint);
  await env.DB.prepare("UPDATE push_subscriptions SET disabled_at=COALESCE(disabled_at,?),updated_at=? WHERE id=?").bind(new Date().toISOString(), new Date().toISOString(), id).run();
}

function preferenceColumn(type: string) { return type === "NEW_EVENT" ? "new_event" : type === "SCHEDULE_CHANGED" ? "schedule_changed" : "cancelled_or_postponed"; }
async function queueAlert(env: Env, alert: { id: string; event_id: string; alert_type: string }) {
  const event = await env.DB.prepare("SELECT region FROM events WHERE id=?").bind(alert.event_id).first<{ region: string }>();
  if (!event) return;
  const rows = await env.DB.prepare(
    `SELECT ps.id FROM push_subscriptions ps JOIN push_preferences pp ON pp.subscription_id=ps.id
     WHERE ps.disabled_at IS NULL AND pp.${preferenceColumn(alert.alert_type)}=1
       AND (pp.region IS NULL OR pp.region=?)
       AND (pp.audience IS NULL OR EXISTS (SELECT 1 FROM event_companion_suitability cs WHERE cs.event_id=? AND cs.companion_type=CASE pp.audience WHEN 'kids' THEN 'child' WHEN 'couple' THEN 'couple' WHEN 'parents' THEN 'parents' WHEN 'pets' THEN 'pet' END AND cs.suitability_state=CASE pp.audience WHEN 'pets' THEN 'allowed' ELSE 'fit' END AND cs.classifier_type=? AND cs.rule_version=?))
       AND (pp.theme IS NULL OR EXISTS (SELECT 1 FROM event_tags et WHERE et.event_id=? AND et.tag=CASE pp.theme WHEN 'flowers' THEN 'flower_garden' ELSE pp.theme END AND et.classifier_type=? AND et.rule_version=?))
     LIMIT ?`,
  ).bind(event.region, alert.event_id, COMPANION_CLASSIFIER, COMPANION_RULE_VERSION, alert.event_id, FACT_CLASSIFIER, FACT_RULE_VERSION, MAX_DELIVERIES_PER_RUN).all<{ id: string }>();
  if (!rows.results.length) { await env.DB.prepare("UPDATE alert_events SET delivery_state='suppressed' WHERE id=? AND delivery_state='pending'").bind(alert.id).run(); return; }
  await env.DB.batch(rows.results.map((row) => env.DB.prepare("INSERT OR IGNORE INTO push_deliveries(alert_id,subscription_id,state,attempts) VALUES(?,?, 'pending',0)").bind(alert.id, row.id)));
}
export function notificationPayload(alert: { alert_type: string; dedupe_key: string; event_id: string; title: string; after_json: string | null }) {
  let status = "";
  try { status = (JSON.parse(alert.after_json ?? "{}") as { status?: string }).status ?? ""; } catch { /* factual fallback below */ }
  const body = alert.alert_type === "NEW_EVENT" ? `${alert.title} 새로 등록됐어요` : alert.alert_type === "SCHEDULE_CHANGED" ? `${alert.title} 일정이 변경됐어요` : status === "postponed" ? `${alert.title} 연기 안내가 확인됐어요` : `${alert.title} 취소 안내가 확인됐어요`;
  return { type: alert.alert_type, title: "갈틈", body, event_id: alert.event_id, url: `/?event=${encodeURIComponent(alert.event_id)}`, tag: `wtw:${alert.dedupe_key}` };
}
function retryAt(attempts: number) { return new Date(Date.now() + Math.min(24, 2 ** attempts) * 3600_000).toISOString(); }
async function refreshAlertState(env: Env, alertId: string) {
  const state = await env.DB.prepare("SELECT CASE WHEN EXISTS (SELECT 1 FROM push_deliveries WHERE alert_id=? AND state IN ('pending','retry')) THEN 'pending' WHEN EXISTS (SELECT 1 FROM push_deliveries WHERE alert_id=?) THEN 'delivered' ELSE 'suppressed' END AS state").bind(alertId, alertId).first<{ state: "pending" | "delivered" | "suppressed" }>();
  await env.DB.prepare("UPDATE alert_events SET delivery_state=? WHERE id=?").bind(state?.state ?? "suppressed", alertId).run();
}
export async function processPushDeliveries(env: Env) {
  if (pushStatus(env) !== "enabled") return { status: pushStatus(env), queued: 0, delivered: 0 };
  const alerts = await env.DB.prepare("SELECT id,event_id,alert_type FROM alert_events WHERE delivery_state='pending' ORDER BY created_at LIMIT ?").bind(MAX_ALERTS_PER_RUN).all<{ id: string; event_id: string; alert_type: string }>();
  for (const alert of alerts.results) await queueAlert(env, alert);
  const now = new Date().toISOString();
  const pending = await env.DB.prepare(
    `SELECT pd.alert_id,pd.subscription_id,pd.attempts,ps.endpoint,ps.p256dh,ps.auth,ae.alert_type,ae.dedupe_key,ae.event_id,ae.after_json,e.title
     FROM push_deliveries pd JOIN push_subscriptions ps ON ps.id=pd.subscription_id JOIN alert_events ae ON ae.id=pd.alert_id JOIN events e ON e.id=ae.event_id
     WHERE ps.disabled_at IS NULL AND (pd.state='pending' OR (pd.state='retry' AND (pd.next_attempt_at IS NULL OR pd.next_attempt_at<=?))) ORDER BY ae.created_at LIMIT ?`,
  ).bind(now, MAX_DELIVERIES_PER_RUN).all<Record<string, unknown>>();
  let delivered = 0, systemic = 0; const touched = new Set<string>();
  for (const row of pending.results) {
    const alertId = String(row.alert_id), subscriptionId = String(row.subscription_id), attempts = Number(row.attempts) + 1; touched.add(alertId);
    let status: number | null = null;
    try {
      const payload = await buildPushPayload({ data: notificationPayload({ alert_type: String(row.alert_type), dedupe_key: String(row.dedupe_key), event_id: String(row.event_id), title: String(row.title), after_json: row.after_json as string | null }), options: { ttl: 86400, urgency: "normal" } }, { endpoint: String(row.endpoint), expirationTime: null, keys: { p256dh: String(row.p256dh), auth: String(row.auth) } }, { publicKey: env.WEB_PUSH_VAPID_PUBLIC_KEY!, privateKey: env.WEB_PUSH_VAPID_PRIVATE_KEY!, subject: env.WEB_PUSH_VAPID_SUBJECT! });
      const response = await fetch(String(row.endpoint), payload); status = response.status;
      if (response.ok) { delivered++; await env.DB.batch([env.DB.prepare("UPDATE push_deliveries SET state='delivered',attempts=?,last_attempt_at=?,delivered_at=?,last_http_status=?,next_attempt_at=NULL WHERE alert_id=? AND subscription_id=?").bind(attempts, now, now, status, alertId, subscriptionId), env.DB.prepare("UPDATE push_subscriptions SET last_success_at=?,failure_count=0,updated_at=? WHERE id=?").bind(now, now, subscriptionId)]); continue; }
      if (status === 404 || status === 410) { await env.DB.batch([env.DB.prepare("UPDATE push_deliveries SET state='dead',attempts=?,last_attempt_at=?,last_http_status=?,next_attempt_at=NULL WHERE alert_id=? AND subscription_id=?").bind(attempts, now, status, alertId, subscriptionId), env.DB.prepare("UPDATE push_subscriptions SET disabled_at=COALESCE(disabled_at,?),updated_at=? WHERE id=?").bind(now, now, subscriptionId)]); continue; }
      if (status === 401 || status === 403) systemic++;
    } catch { /* retry without sensitive transport details */ }
    const exhausted = attempts >= MAX_ATTEMPTS;
    await env.DB.prepare("UPDATE push_deliveries SET state=?,attempts=?,next_attempt_at=?,last_attempt_at=?,last_http_status=? WHERE alert_id=? AND subscription_id=?").bind(exhausted ? "dead" : "retry", attempts, exhausted ? null : retryAt(attempts), now, status, alertId, subscriptionId).run();
    if (systemic >= 3) break;
  }
  for (const id of touched) await refreshAlertState(env, id);
  return { status: "enabled", queued: alerts.results.length, delivered, systemic };
}
