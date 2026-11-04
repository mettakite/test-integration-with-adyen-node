// Test Integration with Adyen (Node).
//
// A minimal end-to-end Adyen Checkout integration using the Sessions flow and Drop-in v6:
//
//   browser  --POST /api/sessions-->  this server  --POST /v71/sessions-->  Adyen
//   browser  <-- { id, sessionData } --  this server
//   Drop-in renders, shopper pays, Adyen posts a webhook to /api/webhooks/notifications
//
// The server never sees card details. Drop-in collects them inside Adyen's iframe, which is
// what keeps this integration at SAQ A.
//
// Run:  cp .env.example .env  (fill it in)  then  npm start
import "dotenv/config";
import express from "express";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildSessionRequest, createSession, AdyenConfigError } from "./adyen.js";
import { isValid } from "./webhook.js";

// Resolve public/ relative to this module so the app runs from any working directory.
const __dirname = dirname(fileURLToPath(import.meta.url));

// Build an Express app with its own in-memory state. Tests pass a fake sessionCreator so
// nothing reaches Adyen.
export function createApp({ sessionCreator = createSession } = {}) {
  const app = express();
  app.use(express.json());
  app.use("/static", express.static(join(__dirname, "public")));

  // Every webhook that passes HMAC lands in `received`, visible at /api/webhooks/received.
  const received = [];
  // Adyen retries a notification until it gets a 200 and can deliver the same one more than
  // once. (pspReference, eventCode) identifies an event; a repeat is acknowledged, not recorded.
  const seen = new Set();
  const duplicates = [];
  app.locals.state = { received, seen, duplicates };

  // Read an HTML file from public/ and replace {{ placeholders }} with plain strings.
  const render = (file, vars) => {
    let html = readFileSync(join(__dirname, "public", file), "utf8");
    for (const [k, v] of Object.entries(vars)) html = html.replaceAll(`{{ ${k} }}`, String(v ?? ""));
    return html;
  };

  // Checkout page. The client key is the browser-side credential; the API key never leaves the server.
  app.get("/", (req, res) => {
    res.type("html").send(render("index.html", { client_key: process.env.ADYEN_CLIENT_KEY || "", environment: "test" }));
  });

  // Adyen sends the shopper back here after a redirect payment method (iDEAL, 3DS, ...), with
  // sessionId and redirectResult in the query string. The page rebuilds the checkout from the
  // session id and hands redirectResult to Drop-in; the webhook remains the source of truth.
  app.get("/redirect", (req, res) => {
    res.type("html").send(render("redirect.html", {
      client_key: process.env.ADYEN_CLIENT_KEY || "",
      environment: "test",
      session_id: req.query.sessionId || "",
      redirect_result: req.query.redirectResult || "",
    }));
  });

  // Create a Checkout session for Drop-in. Body (all optional):
  // { "amount": 1000, "currency": "EUR", "countryCode": "NL" }
  // Defaults to EUR 10.00 for a shopper in the Netherlands; amount is already in minor units.
  app.post("/api/sessions", async (req, res) => {
    const data = req.body || {};
    try {
      const body = buildSessionRequest({
        amountMinor: Number(data.amount ?? 1000),
        currency: String(data.currency ?? "EUR"),
        countryCode: String(data.countryCode ?? "NL"),
        merchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT || "",
        returnUrl: process.env.RETURN_URL || "http://localhost:8081/redirect",
        reference: data.reference,
      });
      if (!body.merchantAccount) throw new AdyenConfigError("ADYEN_MERCHANT_ACCOUNT is not set");
      console.log(`POST /sessions reference=${body.reference} amount=${body.amount.value} ${body.amount.currency}`);
      const session = await sessionCreator(body);
      // Drop-in needs only id and sessionData; the reference is returned for your logs.
      res.json({ id: session.id, sessionData: session.sessionData, reference: body.reference });
    } catch (err) {
      // Missing configuration is a 500, a bad amount is a 400, anything Adyen rejected is a 502.
      if (err instanceof AdyenConfigError) return res.status(500).json({ error: err.message });
      if (err instanceof RangeError) return res.status(400).json({ error: err.message });
      console.error("session creation failed:", err.message);
      res.status(502).json({ error: err.message });
    }
  });

  // Adyen standard webhook receiver. Adyen expects HTTP 200 within 10 seconds; anything else and
  // it retries with backoff. Each NotificationRequestItem is HMAC-checked before it is recorded.
  // Items that fail HMAC are logged and dropped but still acknowledged, so Adyen stops retrying
  // a tampered item.
  app.post("/api/webhooks/notifications", (req, res) => {
    const key = process.env.ADYEN_HMAC_KEY || "";
    if (!key) {
      console.error("ADYEN_HMAC_KEY not set; refusing to accept webhooks");
      return res.status(500).json({ error: "HMAC key not configured" });
    }
    const items = req.body?.notificationItems || [];
    for (const wrapper of items) {
      const item = wrapper.NotificationRequestItem || {};
      if (!isValid(item, key)) {
        console.warn(`HMAC failed for pspReference=${item.pspReference}; dropped`);
        continue;
      }
      // A pspReference can carry several events (AUTHORISATION, CAPTURE, REFUND), so the
      // dedupe key is the pair.
      const eventKey = `${item.pspReference}|${item.eventCode}`;
      if (seen.has(eventKey)) {
        duplicates.push({ receivedAt: new Date().toISOString(), pspReference: item.pspReference, eventCode: item.eventCode });
        console.log(`duplicate delivery ${eventKey}; acknowledged, not recorded`);
        continue;
      }
      seen.add(eventKey);
      // Keep the fields worth reading back. receivedAt is local receipt time, not Adyen's event time.
      const record = {
        receivedAt: new Date().toISOString(),
        eventCode: item.eventCode,
        success: item.success,
        pspReference: item.pspReference,
        merchantReference: item.merchantReference,
        amount: item.amount,
        reason: item.reason,
      };
      received.push(record);
      console.log("webhook", JSON.stringify(record));
    }
    // "[accepted]" is the legacy body; HTTP 200 is what Adyen checks today. Send both, even when
    // some items were dropped, so Adyen does not retry the whole batch.
    res.type("text/plain").send("[accepted]");
  });

  // Inspection endpoint for the demo: what was recorded, and what was acknowledged as a repeat.
  app.get("/api/webhooks/received", (req, res) => {
    res.json({ accepted: received, duplicatesAcknowledged: duplicates });
  });

  app.get("/healthz", (req, res) => res.json({ ok: true }));

  return app;
}

// Listen only when Node runs this file directly; tests import createApp() instead.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 8081);
  createApp().listen(port, () => console.log(`listening on http://localhost:${port}`));
}
