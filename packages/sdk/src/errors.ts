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
 * Codes used by {@link AgentRunError} (Production-Readiness #3, ADR D311).
 *
 * Superset of {@link ErrorCode} extended with codes that do NOT originate
 * from a provider HTTP response:
 *
 * - `quota_exceeded` — billing limit hit (provider 402 or signalled error)
 * - `tool_runtime_error` — custom tool handler threw inside dispatch
 * - `aborted` — caller's `AbortSignal` fired (Phase 4)
 * - `invalid_model` — model id rejected by provider (400 "model not found")
 * - `safety_blocked` — provider safety filter blocked req or resp
 * - `provider_unreachable` — DNS/TCP/timeout/5xx at transport boundary
 *
 * The `& {}` tail keeps the literal-union ergonomics (autocomplete) while
 * accepting any string for forward compatibility with constructor calls
 * that pass arbitrary code values (legacy callers).
 *
 * @public
 */
export type AgentRunErrorCode =
  | ErrorCode
  | "quota_exceeded"
  | "tool_runtime_error"
  | "aborted"
  | "invalid_model"
  | "safety_blocked"
  | "provider_unreachable"
  | (string & {});

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
 * Thrown by `Agent.prompt` (and helpers that go through `run.wait()`) when
 * the option `{ throwOnError: true }` is set and the run terminates with
 * `status: 'error'`. Carries the structured `RunResult.error` fields so
 * callers can `catch` once and branch on `code` / `provider` instead of
 * unwrapping the run.
 *
 * Extends {@link TheokitAgentError} per ADR D65 — no new hierarchy.
 *
 * @example
 *   try {
 *     await Agent.prompt(msg, { apiKey, model, throwOnError: true });
 *   } catch (err) {
 *     if (err instanceof AgentRunError && err.code === 'auth_failed') {
 *       // bad key
 *     }
 *   }
 *
 * @public
 */
export class AgentRunError extends TheokitAgentError {
  override readonly name: string = "AgentRunError";
  readonly provider?: string;
  readonly raw?: string;
  /** Provider's request id (`x-request-id` / `request-id` header). Useful for support tickets. */
  readonly requestId?: string;
  /** SDK conversation id this error was raised inside. */
  readonly conversationId?: string;

  constructor(
    message: string,
    options: {
      code: AgentRunErrorCode;
      provider?: string;
      raw?: string;
      requestId?: string;
      conversationId?: string;
      retriable?: boolean;
      cause?: unknown;
      metadata?: ErrorMetadata;
    },
  ) {
    super(message, {
      code: options.code,
      cause: options.cause,
      metadata: options.metadata,
      // D311: most AgentRunErrors are not retriable (auth, validation, abort).
      // Provider mappers (D314) override per-status — explicit `retriable` wins
      // over the implicit default when supplied.
      isRetryable: options.retriable ?? defaultRetriableForCode(options.code),
    });
    if (options.provider !== undefined) this.provider = options.provider;
    if (options.raw !== undefined) this.raw = options.raw;
    if (options.requestId !== undefined) this.requestId = options.requestId;
    if (options.conversationId !== undefined) this.conversationId = options.conversationId;
  }

  /**
   * Production-Readiness #3 (ADR D311): alias for `isRetryable` exposed as
   * `retriable` to match the handoff contract. Future v2 will deprecate
   * `isRetryable` in favor of this.
   */
  get retriable(): boolean {
    return this.isRetryable;
  }

  /**
   * D312: provider's `Retry-After` header in **milliseconds**. Mappers store
   * the header value (seconds) in `metadata.retryAfter`; this getter
   * multiplies by 1000 so the result composes with `Date.now()`/`setTimeout`.
   *
   * Returns `undefined` when no hint was provided. `0` is a legitimate value
   * — use `=== undefined` check rather than truthy check.
   */
  get retryAfterMs(): number | undefined {
    if (this.metadata?.retryAfter === undefined) return undefined;
    return this.metadata.retryAfter * 1000;
  }

  /**
   * D313: alias for `metadata.raw`. Provider response body for debugging.
   * Available but NEVER serialized into `.message` (anti-leak invariant).
   */
  get providerError(): unknown {
    return this.metadata?.raw;
  }
}

/**
 * D311 helper: choose a sensible default `isRetryable` value when the
 * caller did not supply `retriable` explicitly. Conservative defaults —
 * provider mappers override per-status when they know better.
 *
 * @internal
 */
function defaultRetriableForCode(code: AgentRunErrorCode): boolean {
  switch (code) {
    case "rate_limit":
    case "timeout":
    case "server_error":
    case "network":
    case "provider_unreachable":
      return true;
    default:
      return false;
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

/**
 * Thrown when every credential in a per-provider pool is in cooldown
 * and no healthy key is available (ADR D133). The caller's
 * {@link import("./internal/llm/fallback-client.js").FallbackLlmClient}
 * catches this and tries the next provider in the fallback chain.
 *
 * `metadata.nextRetryAt` (epoch ms) tells callers when the soonest
 * pool entry resumes — useful for manual retry scheduling.
 *
 * @public
 */
export class CredentialPoolExhaustedError extends TheokitAgentError {
  override readonly name: string = "CredentialPoolExhaustedError";
  readonly provider: string;
  readonly nextRetryAt: number | undefined;

  constructor(
    message: string,
    options: {
      provider: string;
      nextRetryAt?: number;
      code?: string;
      cause?: unknown;
      metadata?: ErrorMetadata;
    },
  ) {
    super(message, {
      ...options,
      isRetryable: true,
      code: options.code ?? "credential_pool_exhausted",
    });
    this.provider = options.provider;
    this.nextRetryAt = options.nextRetryAt;
  }
}

/**
 * Finite error codes specific to memory adapter operations (ADR D141).
 *
 * @public
 */
export type MemoryAdapterErrorCode =
  | "auth_failed"
  | "rate_limited"
  | "not_found"
  | "network"
  | "invalid_input"
  | "unknown";

/**
 * Error raised by `@theokit-memory-*` adapters. Carries `adapterId`
 * so callers can branch on which provider failed (ADR D141).
 *
 * @public
 */
export class MemoryAdapterError extends TheokitAgentError {
  override readonly name: string = "MemoryAdapterError";
  readonly adapterId: string;

  constructor(
    message: string,
    options: {
      adapterId: string;
      code: MemoryAdapterErrorCode;
      cause?: unknown;
      metadata?: ErrorMetadata;
    },
  ) {
    super(message, {
      isRetryable: options.code === "rate_limited" || options.code === "network",
      code: options.code,
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
      ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
    });
    this.adapterId = options.adapterId;
  }
}
