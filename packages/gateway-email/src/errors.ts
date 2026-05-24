/**
 * Per-error → canonical `SendResult.error` mapping for email IMAP/SMTP failures.
 *
 * Tolerates plain `Error` without `.code`/`.responseCode` (EC-7 pattern from Teams).
 *
 * @internal
 */

/** Sentinel runtime export — workaround for rollup-plugin-dts deep type-only re-export bug. */
export const __errorsMarker: unique symbol = Symbol("email-errors");

export interface ErrorPayload {
  code:
    | "auth_failed"
    | "rate_limit"
    | "invalid_request"
    | "server_error"
    | "not_connected"
    | "empty_text"
    | "timeout"
    | "unknown";
  message: string;
}

const NETWORK_ERR_RE = /ECONN|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|EAI_AGAIN|fetch failed/i;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: error-translation ladder is exhaustive — each branch maps one nodemailer/imapflow/SMTP-response class to one typed canonical code; splitting hurts traceability.
export function mapEmailError(err: unknown): ErrorPayload {
  if (err === null || err === undefined) {
    return { code: "unknown", message: "Unknown error" };
  }
  if (typeof err === "string") {
    return { code: "unknown", message: err };
  }
  const e = err as {
    code?: string;
    responseCode?: number;
    response?: string;
    message?: string;
    name?: string;
  };
  const code = e.code ?? "";
  const respCode = typeof e.responseCode === "number" ? e.responseCode : undefined;
  const message = typeof e.message === "string" && e.message.length > 0 ? e.message : String(err);

  // nodemailer error codes
  if (code === "EAUTH" || code === "EAUTHENTICATION") {
    return { code: "auth_failed", message };
  }
  if (code === "EENVELOPE" && /550/.test(message)) {
    return { code: "invalid_request", message };
  }
  if (code === "ECONNECTION" || code === "ESOCKET" || code === "ETLS") {
    return { code: "server_error", message };
  }
  if (code === "ETIMEDOUT") {
    return { code: "timeout", message };
  }
  // SMTP response codes
  if (respCode !== undefined) {
    if (respCode === 535 || respCode === 530) return { code: "auth_failed", message };
    if (respCode === 421 || respCode === 451 || respCode === 452)
      return { code: "rate_limit", message };
    if (respCode === 550 || respCode === 551 || respCode === 553)
      return { code: "invalid_request", message };
    if (respCode >= 500) return { code: "server_error", message };
    if (respCode >= 400) return { code: "rate_limit", message };
  }
  // imapflow throws Error with .authenticationFailed flag in some versions
  if (e.name === "IMAP_AUTH_FAILED" || /auth/i.test(message)) {
    return { code: "auth_failed", message };
  }
  // EC-7: plain Error fallback
  if (NETWORK_ERR_RE.test(message)) return { code: "server_error", message };
  return { code: "unknown", message };
}
