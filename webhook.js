// HMAC validation for Adyen standard webhooks.
// Adyen signs each NotificationRequestItem with HMAC-SHA256 over a colon-joined string of
// eight fields, keyed with the hex HMAC key from Customer Area, base64-encoded into
// additionalData.hmacSignature.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNED_FIELDS = [
  "pspReference",
  "originalReference",
  "merchantAccountCode",
  "merchantReference",
  "amount.value",
  "amount.currency",
  "eventCode",
  "success",
];

function field(item, path) {
  let cur = item;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object" || !(part in cur)) return "";
    cur = cur[part];
  }
  return cur == null ? "" : String(cur);
}

/** The exact string Adyen signs. Backslashes and colons inside values are escaped. */
export function signingString(item) {
  return SIGNED_FIELDS.map((p) => field(item, p).replace(/\\/g, "\\\\").replace(/:/g, "\\:")).join(":");
}

export function computeSignature(item, hmacKeyHex) {
  if (!/^[0-9a-fA-F]+$/.test(hmacKeyHex) || hmacKeyHex.length % 2 !== 0) {
    throw new Error("ADYEN_HMAC_KEY must be the hex string from Customer Area");
  }
  const key = Buffer.from(hmacKeyHex, "hex");
  return createHmac("sha256", key).update(signingString(item), "utf8").digest("base64");
}

export function isValid(item, hmacKeyHex) {
  const provided = item?.additionalData?.hmacSignature;
  if (!provided) return false;
  const expected = computeSignature(item, hmacKeyHex);
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
