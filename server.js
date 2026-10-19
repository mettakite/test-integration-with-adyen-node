// Test Integration with Adyen (Node).
//
// A minimal end-to-end Adyen Checkout integration using the Sessions flow and Drop-in v6:
//
//   browser  --POST /api/sessions-->  this server  --POST /v71/sessions-->  Adyen
//   browser  <-- { id, sessionData } --  this server
//   Drop-in renders, shopper pays, Adyen posts a webhook to /api/webhooks/notifications
//
// Run:  cp .env.example .env  (fill it in)  then  npm start
import "dotenv/config";
import express from "express";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildSessionRequest, createSession, AdyenConfigError } from "./adyen.js";
import { isValid } from "./webhook.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp({ sessionCreator = createSession } = {}) {
  const app = express();
  app.use(express.json());
  app.use("/static", express.static(join(__dirname, "public")));

  // Every webhook that passes HMAC lands here so you can see it at /api/webhooks/received.
  const received = [];
  // Adyen retries a notification until it gets a 200 and can deliver the same one more than
  // once. (pspReference, eventCode) identifies an event; a repeat is acknowledged, not recorded.
  const seen = new Set();
  const duplicates = [];
  app.locals.state = { received, seen, duplicates };

  const render = (file, vars) => {
    let html = readFileSync(join(__dirname, "public", file), "utf8");
    for (const [k, v] of Object.entries(vars)) html = html.replaceAll(`{{ ${k} }}`, String(v ?? ""));
    return html;
  };

  app.get("/", (req, res) => {
    res.type("html").send(render("index.html", { client_key: process.env.ADYEN_CLIENT_KEY || "", environment: "test" }));
  });

  // Adyen sends the shopper back here after a redirect payment method (iDEAL, 3DS, ...).
  // The page hands redirectResult to Drop-in; the webhook remains the source of truth.
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
      // Drop-in needs only id and sessionData; the rest is for your logs.
      res.json({ id: session.id, sessionData: session.sessionData, reference: body.reference });
    } catch (err) {
      if (err instanceof AdyenConfigError) return res.status(500).json({ error: err.message });
      if (err instanceof RangeError) return res.status(400).json({ error: err.message });
      console.error("session creation failed:", err.message);
      res.status(502).json({ error: err.message });
    }
  });

  // Adyen standard webhook receiver. Adyen expects HTTP 200 within 10 seconds; anything else and
  // it retries with backoff. Items that fail HMAC are logged and dropped but still acknowledged,
  // so Adyen stops retrying a tampered item.
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
      const eventKey = `${item.pspReference}|${item.eventCode}`;
      if (seen.has(eventKey)) {
        duplicates.push({ receivedAt: new Date().toISOString(), pspReference: item.pspReference, eventCode: item.eventCode });
        console.log(`duplicate delivery ${eventKey}; acknowledged, not recorded`);
        continue;
      }
      seen.add(eventKey);
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
    // "[accepted]" is the legacy body; HTTP 200 is what Adyen checks today. Send both.
    res.type("text/plain").send("[accepted]");
  });

  app.get("/api/webhooks/received", (req, res) => {
    res.json({ accepted: received, duplicatesAcknowledged: duplicates });
  });

  app.get("/healthz", (req, res) => res.json({ ok: true }));

  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 8081);
  createApp().listen(port, () => console.log(`listening on http://localhost:${port}`));
}
