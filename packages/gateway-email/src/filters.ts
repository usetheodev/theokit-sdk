/**
 * Inbound filters: automated-sender (D332) + allowed-sender allowlist (D333 + EC-3).
 *
 * @internal
 */

/** Sentinel runtime export — workaround for rollup-plugin-dts deep type-only re-export bug. */
export const __filtersMarker: unique symbol = Symbol("email-filters");

const NOREPLY_RE =
  /^(noreply|no-reply|no_reply|donotreply|do-not-reply|mailer-daemon|postmaster|bounce|notifications)@/i;

/**
 * EC-3: extract pure email address from a string that may include display
 * name + brackets (`"Alice" <alice@example.com>`). Normalizes to lowercase.
 */
export function extractAddr(s: string): string {
  const m = s.match(/<([^>]+)>/);
  return (m?.[1] ?? s).toLowerCase().trim();
}

/**
 * D332: automated-sender filter. Returns `true` if the message should be
 * DROPPED (sender is automated / bot-loop risk).
 */
export function isAutomatedSender(fromAddress: string, headers: Map<string, string>): boolean {
  if (NOREPLY_RE.test(fromAddress)) return true;
  // Normalize header keys to lowercase for lookup.
  const lowered = new Map<string, string>();
  for (const [k, v] of headers) lowered.set(k.toLowerCase(), v);
  // RFC 3834: Auto-Submitted
  const autoSubmitted = lowered.get("auto-submitted");
  if (typeof autoSubmitted === "string" && /auto-generated|auto-replied/i.test(autoSubmitted)) {
    return true;
  }
  // Legacy Precedence header
  const precedence = lowered.get("precedence");
  if (typeof precedence === "string" && /bulk|list/i.test(precedence)) {
    return true;
  }
  // Microsoft X-Auto-Response-Suppress
  const xAuto = lowered.get("x-auto-response-suppress");
  if (typeof xAuto === "string" && /all/i.test(xAuto)) {
    return true;
  }
  return false;
}

/**
 * D333 + EC-3: allowed-sender allowlist.
 *
 * - `undefined` allowlist → OPEN (all allowed).
 * - Empty array → CLOSED (none allowed). Intentional distinction from undefined.
 * - Both sides normalized via `extractAddr` so `"Alice <alice@x>"` matches `alice@x`.
 */
export function isAllowedSender(fromAddress: string, allowedSenders?: readonly string[]): boolean {
  if (allowedSenders === undefined) return true;
  const norm = extractAddr(fromAddress);
  return allowedSenders.some((s) => extractAddr(s) === norm);
}
