/**
 * LINE HMAC-SHA256 signature verification (D408).
 *
 * Per LINE Developers docs:
 *   signature = base64(hmac_sha256(channelSecret, rawBody))
 *
 * Carried in header `X-Line-Signature`.
 *
 * Always uses `crypto.timingSafeEqual` to prevent timing attacks.
 */

import crypto from "node:crypto";

export function computeLineSignature(channelSecret: string, rawBody: string): string {
  return crypto.createHmac("sha256", channelSecret).update(rawBody, "utf8").digest("base64");
}

export function verifyLineSignature(
  channelSecret: string,
  rawBody: string,
  signatureHeader: string | undefined,
): boolean {
  if (signatureHeader === undefined || signatureHeader.length === 0) return false;
  const expected = computeLineSignature(channelSecret, rawBody);
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
