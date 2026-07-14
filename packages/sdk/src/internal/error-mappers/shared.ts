/**
 * Helpers shared between provider HTTP error mappers (ADR D67).
 *
 * Extracted to dedupe identical logic in `anthropic.ts` and
 * `openai-compatible.ts` — retry-after parsing, raw-body truncation,
 * and metadata assembly are dialect-agnostic.
 *
 * @internal
 */

import type { ErrorCode, ErrorMetadata } from "../../errors.js";
import { redactSecrets } from "../security/index.js";

const RAW_MAX_BYTES = 2048;

/**
 * Parse the `Retry-After` header (RFC 7231) into seconds. Both forms are
 * supported: numeric-seconds (`Retry-After: 30`) and HTTP-date
 * (`Retry-After: Wed, 21 Oct 2025 07:28:00 GMT` → seconds until that instant,
 * clamped at 0 for a past date). Garbage / missing header → `undefined`.
 *
 * @internal
 */
export function parseRetryAfter(headers: Headers | undefined): number | undefined {
  if (headers === undefined) return undefined;
  const raw = headers.get("retry-after");
  if (raw === null) return undefined;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  // HTTP-date form — seconds until the given instant (0 if already elapsed).
  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
  return undefined;
}

/**
 * Truncate raw response body to ~2KB and redact known credential
 * patterns so it can ride inside `ErrorMetadata.raw` without
 * ballooning logs OR leaking tokens. Returns `undefined` for
 * null/undefined input.
 *
 * Post T1.1 (secret-redaction-discipline, ADR D68): every error metadata
 * goes through `redactSecrets` before exposure. Note the shape change —
 * pre-T1.1 the function preserved the original `body` shape when ≤2KB;
 * now it always returns a (possibly redacted) string, because redaction
 * coerces non-strings to JSON. Consumers who used to do `err.metadata.raw.foo`
 * must now `JSON.parse(err.metadata.raw)` first — but a workspace-wide
 * grep at T1.1 land time confirmed zero such callers.
 *
 * @internal
 */
export function truncateRaw(body: unknown): unknown {
  if (body === null || body === undefined) return undefined;
  const s = typeof body === "string" ? body : JSON.stringify(body);
  const truncated = s.length <= RAW_MAX_BYTES ? s : `${s.slice(0, RAW_MAX_BYTES)}…`;
  return redactSecrets(truncated);
}

/**
 * Build an `ErrorMetadata` object with all optional fields included
 * conditionally (no `undefined` keys in the output). Caller passes
 * dialect-specific fields (`provider`, `endpoint`, `code`); shared
 * fields (`statusCode`, `retryAfter`, `raw`) are derived here.
 *
 * @internal
 */
export function buildErrorMetadata(args: {
  provider: string;
  endpoint: string;
  code: ErrorCode;
  status: number;
  headers: Headers | undefined;
  body: unknown;
}): ErrorMetadata {
  const retryAfter = parseRetryAfter(args.headers);
  const raw = truncateRaw(args.body);
  return {
    provider: args.provider,
    endpoint: args.endpoint,
    code: args.code,
    statusCode: args.status,
    ...(retryAfter !== undefined ? { retryAfter } : {}),
    ...(raw !== undefined ? { raw } : {}),
  };
}

/**
 * D314: extract the provider's request id (`x-request-id` is OpenAI/most;
 * `request-id` is Anthropic). Returns `undefined` when neither is present.
 *
 * @internal
 */
export function parseRequestId(headers: Headers | undefined): string | undefined {
  if (headers === undefined) return undefined;
  return headers.get("x-request-id") ?? headers.get("request-id") ?? undefined;
}
