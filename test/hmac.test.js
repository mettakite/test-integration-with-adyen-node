import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { signingString, computeSignature, isValid } from "../webhook.js";

import { DOC_KEY, DOC_ITEM } from "./fixture.js";

test("signing string order and blank originalReference", () => {
  assert.equal(signingString(DOC_ITEM), "7914073381342284::TestMerchant:TestPayment-1407325143704:1130:EUR:AUTHORISATION:true");
});

test("Adyen's published vector matches", () => {
  assert.equal(computeSignature(DOC_ITEM, DOC_KEY), DOC_ITEM.additionalData.hmacSignature);
  assert.ok(isValid(DOC_ITEM, DOC_KEY));
});

test("independent stdlib computation agrees", () => {
  const expected = createHmac("sha256", Buffer.from(DOC_KEY, "hex")).update(signingString(DOC_ITEM)).digest("base64");
  assert.equal(computeSignature(DOC_ITEM, DOC_KEY), expected);
});

test("tampered amount fails", () => {
  assert.equal(isValid({ ...DOC_ITEM, amount: { value: 1131, currency: "EUR" } }, DOC_KEY), false);
});

test("missing signature fails", () => {
  assert.equal(isValid({ ...DOC_ITEM, additionalData: {} }, DOC_KEY), false);
});

test("colons in values are escaped", () => {
  assert.match(signingString({ ...DOC_ITEM, merchantReference: "order:42" }), /order\\:42/);
});

test("bad key throws", () => {
  assert.throws(() => computeSignature(DOC_ITEM, "not-hex"));
});
