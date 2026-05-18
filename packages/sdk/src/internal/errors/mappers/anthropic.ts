/**
 * Anthropic HTTP error mapper (ADR D67).
 *
 * Translates an Anthropic API error response into a typed
 * `TheokitAgentError` subclass with full `ErrorMetadata`. Mapping rules:
 *
 *   401/403 → `AuthenticationError`  (`code: "auth_failed"`)
 *   429     → `RateLimitError`        (`code: "rate_limit"`)
 *   400     → `ConfigurationError`    (`code: "context_too_long"` if body
 *                                       mentions context length, else
 *                                       `"invalid_request"`; or
 *                                       `"content_filtered"` for policy.)
 *   408     → `NetworkError`          (`code: "timeout"`)
 *   5xx     → `NetworkError`          (`code: "server_error"` — covers 529
 *                                       overloaded_error common em horário
 *                                       de pico)
 *   other   → `UnknownAgentError`     (`code: "unknown"`)
 *
 * Never throws — caller is already in an error path.
 *
 * @internal
 */

import {
  AuthenticationError,
  ConfigurationError,
  type ErrorCode,
  type ErrorMetadata,
  NetworkError,
  RateLimitError,
  type TheokitAgentError,
  UnknownAgentError,
} from "../../../errors.js";

interface MapAnthropicErrorArgs {
  status: number;
  body: unknown;
  headers: Headers | undefined;
  endpoint: string;
}

const RAW_MAX_BYTES = 2048;

export function mapAnthropicError(args: MapAnthropicErrorArgs): TheokitAgentError {
  const { status, body, headers, endpoint } = args;
  const code = mapAnthropicStatusToCode(status, body);
  const retryAfter = parseRetryAfter(headers);
  const message = formatMessage(status, code);
  const raw = truncateRaw(body);

  const metadata: ErrorMetadata = {
    provider: "anthropic",
    endpoint,
    code,
    statusCode: status,
    ...(retryAfter !== undefined ? { retryAfter } : {}),
    ...(raw !== undefined ? { raw } : {}),
  };

  if (status === 401 || status === 403) {
    return new AuthenticationError(message, { code: "anthropic_auth_failed", metadata });
  }
  if (status === 429) {
    return new RateLimitError(message, { code: "anthropic_rate_limit", metadata });
  }
  if (status === 400) {
    return new ConfigurationError(message, {
      code: `anthropic_${code}`,
      metadata,
    });
  }
  if (status === 408) {
    return new NetworkError(message, { code: "anthropic_timeout", metadata });
  }
  if (status >= 500 && status < 600) {
    return new NetworkError(message, { code: "anthropic_server_error", metadata });
  }
  return new UnknownAgentError(message, { code: "anthropic_unknown", metadata });
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: explicit branch table is clearer than splitting
function mapAnthropicStatusToCode(status: number, body: unknown): ErrorCode {
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 429) return "rate_limit";
  if (status === 408) return "timeout";
  if (status === 400) {
    const text = JSON.stringify(body ?? "").toLowerCase();
    if (
      text.includes("context") &&
      (text.includes("too long") || text.includes("too_long") || text.includes("length"))
    ) {
      return "context_too_long";
    }
    if (
      text.includes("filtered") ||
      text.includes("content policy") ||
      text.includes("content_policy")
    ) {
      return "content_filtered";
    }
    return "invalid_request";
  }
  if (status >= 500 && status < 600) return "server_error";
  return "unknown";
}

function parseRetryAfter(headers: Headers | undefined): number | undefined {
  if (headers === undefined) return undefined;
  const raw = headers.get("retry-after");
  if (raw === null) return undefined;
  // Spec allows numeric seconds OR HTTP-date. We support seconds form only.
  // `Number("Wed, 21 Oct 2026 07:28:00 GMT")` is NaN → undefined.
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  return undefined;
}

function truncateRaw(body: unknown): unknown {
  if (body === null || body === undefined) return undefined;
  const s = typeof body === "string" ? body : JSON.stringify(body);
  if (s.length <= RAW_MAX_BYTES) return body;
  // For string bodies, truncate with ellipsis. For objects, also stringify
  // truncated so consumer sees a hint without ballooning logs.
  return typeof body === "string"
    ? `${s.slice(0, RAW_MAX_BYTES)}…`
    : `${s.slice(0, RAW_MAX_BYTES)}…`;
}

function formatMessage(status: number, code: ErrorCode): string {
  return `Anthropic API error: ${code} (HTTP ${status})`;
}
