import { readEnv } from "./internal/env.js";
import { defaultRetriableForCode } from "./internal/runtime/retry/default-retriable.js";
import { redactSecrets } from "./internal/security/redact.js";
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
  | "quota_exceeded"
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
/**
 * T1.1 — closed literal union for `AgentRunError.code`. The previous
 * `(string & {})` escape hatch let arbitrary strings slip into the type
 * surface and defeated exhaustive `switch (code)` discrimination. This is
 * the canonical closed form. `AgentRunErrorCode` is re-aliased below for
 * source-level back-compat.
 *
 * Adding a new code: append the literal here AND audit every `switch (err.code)`
 * in callers. Type-checker enforces the audit via the `default: assertNever(code)`
 * convention.
 *
 * @public
 */
export type KnownAgentRunErrorCode =
  | ErrorCode
  | "quota_exceeded"
  | "tool_runtime_error"
  | "aborted"
  | "invalid_model"
  | "safety_blocked"
  | "provider_unreachable";

/**
 * Back-compat alias of {@link KnownAgentRunErrorCode}. Pre-T1.1 callers that
 * imported `AgentRunErrorCode` keep working; new code SHOULD prefer
 * `KnownAgentRunErrorCode` to make the closed-union intent explicit.
 *
 * @public
 */
export type AgentRunErrorCode = KnownAgentRunErrorCode;

/** Snapshot of every known code at runtime — used by the boundary coercer. */
const KNOWN_AGENT_RUN_ERROR_CODES = new Set<string>([
  "rate_limit",
  "auth_failed",
  "invalid_request",
  "timeout",
  "server_error",
  "context_too_long",
  "content_filtered",
  "model_unavailable",
  "network",
  "unknown",
  "quota_exceeded",
  "tool_runtime_error",
  "aborted",
  "invalid_model",
  "safety_blocked",
  "provider_unreachable",
]);

/**
 * T1.1 boundary helper — coerce an arbitrary string (typically arriving from
 * a downstream `RunErrorDetail.code` or a deserialized cloud response) into a
 * `KnownAgentRunErrorCode`. Unknown strings collapse to `"unknown"` so the
 * closed type contract holds without forcing every caller to switch.
 *
 * @internal
 */
export function coerceToKnownAgentRunErrorCode(code: string | undefined): KnownAgentRunErrorCode {
  if (code !== undefined && KNOWN_AGENT_RUN_ERROR_CODES.has(code)) {
    return code as KnownAgentRunErrorCode;
  }
  return "unknown";
}

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
   * D313 + T1.5: alias for `metadata.raw`. Provider response body for
   * debugging. T1.5 wraps the value in `redactSecrets` at the getter
   * boundary so secret-shaped substrings (`sk-...`, Bearer JWTs, etc.) are
   * stripped before reaching the caller. Available but NEVER serialized
   * into `.message` (anti-leak invariant).
   */
  get providerError(): unknown {
    const raw = this.metadata?.raw;
    if (raw === undefined) return undefined;
    if (typeof raw === "string") return redactSecrets(raw);
    // Non-string raw (object/buffer) — stringify then redact.
    try {
      return redactSecrets(JSON.stringify(raw));
    } catch {
      return redactSecrets(String(raw));
    }
  }

  /**
   * T1.5 — sanitized JSON form. `metadata.raw` is OMITTED by default; opt
   * in via `THEOKIT_DEBUG_RAW_ERRORS=1` to surface the (redacted) raw
   * payload for diagnostics. Every other field stays accessible.
   *
   * The single env-var gate is read each call so operators can toggle at
   * runtime without restarting the process.
   */
  toJSON(): Record<string, unknown> {
    const json: Record<string, unknown> = {
      name: this.name,
      message: this.message,
      isRetryable: this.isRetryable,
    };
    addOptionalFields(json, this);
    const safeMeta = sanitizeMetadata(this.metadata);
    if (safeMeta !== undefined) json.metadata = safeMeta;
    return json;
  }
}

function addOptionalFields(json: Record<string, unknown>, err: AgentRunError): void {
  if (err.code !== undefined) json.code = err.code;
  if (err.provider !== undefined) json.provider = err.provider;
  if (err.requestId !== undefined) json.requestId = err.requestId;
  if (err.conversationId !== undefined) json.conversationId = err.conversationId;
  if (err.raw !== undefined) json.raw = redactSecrets(err.raw);
}

