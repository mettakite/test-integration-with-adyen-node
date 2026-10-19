// Sessions flow with Adyen Web v6 loaded from the CDN (window.AdyenWeb).
// 1. POST /api/sessions on our server -> { id, sessionData }
// 2. AdyenCheckout({ session }) then new Dropin(checkout).mount()
// 3. Drop-in talks to Adyen directly for the payment; callbacks report the outcome.

const AW = window.AdyenWeb || {};
const { AdyenCheckout, Dropin, Card } = AW;
const Ideal = AW.Ideal; // optional; v6 exports it, but guard anyway

const sessionLog = document.getElementById("session-log");
const resultLog = document.getElementById("result-log");
let dropin = null;

function show(el, obj) {
  el.textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
}

document.getElementById("session-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (dropin) { dropin.unmount(); dropin = null; }
  show(sessionLog, "Creating session...");
  show(resultLog, "No payment yet.");

  const body = {
    amount: Number(document.getElementById("amount").value),
    currency: document.getElementById("currency").value.trim().toUpperCase(),
    countryCode: document.getElementById("country").value.trim().toUpperCase(),
  };

  let session;
  try {
    const res = await fetch("/api/sessions", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    session = await res.json();
    if (!res.ok) throw new Error(session.error || `HTTP ${res.status}`);
  } catch (err) {
    show(sessionLog, `Session failed: ${err.message}`);
    return;
  }
  show(sessionLog, { reference: session.reference, id: session.id, sessionData: session.sessionData.slice(0, 32) + "..." });

  const checkout = await AdyenCheckout({
    environment: window.ADYEN_CONFIG.environment,
    clientKey: window.ADYEN_CONFIG.clientKey,
    session: { id: session.id, sessionData: session.sessionData },
    countryCode: body.countryCode,
    amount: { value: body.amount, currency: body.currency },
    locale: "en-US",
    onPaymentCompleted(result, component) {
      // result.resultCode: Authorised | Pending | Received | Refused ...
      show(resultLog, { event: "onPaymentCompleted", resultCode: result.resultCode, sessionResult: result.sessionResult });
    },
    onPaymentFailed(result, component) {
      show(resultLog, { event: "onPaymentFailed", resultCode: result.resultCode });
    },
    onError(error, component) {
      show(resultLog, { event: "onError", name: error.name, message: error.message });
    },
    onChange(state, component) {
      // Fires as the shopper types. isValid flips true when the card form is complete.
      show(resultLog, { event: "onChange", isValid: state.isValid, paymentMethod: state.data?.paymentMethod?.type });
    },
    onAdditionalDetails(state, component) {
      show(resultLog, { event: "onAdditionalDetails (3DS/redirect step)", data: Object.keys(state.data || {}) });
    },
  });

  try {
    const components = [Card, Ideal].filter(Boolean);
    dropin = new Dropin(checkout, {
      paymentMethodComponents: components,
      showPayButton: true,
    }).mount("#dropin-container");
    show(resultLog, { event: "dropin mounted", components: components.map((c) => c.type || c.name), paymentMethods: (checkout.paymentMethodsResponse?.paymentMethods || []).map((m) => m.type) });
  } catch (err) {
    show(resultLog, { event: "dropin mount failed", message: err.message });
    console.error(err);
  }
});
