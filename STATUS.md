# Status

Last updated: 2026-10-19

## Done (verified in this repo)

- [x] Express server with `/`, `/redirect`, `POST /api/sessions`, `POST /api/webhooks/notifications`, `GET /api/webhooks/received`, `/healthz`
- [x] `/sessions` request builder with validation; Adyen error bodies surfaced verbatim
- [x] HMAC verification matching Adyen's published example and cross-checked against an independent `crypto` computation
- [x] Idempotent webhook handling on `pspReference` + `eventCode`
- [x] Drop-in v6 from the CDN (6.46.0), Sessions flow, every lifecycle callback logged to the page
- [x] Redirect landing page using `submitDetails({ details: { redirectResult } })`
- [x] 19 passing tests on `node --test`, no test framework dependency
- [x] Server boots without credentials; endpoints fail loudly naming the missing env var

## Not yet done

- [x] Live run with test credentials: `Authorised` on session `CSBDFE6AA7D8662CF2E84A2AB` (2026-10-19)
- [x] Authorised screenshot in the README
- [ ] Real webhook through a tunnel
- [ ] iDEAL round trip, refund flow

## Node-specific notes for the friction log

- Node 18+ ships `fetch`, so no HTTP client is needed; the official `@adyen/api-library` was left out on purpose so the request shape stays visible.
- `node --test` with a server per test: undici keeps sockets alive, so tests that start a listener must send `connection: close` or call `server.closeAllConnections()` in teardown, or the process never exits. Not an Adyen problem, but a thing every Node sample app hits.