function sanitizeMetadata(meta: ErrorMetadata | undefined): ErrorMetadata | undefined {
  if (meta === undefined) return undefined;
  const { raw, ...rest } = meta;
  const debugRaw = readEnv("THEOKIT_DEBUG_RAW_ERRORS") === "1";
  if (debugRaw && raw !== undefined) {
    const redactedRaw =
      typeof raw === "string" ? redactSecrets(raw) : redactSecrets(safeStringify(raw));
    return { ...rest, raw: redactedRaw } as ErrorMetadata;
  }
  return rest as ErrorMetadata;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Is this error transient (worth retrying)?
 *
 * Returns the SDK's own retryability verdict: every {@link TheokitAgentError}
 * subclass computes `isRetryable` at construction (rate-limit / network /
 * credential-pool-exhausted are retryable; auth / configuration / unsupported
 * are not), so this predicate is a single source of truth rather than a
 * re-derivation. Non-SDK errors return `false` conservatively — wrap a foreign
 * error in the appropriate SDK error first if you want it considered transient.
 * It never inspects `err.message`.
 *
 * @example
 *   try {
 *     await agent.send(message, { throwOnError: true });
 *   } catch (err) {
 *     if (isTransientError(err)) return retryWithBackoff();
 *     throw err;
 *   }
 *
 * @public
 */
export function isTransientError(err: unknown): boolean {
  return err instanceof TheokitAgentError && err.isRetryable === true;
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

/**
 * Thrown when a user-supplied task ID violates the grammar
 * `^[a-z0-9][a-z0-9_-]*$` (D368) OR starts with a reserved adapter
 * prefix (`wf-` / `b-` / `cron-`, EC-5).
 *
 * @public
 */
export class InvalidTaskIdError extends TheokitAgentError {
  override readonly name: string = "InvalidTaskIdError";
  readonly taskId: string;

  constructor(message: string, taskId: string, options: { cause?: unknown } = {}) {
    super(message, {
      ...options,
      isRetryable: false,
      code: "invalid_task_id",
    });
    this.taskId = taskId;
  }
}

/**
 * Thrown when `Task.subscribe(id)` is called for a task that has been
 * evicted, never submitted, or evicted after retention (D373).
 *
 * @public
 */
export class TaskNotFoundError extends TheokitAgentError {
  override readonly name: string = "TaskNotFoundError";
  readonly taskId: string;

  constructor(taskId: string, options: { cause?: unknown } = {}) {
    super(`Task not found: ${taskId}`, {
      ...options,
      isRetryable: false,
      code: "task_not_found",
    });
    this.taskId = taskId;
  }
}

/**
 * Thrown when `CloudAgent` is asked to wrap a task (D370). Cloud
 * task observability is deferred until Theo PaaS GA.
 *
 * @public
 */
export class UnsupportedTaskOperationError extends TheokitAgentError {
  override readonly name: string = "UnsupportedTaskOperationError";
  readonly operation: string;

  constructor(operation: string, options: { cause?: unknown } = {}) {
    super(
      `Task operation "${operation}" is not supported on CloudAgent (pre-release; see ADR D370)`,
      {
        ...options,
        isRetryable: false,
        code: "task_op_unsupported",
      },
    );
    this.operation = operation;
  }
}

/**
 * Thrown by `Budget` enforcement (ADR D386) when a `mode: "block"`
 * budget would be exceeded by the upcoming LLM call. The caller catches a
 * typed error to retry after the window resets, or surfaces it to the user.
 *
 * @public
 */
export class BudgetExceededError extends TheokitAgentError {
  override readonly name: string = "BudgetExceededError";
  readonly budgetName: string;
  readonly window: import("./types/budget.js").BudgetWindow;
  readonly spentUsd: number;
  readonly limitUsd: number;
  readonly mode: import("./types/budget.js").BudgetMode;

  constructor(args: {
    budgetName: string;
    window: import("./types/budget.js").BudgetWindow;
    spentUsd: number;
    limitUsd: number;
    mode: import("./types/budget.js").BudgetMode;
    cause?: unknown;
  }) {
    super(
      `Budget "${args.budgetName}" exceeded for window ${args.window}: spent $${args.spentUsd.toFixed(4)} > limit $${args.limitUsd.toFixed(4)}`,
      {
        ...(args.cause !== undefined ? { cause: args.cause } : {}),
        isRetryable: false,
        code: "budget_exceeded",
      },
    );
    this.budgetName = args.budgetName;
    this.window = args.window;
    this.spentUsd = args.spentUsd;
    this.limitUsd = args.limitUsd;
    this.mode = args.mode;
  }
}

/**
 * Thrown when `CloudAgent.send({ budget })` is invoked (D388). Cloud
 * budget surface waits for Theo PaaS GA.
 *
 * @public
 */
/**
 * T1.6 — Thrown when a consumer calls `agent.send()` or any method
 * on an agent that has already been `dispose()`d. Pre-T1.6 this was
 * a generic `new Error("Agent has been disposed")` — consumers
 * couldn't catch it without string-matching the message.
 *
 * @public
 */
export class AgentDisposedError extends TheokitAgentError {
  override readonly name: string = "AgentDisposedError";
  readonly agentId: string;

  constructor(agentId: string) {
    super(`Agent "${agentId}" has been disposed. Create a new agent or use Agent.resume().`, {
      isRetryable: false,
      code: "agent_disposed",
    });
    this.agentId = agentId;
  }
}

export class UnsupportedBudgetOperationError extends TheokitAgentError {
  override readonly name: string = "UnsupportedBudgetOperationError";
  readonly operation: string;

  constructor(operation: string, options: { cause?: unknown } = {}) {
    super(
      `Budget operation "${operation}" is not supported on CloudAgent (pre-release; see ADR D388)`,
      {
        ...options,
        isRetryable: false,
        code: "budget_op_unsupported",
      },
    );
    this.operation = operation;
  }
}
