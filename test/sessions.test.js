import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSessionRequest, createSession, AdyenConfigError } from "../adyen.js";

test("session request shape", () => {
  const body = buildSessionRequest({
    amountMinor: 1000, currency: "EUR", countryCode: "NL",
    merchantAccount: "TestMerchant", returnUrl: "http://localhost:8081/redirect", reference: "order-1",
  });
  assert.deepEqual(body, {
    amount: { value: 1000, currency: "EUR" },
    reference: "order-1",
    returnUrl: "http://localhost:8081/redirect",
    merchantAccount: "TestMerchant",
    countryCode: "NL",
  });
});

test("reference generated when missing", () => {
  const body = buildSessionRequest({ amountMinor: 5, currency: "USD", countryCode: "US", merchantAccount: "M", returnUrl: "http://x/r" });
  assert.ok(body.reference.startsWith("test-") && body.reference.length > 10);
});

test("rejects non-positive amount", () => {
  assert.throws(() => buildSessionRequest({ amountMinor: 0, currency: "EUR", countryCode: "NL", merchantAccount: "M", returnUrl: "http://x/r" }), RangeError);
});

test("createSession requires the API key", async () => {
  delete process.env.ADYEN_API_KEY;
  await assert.rejects(createSession({ amount: { value: 1, currency: "EUR" } }), AdyenConfigError);
});

test("createSession surfaces Adyen's error body", async () => {
  process.env.ADYEN_API_KEY = "x";
  const fetchImpl = async () => new Response('{"status":403,"errorCode":"901","message":"Invalid Merchant Account"}', { status: 403 });
  await assert.rejects(createSession({}, { fetchImpl }), /403 from \/sessions: .*Invalid Merchant Account/);
});
