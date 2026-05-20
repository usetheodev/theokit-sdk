import type { RunOperation } from "./types/run.js";

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
 * Base class for all errors thrown by `@usetheo/sdk`.
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

/**
 * Invalid API key, not logged in, insufficient permissions.
 *
 * @public
 */
export class AuthenticationError extends TheokitAgentError {
  override readonly name: string = "AuthenticationError";

  constructor(
    message: string,
    options: { code?: string; cause?: unknown; metadata?: ErrorMetadata } = {},
  ) {
    super(message, { ...options, isRetryable: false });
  }
}

/**
 * Too many requests or usage limits exceeded.
 *
 * @public
 */
export class RateLimitError extends TheokitAgentError {
  override readonly name: string = "RateLimitError";

  constructor(
    message: string,
    options: { code?: string; cause?: unknown; metadata?: ErrorMetadata } = {},
  ) {
    super(message, { ...options, isRetryable: true });
  }
}

/**
 * Invalid model, bad request parameters, malformed options.
 *
 * @public
 */
export class ConfigurationError extends TheokitAgentError {
  override readonly name: string = "ConfigurationError";

  constructor(
    message: string,
    options: { code?: string; cause?: unknown; metadata?: ErrorMetadata } = {},
  ) {
    super(message, { ...options, isRetryable: false });
  }
}

/**
 * Thrown when creating a cloud agent for a repo whose SCM provider is not
 * connected. Use `helpUrl` to point the user at the right reconnect flow.
 *
 * @public
 */
export class IntegrationNotConnectedError extends ConfigurationError {
  override readonly name: string = "IntegrationNotConnectedError";
  readonly provider: string;
  readonly helpUrl: string;

  constructor(
    message: string,
    options: {
      provider: string;
      helpUrl: string;
      code?: string;
      cause?: unknown;
      metadata?: ErrorMetadata;
    },
  ) {
    super(message, options);
    this.provider = options.provider;
    this.helpUrl = options.helpUrl;
  }
}

/**
 * Service unavailable, timeout, transport-level failure.
 *
 * @public
 */
export class NetworkError extends TheokitAgentError {
  override readonly name: string = "NetworkError";

  constructor(
    message: string,
    options: { code?: string; cause?: unknown; metadata?: ErrorMetadata } = {},
  ) {
    super(message, { ...options, isRetryable: true });
  }
}

/**
 * Catch-all for unclassified server or runtime errors.
 *
 * @public
 */
export class UnknownAgentError extends TheokitAgentError {
  override readonly name: string = "UnknownAgentError";

  constructor(
    message: string,
    options: { code?: string; cause?: unknown; metadata?: ErrorMetadata } = {},
  ) {
    super(message, { ...options, isRetryable: false });
  }
}

/**
 * Thrown when a {@link Run} or agent operation is not available on the current
 * runtime. Check first with `run.supports(operation)`.
 *
 * Extends {@link TheokitAgentError} (so error-catching code that branches on
 * `instanceof TheokitAgentError` continues to work) but is never retryable —
 * an unsupported operation will not become supported on retry.
 *
 * @public
 */
export class UnsupportedRunOperationError extends TheokitAgentError {
  override readonly name: string = "UnsupportedRunOperationError";
  readonly operation: RunOperation;

  constructor(
    message: string,
    operation: RunOperation,
    options: { code?: string; cause?: unknown } = {},
  ) {
    super(message, {
      ...options,
      isRetryable: false,
      code: options.code ?? "unsupported_run_operation",
    });
    this.operation = operation;
  }
}
