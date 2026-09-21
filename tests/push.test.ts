import test from "node:test";
import assert from "node:assert/strict";
import { notificationPayload, parseSubscriptionRequest, pushStatus, subscriptionId, validPushEndpoint } from "../worker/push";

const subscription = { endpoint: "https://push.example.test/send/opaque", expirationTime: null, keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) } };

test("push subscriptions validate scope, endpoint and idempotent endpoint identity", async () => {
  const valid = parseSubscriptionRequest({ subscription, preferences: { region: "경기", audience: "kids", theme: "experience", new_event: true, schedule_changed: true, cancelled_or_postponed: true } });
  assert(valid);
  assert.equal(valid?.preferences.region, "경기");
  assert.equal(parseSubscriptionRequest({ subscription: { ...subscription, endpoint: "http://unsafe.test" }, preferences: { region: "경기" } }), null);
  assert.equal(parseSubscriptionRequest({ subscription, preferences: { region: "없는 지역" } }), null);
  assert.equal(parseSubscriptionRequest({ subscription, preferences: {} }), null);
  assert.equal(validPushEndpoint(subscription.endpoint), true);
  assert.equal(await subscriptionId(subscription.endpoint), await subscriptionId(subscription.endpoint));
});

test("notification payload remains factual and uses an internal deterministic click target", () => {
  const cancelled = notificationPayload({ alert_type: "CANCELLED_OR_POSTPONED", dedupe_key: "status:e:cancelled", event_id: "행사/한글", title: "행사", after_json: '{"status":"cancelled"}' });
  assert.deepEqual(cancelled, { type: "CANCELLED_OR_POSTPONED", title: "주말뭐해?", body: "행사 취소 안내가 확인됐어요", event_id: "행사/한글", url: "/?event=%ED%96%89%EC%82%AC%2F%ED%95%9C%EA%B8%80", tag: "wtw:status:e:cancelled" });
  assert.equal(notificationPayload({ alert_type: "CANCELLED_OR_POSTPONED", dedupe_key: "status:e:postponed", event_id: "e", title: "행사", after_json: '{"status":"postponed"}' }).body, "행사 연기 안내가 확인됐어요");
  assert.equal(notificationPayload({ alert_type: "NEW_EVENT", dedupe_key: "new:e", event_id: "e", title: "행사", after_json: null }).body, "행사 새로 등록됐어요");
});

test("push health status never exposes configuration values", () => {
  assert.equal(pushStatus({ WEB_PUSH_ENABLED: "false" } as never), "disabled");
  assert.equal(pushStatus({ WEB_PUSH_ENABLED: "true" } as never), "misconfigured");
  assert.equal(pushStatus({ WEB_PUSH_ENABLED: "true", WEB_PUSH_VAPID_PUBLIC_KEY: "public", WEB_PUSH_VAPID_PRIVATE_KEY: "private", WEB_PUSH_VAPID_SUBJECT: "https://example.test" } as never), "enabled");
});
