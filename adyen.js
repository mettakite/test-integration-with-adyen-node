// Thin wrapper around the one Checkout API call this app makes: POST /sessions.
// Plain fetch, no SDK, so the request and response shapes stay visible.
import { randomUUID } from "node:crypto";

export class AdyenConfigError extends Error {}

function required(name) {
  const v = (process.env[name] || "").trim();
  if (!v) throw new AdyenConfigError(`${name} is not set. Copy .env.example to .env and fill it in.`);
  return v;
}

/** Build the body for POST /sessions. amount is in minor units: 1000 EUR = EUR 10.00. */
export function buildSessionRequest({ amountMinor, currency, countryCode, merchantAccount, returnUrl, reference }) {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new RangeError("amountMinor must be a positive integer in minor units");
  }
  return {
    amount: { value: amountMinor, currency },
    reference: reference || `test-${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    returnUrl,
    merchantAccount,
    countryCode,
  };
}

/** POST /sessions and return Adyen's response. Throws with Adyen's error body on 4xx/5xx. */
export async function createSession(body, { fetchImpl = fetch } = {}) {
  const apiKey = required("ADYEN_API_KEY");
  const base = (process.env.ADYEN_CHECKOUT_URL || "https://checkout-test.adyen.com/v71").replace(/\/$/, "");
  const res = await fetchImpl(`${base}/sessions`, {
    method: "POST",
    headers: { "x-API-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    // Adyen returns {"status":403,"errorCode":"901","message":"Invalid Merchant Account",...}
    const err = new Error(`${res.status} from /sessions: ${text}`);
    err.status = res.status;
    throw err;
  }
  return JSON.parse(text);
}
