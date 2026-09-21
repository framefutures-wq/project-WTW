import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { parseSubscriptionRequest, processPushDeliveries, upsertSubscription } from "../worker/push";

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
async function vapid() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = await crypto.subtle.exportKey("jwk", pair.publicKey), priv = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: b64(new Uint8Array([4, ...Buffer.from(pub.x!, "base64url"), ...Buffer.from(pub.y!, "base64url")])), privateKey: priv.d! };
}
async function client() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  return { p256dh: b64(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))), auth: b64(crypto.getRandomValues(new Uint8Array(16))) };
}
async function setup() {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default {fetch(){return new Response('ok')}}", compatibilityDate: "2026-09-18", d1Databases: ["DB"], cf: false }));
  const DB = await mf.getD1Database("DB");
  for (const file of readdirSync("migrations").sort()) for (const sql of readFileSync(`migrations/${file}`, "utf8").split(";").map((part) => part.trim()).filter(Boolean)) await DB.prepare(sql).run();
  const now = new Date().toISOString();
  await DB.batch([
    DB.prepare("INSERT INTO sources(id,kind,priority,name,url,fetched_at) VALUES('s','tourapi',3,'source','https://example.test',?)").bind(now),
    DB.prepare("INSERT INTO events(id,title,description,region,venue,address,start_date,end_date,status,verification,is_sample,primary_source_id,checked_at) VALUES('e','행사','설명','경기','장소','주소','2026-10-03','2026-10-04','scheduled','verified',0,'s',?)").bind(now),
  ]);
  const keys = await vapid();
  return { mf, DB, env: { DB, APP_MODE: "production", TOUR_API_ENABLED: "false", ASSETS: {}, WEB_PUSH_ENABLED: "true", WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: keys.privateKey, WEB_PUSH_VAPID_SUBJECT: "https://example.test" } };
}
async function addSubscription(env: any, endpoint: string) {
  const keys = await client();
  const parsed = parseSubscriptionRequest({ subscription: { endpoint, expirationTime: null, keys }, preferences: { region: "경기" } });
  assert(parsed); await upsertSubscription(env, parsed!);
}
async function addAlert(DB: D1Database, id: string) {
  await DB.prepare("INSERT INTO alert_events(id,event_id,alert_type,dedupe_key,created_at,after_json,delivery_state) VALUES(?,?, 'NEW_EVENT',?,?,?, 'pending')").bind(id, "e", `new:${id}`, new Date().toISOString(), "{}",).run();
}

test("delivery queue matches scoped subscriptions once, handles dead endpoints and retries", async () => {
  const { mf, DB, env } = await setup(); const original = globalThis.fetch;
  try {
    await addSubscription(env, "https://push.example.test/one"); await addAlert(DB, "a1");
    globalThis.fetch = (async () => new Response("", { status: 201 })) as typeof fetch;
    await processPushDeliveries(env as never);
    assert.deepEqual(await DB.prepare("SELECT state,attempts FROM push_deliveries WHERE alert_id='a1'").first(), { state: "delivered", attempts: 1 });
    await processPushDeliveries(env as never);
    assert.equal((await DB.prepare("SELECT count(*) n FROM push_deliveries WHERE alert_id='a1'").first<{ n: number }>())?.n, 1);
    await addAlert(DB, "a2"); globalThis.fetch = (async () => new Response("", { status: 410 })) as typeof fetch;
    await processPushDeliveries(env as never);
    assert.equal((await DB.prepare("SELECT state FROM push_deliveries WHERE alert_id='a2'").first<{ state: string }>())?.state, "dead");
    assert((await DB.prepare("SELECT disabled_at FROM push_subscriptions").first<{ disabled_at: string | null }>())?.disabled_at);
    await addSubscription(env, "https://push.example.test/two"); await addAlert(DB, "a3"); globalThis.fetch = (async () => new Response("", { status: 500 })) as typeof fetch;
    await processPushDeliveries(env as never);
    assert.equal((await DB.prepare("SELECT state,attempts FROM push_deliveries WHERE alert_id='a3'").first<{ state: string; attempts: number }>())?.state, "retry");
  } finally { globalThis.fetch = original; await mf.dispose(); }
});
