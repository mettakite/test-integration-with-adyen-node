// After a redirect payment method, Adyen returns the shopper to RETURN_URL with
// ?sessionId=...&redirectResult=... . Re-create the checkout from the session id and
// hand the redirectResult back so Adyen can finalize.
(async () => {
  const { AdyenCheckout } = window.AdyenWeb;
  const log = document.getElementById("result-log");
  const cfg = window.ADYEN_CONFIG;
  if (!cfg.sessionId || !cfg.redirectResult) {
    log.textContent = "Missing sessionId or redirectResult in the URL.";
    return;
  }
  try {
    const checkout = await AdyenCheckout({
      environment: cfg.environment,
      clientKey: cfg.clientKey,
      session: { id: cfg.sessionId },
      onPaymentCompleted(result) {
        log.textContent = JSON.stringify({ event: "onPaymentCompleted", resultCode: result.resultCode }, null, 2);
      },
      onPaymentFailed(result) {
        log.textContent = JSON.stringify({ event: "onPaymentFailed", resultCode: result.resultCode }, null, 2);
      },
      onError(error) {
        log.textContent = JSON.stringify({ event: "onError", message: error.message }, null, 2);
      },
    });
    checkout.submitDetails({ details: { redirectResult: cfg.redirectResult } });
  } catch (err) {
    log.textContent = `Failed: ${err.message}`;
  }
})();
