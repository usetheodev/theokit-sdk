/**
 * Per-error → canonical `SendResult.error` mapping for Teams send failures.
 *
 * EC-7 absorbed: tolerates plain `Error` without `.status` (network errors,
 * programmer errors) — never throws, always returns a structured payload.
 *
 * @internal
 */

/** Sentinel runtime export — workaround for rollup-plugin-dts deep type-only re-export bug. */
export const __errorsMarker: unique symbol = Symbol("errors");

interface ErrorPayload {
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

export function mapTeamsError(err: unknown): ErrorPayload {
  if (err === null || err === undefined) {
    return { code: "unknown", message: "Unknown error" };
  }
  if (typeof err === "string") {
    return { code: "unknown", message: err };
  }
  const e = err as { status?: number; statusCode?: number; message?: string };
  const status = e.status ?? e.statusCode;
  const message = typeof e.message === "string" && e.message.length > 0 ? e.message : String(err);

  if (typeof status === "number") {
    if (status === 401 || status === 403) return { code: "auth_failed", message };
    if (status === 429) return { code: "rate_limit", message };
    if (status === 408) return { code: "timeout", message };
    if (status === 400 || status === 404) return { code: "invalid_request", message };
    if (status >= 500) return { code: "server_error", message };
  }
  // EC-7: plain Errors (Node fetch ECONNREFUSED etc) have no .status.
  if (NETWORK_ERR_RE.test(message)) return { code: "server_error", message };
  return { code: "unknown", message };
}
