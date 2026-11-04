// HMAC validation for Adyen standard webhooks.
// Adyen signs each NotificationRequestItem with HMAC-SHA256 over a colon-joined string of
// eight fields, keyed with the hex HMAC key from Customer Area, base64-encoded into
// additionalData.hmacSignature. A matching signature proves the item came from Adyen and
// was not altered in transit.
import { createHmac, timingSafeEqual } from "node:crypto";

// The eight field paths Adyen signs, in signing order. A missing field keeps its place as "".
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

// Follow a dot-separated path such as "amount.value" into the item. null and undefined become
// ""; other values, including 0 and false, become their string form.
function field(item, path) {
  let cur = item;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object" || !(part in cur)) return "";
    cur = cur[part];
  }
  return cur == null ? "" : String(cur);
}

/**
 * The exact string Adyen signs: each value with backslashes and colons escaped, joined by colons.
 * The escaping rule is not on Adyen's "Verify HMAC signatures" page; the test suite checks it
 * against Adyen's published vector.
 */
export function signingString(item) {
  return SIGNED_FIELDS.map((p) => field(item, p).replace(/\\/g, "\\\\").replace(/:/g, "\\:")).join(":");
}

// The signature we expect for this item: decode the hex key to bytes, HMAC-SHA256 the signing
// string, return base64. The key must be hex with an even number of digits (two digits per byte).
export function computeSignature(item, hmacKeyHex) {
  if (!/^[0-9a-fA-F]+$/.test(hmacKeyHex) || hmacKeyHex.length % 2 !== 0) {
    throw new Error("ADYEN_HMAC_KEY must be the hex string from Customer Area");
  }
  const key = Buffer.from(hmacKeyHex, "hex");
  return createHmac("sha256", key).update(signingString(item), "utf8").digest("base64");
}

// Compare the signature Adyen sent with the one computed locally. timingSafeEqual needs equal
// lengths, so check that first; a length mismatch is simply invalid.
export function isValid(item, hmacKeyHex) {
  const provided = item?.additionalData?.hmacSignature;
  if (!provided) return false;
  const expected = computeSignature(item, hmacKeyHex);
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
