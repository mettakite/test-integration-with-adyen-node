import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";
import { DOC_ITEM, DOC_KEY } from "./fixture.js";

const envelope = (item) => ({ live: "false", notificationItems: [{ NotificationRequestItem: item }] });

let app, server, base;
beforeEach(async () => {
  process.env.ADYEN_HMAC_KEY = DOC_KEY;
  process.env.ADYEN_CLIENT_KEY = "test_client";
  app = createApp({ sessionCreator: async () => ({ id: "CS123", sessionData: "Ab02b4c0!fake" }) });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => new Promise((r) => { server.closeAllConnections(); server.close(r); }));

// "connection: close" so no keep-alive socket outlives its test and the process can exit.
const get = (path) => fetch(base + path, { headers: { connection: "close" } });
const post = (path, body) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", connection: "close" }, body: JSON.stringify(body) });

test("index renders with the client key injected", async () => {
  const res = await get("/");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /clientKey: "test_client"/);
  assert.doesNotMatch(html, /\{\{ client_key \}\}/);
});

test("valid webhook is accepted and recorded", async () => {
  const res = await post("/api/webhooks/notifications", envelope(DOC_ITEM));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "[accepted]");
  const got = await (await get("/api/webhooks/received")).json();
  assert.equal(got.accepted.length, 1);
  assert.equal(got.accepted[0].pspReference, "7914073381342284");
});

test("duplicate delivery is acknowledged once", async () => {
  for (let i = 0; i < 3; i++) assert.equal((await post("/api/webhooks/notifications", envelope(DOC_ITEM))).status, 200);
  const got = await (await get("/api/webhooks/received")).json();
  assert.equal(got.accepted.length, 1);
  assert.equal(got.duplicatesAcknowledged.length, 2);
});

test("tampered webhook is dropped but still 200", async () => {
  const res = await post("/api/webhooks/notifications", envelope({ ...DOC_ITEM, amount: { value: 999999, currency: "EUR" } }));
  assert.equal(res.status, 200);
  const got = await (await get("/api/webhooks/received")).json();
  assert.equal(got.accepted.length, 0);
});

test("missing HMAC key is a server error", async () => {
  delete process.env.ADYEN_HMAC_KEY;
  const res = await post("/api/webhooks/notifications", envelope(DOC_ITEM));
  assert.equal(res.status, 500);
});

test("sessions endpoint reports missing merchant account", async () => {
  delete process.env.ADYEN_MERCHANT_ACCOUNT;
  const res = await post("/api/sessions", { amount: 1000 });
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /ADYEN_MERCHANT_ACCOUNT/);
});

test("sessions endpoint returns id and sessionData", async () => {
  process.env.ADYEN_MERCHANT_ACCOUNT = "TestMerchant";
  const res = await post("/api/sessions", { amount: 1000, currency: "EUR", countryCode: "NL" });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.id, "CS123");
  assert.ok(json.reference.startsWith("test-"));
});
