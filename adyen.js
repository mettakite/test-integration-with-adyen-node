// Thin wrapper around the one Checkout API call this app makes: POST /sessions.
// Plain fetch, no SDK, so the request and response shapes stay visible.
import { randomUUID } from "node:crypto";

// A distinct error type for missing configuration, so the server can map it to a 500.
export class AdyenConfigError extends Error {}

// Read a named environment variable; a blank or missing value is a configuration error.
function required(name) {
  const v = (process.env[name] || "").trim();
  if (!v) throw new AdyenConfigError(`${name} is not set. Copy .env.example to .env and fill it in.`);
  return v;
}

/**
 * Build the body for POST /sessions. amount is in minor units: 1000 EUR = EUR 10.00.
 * There is no card data here. The session tells Adyen what the payment is for; Drop-in
 * collects the payment method in the browser.
 */
export function buildSessionRequest({ amountMinor, currency, countryCode, merchantAccount, returnUrl, reference }) {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new RangeError("amountMinor must be a positive integer in minor units");
  }
  return {
    amount: { value: amountMinor, currency },
    // Use the caller's reference when given; otherwise generate a short test reference.
    reference: reference || `test-${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    // Where Adyen sends the shopper back if the payment method redirects away.
    returnUrl,
    // The merchant account that processes the payment, under the company account.
    merchantAccount,
    // The shopper's country; Adyen uses it to decide which payment methods to offer.
    countryCode,
  };
}

/**
 * POST /sessions and return Adyen's response. Throws with Adyen's error body on 4xx/5xx.
 * Tests pass a fake fetchImpl so nothing reaches Adyen.
 */
export async function createSession(body, { fetchImpl = fetch } = {}) {
  const apiKey = required("ADYEN_API_KEY");
  // Default to the v71 test endpoint; strip a trailing slash before appending /sessions.
  const base = (process.env.ADYEN_CHECKOUT_URL || "https://checkout-test.adyen.com/v71").replace(/\/$/, "");
  const res = await fetchImpl(`${base}/sessions`, {
    method: "POST",
    headers: { "x-API-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  // Read the body as text so an HTTP error can carry whatever Adyen returned.
  const text = await res.text();
  if (!res.ok) {
    // Adyen returns {"status":403,"errorCode":"901","message":"Invalid Merchant Account",...}
    const err = new Error(`${res.status} from /sessions: ${text}`);
    err.status = res.status;
    throw err;
  }
  // The full response; the server forwards only id and sessionData to the browser.
  return JSON.parse(text);
}
