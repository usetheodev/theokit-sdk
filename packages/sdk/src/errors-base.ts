/**
 * The root of the SDK error hierarchy, and the two types it is built from.
 *
 * A LEAF module on purpose: every other error in this package extends `TheokitAgentError`, and
 * `errors.ts` re-exports the ones that live in their own files. If the root lived in that catalogue,
 * each sibling would import it from a file that imports the sibling — a cycle madge reports and
 * `tests/architecture/no-cycles-at-all.test.ts` fails on. `types/messages-base.ts` exists for the
 * same reason, one layer over.
 *
 * Re-exported from `errors.ts`, so `@theokit/sdk/errors` is unchanged and consumers keep catching
 * `TheokitAgentError` from where the README tells them to.
 *
 * NOTE ON THE MODULE TAG: this header deliberately carries no internal-visibility tag, and does not
 * even name one — TypeScript attaches a file-leading docblock to the FIRST declaration below it, and
 * `stripInternal: true` (tsconfig.base) then deletes that declaration from the emitted `.d.ts`.
 * `tsc --noEmit` stays clean and the declaration rollup fails with `"X" is not exported by "..."`.
 * Measured twice on this file on 2026-09-01: once with the tag, and again when the comment
 * EXPLAINING the trap quoted the tag verbatim and re-armed it.
 */

/**
 * Finite, machine-readable error codes for provider-originated errors
 * (ADR D66). Consumers can `switch (err.metadata?.code)` exhaustively
 * — adding a new variant is an explicit decision + test coverage.
 *
 * @public
 */
export type ErrorCode =
  | "rate_limit"
  | "auth_failed"
  | "invalid_request"
  | "timeout"
  | "server_error"
  | "context_too_long"
  | "content_filtered"
  | "model_unavailable"
  | "network"
  | "quota_exceeded"
  | "unknown";
/**
 * Structured context for errors that originated from a provider HTTP
 * call (ADR D65). Lets callers retry with the right backoff (`retryAfter`),
 * surface actionable diagnostics (`provider`, `endpoint`), and inspect the
 * raw response body when needed (`raw`, capped at ~2KB by the mapper).
 *
 * @public
 */
export interface ErrorMetadata {
  /** Provider canonical name (e.g., `"anthropic"`, `"openai"`, `"openrouter"`, `"gemini"`). */
  provider: string;
  /** HTTP endpoint that failed (e.g., `"/v1/messages"`, `"/v1/chat/completions"`). */
  endpoint: string;
  /** Machine-readable error code (finite enum). */
  code: ErrorCode;
  /** HTTP status code if applicable. */
  statusCode?: number;
  /** Seconds to wait before retry, per provider's `retry-after` header (numeric form only). */
  retryAfter?: number;
  /** Raw response body for debugging (truncated to ~2KB by the mapper). */
  raw?: unknown;
}
/**
 * Base class for all errors thrown by `@theokit/sdk`.
 *
 * Use `isRetryable` to drive retry/backoff logic. `code` and `protoErrorCode`
 * are populated for server-originated errors when available. `metadata`
 * (ADR D65) carries structured `{ provider, endpoint, code, ... }` when
 * the error originated from a provider HTTP call.
 *
 * @public
 */
export class TheokitAgentError extends Error {
  override readonly name: string = "TheokitAgentError";
  readonly isRetryable: boolean;
  readonly code?: string;
  readonly protoErrorCode?: string;
  readonly metadata?: ErrorMetadata;

  constructor(
    message: string,
    options: {
      isRetryable?: boolean;
      code?: string;
      protoErrorCode?: string;
      cause?: unknown;
      metadata?: ErrorMetadata;
    } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.isRetryable = options.isRetryable ?? false;
    if (options.code !== undefined) this.code = options.code;
    if (options.protoErrorCode !== undefined) this.protoErrorCode = options.protoErrorCode;
    if (options.metadata !== undefined) this.metadata = options.metadata;
  }
}
