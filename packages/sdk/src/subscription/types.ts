/**
 * @theokit/sdk — Subscription type contract (G8 v1.7.0).
 *
 * Per ADRs D423 (resume token opaque), D424 (transport selection),
 * D426 (defineSubscription DSL shape).
 *
 * @public
 */

import { TheokitAgentError } from "../errors.js";

/**
 * Transport selection for subscriptions.
 *
 * - `'ws'`: WebSocket (bidirectional). Required for inbound client→server frames.
 *   v1.7 ships Node-canonical `ws` adapter; CF/Bun/Deno deferred to v1.8.x per ADR D425.
 * - `'sse'`: W3C Server-Sent Events (server→client only). Browser-native EventSource.
 * - `'auto'`: Prefer WS, fall back SSE on upgrade failure. Default.
 *
 * @public
 */
export type SubscriptionTransport = "ws" | "sse" | "auto";

/**
 * Context passed to a subscription `handler` on each invocation.
 *
 * @public
 */
export interface SubscriptionCtx {
  /**
   * Opaque resume token forwarded by the client when reconnecting.
   * Handler defines its own semantics (monotonic int, ULID, timestamp,
   * encrypted cursor). SDK passes through unchanged. Per ADR D423.
   */
  readonly lastEventId?: string;

  /**
   * AbortSignal that fires when the subscription is cancelled
   * (client disconnect, consumer abort, server shutdown).
   * Handler MUST honor `signal.aborted` in long-running loops.
   */
  readonly signal: AbortSignal;

  /**
   * Stable identifier for the underlying transport connection.
   * Different from the subscription name — one connection may host
   * many subscriptions. Useful for logging / per-connection state.
   */
  readonly connectionId: string;

  /**
   * Force-close the underlying transport with optional WS close code + reason.
   * Used by consumer code (e.g., auth middleware revoking a session) to
   * terminate a subscription that should not continue.
   */
  disconnect(code?: number, reason?: string): void;

  /**
   * Helper to mint a tracked envelope `[id, payload]`.
   * Yielding tracked envelopes lets the client advance `lastEventId`
   * so reconnects can resume from that point.
   */
  tracked<TPayload>(id: string, payload: TPayload): TrackedEnvelope<TPayload>;
}

/**
 * Tracked envelope: `[id, payload]` tuple yielded by subscription handlers
 * to advertise the resume token associated with the payload.
 *
 * The encoder writes the `id` as an SSE `id:` field or WS payload metadata
 * so the client can echo it back on reconnect (`input.lastEventId`).
 *
 * Per ADR D423.
 *
 * @public
 */
export type TrackedEnvelope<T> = readonly [id: string, payload: T];

/**
 * Type guard for {@link TrackedEnvelope}.
 *
 * @public
 */
export function isTrackedEnvelope(value: unknown): value is TrackedEnvelope<unknown> {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string";
}

/**
 * Mint a tracked envelope. Equivalent to `[id, payload] as const`,
 * exported as a function so consumers don't repeat the tuple cast.
 *
 * @public
 */
export function tracked<T>(id: string, payload: T): TrackedEnvelope<T> {
  if (typeof id !== "string" || id.length === 0) {
    throw new TypeError("tracked(): id must be a non-empty string");
  }
  return [id, payload] as const;
}

/**
 * Base error for the subscription subsystem. Extends {@link TheokitAgentError}
 * so existing `instanceof TheokitAgentError` branches keep working.
 *
 * @public
 */
export class SubscriptionError extends TheokitAgentError {
  override readonly name: string = "SubscriptionError";

  constructor(message: string, options: { code?: string; cause?: unknown } = {}) {
    super(message, { ...options, isRetryable: false });
  }
}

/**
 * Thrown when subscription input fails Zod schema validation.
 *
 * @public
 */
export class SubscriptionInputError extends SubscriptionError {
  override readonly name: string = "SubscriptionInputError";

  readonly issues: unknown;

  constructor(message: string, options: { issues: unknown; cause?: unknown }) {
    super(message, { code: "subscription_input_invalid", cause: options.cause });
    this.issues = options.issues;
  }
}

/**
 * Thrown when a subscription transport disconnects unexpectedly
 * AND the client did not opt out of reconnect.
 *
 * @public
 */
export class SubscriptionDisconnectError extends SubscriptionError {
  override readonly name: string = "SubscriptionDisconnectError";

  readonly closeCode?: number;
  readonly closeReason?: string;

  constructor(
    message: string,
    options: { closeCode?: number; closeReason?: string; cause?: unknown } = {},
  ) {
    super(message, { code: "subscription_disconnected", cause: options.cause });
    if (options.closeCode !== undefined) this.closeCode = options.closeCode;
    if (options.closeReason !== undefined) this.closeReason = options.closeReason;
  }
}

/**
 * Descriptor returned by {@link Subscription.create}. Carries the typed
 * input/output Zod schemas + handler factory.
 *
 * @public
 */
export interface SubscriptionDescriptor<TInput = unknown, TOutput = unknown> {
  /** Optional explicit name; the runtime may also derive name from file path. */
  readonly name?: string;
  /** Zod schema for the subscription input. Validated at dispatch boundary. */
  readonly input: ZodLike<TInput>;
  /** Zod schema for each output frame (informational; not enforced per-frame). */
  readonly output: ZodLike<TOutput>;
  /** Async handler that yields output frames (or tracked envelopes). */
  readonly handler: (
    input: TInput,
    ctx: SubscriptionCtx,
  ) => AsyncGenerator<TOutput | TrackedEnvelope<TOutput>, void, void>;
}

/**
 * Minimal structural Zod type used to avoid hard peer-dep import.
 * Mirrors the surface used by other SDK modules (e.g., `define-tool.ts`).
 *
 * Emitted rather than erased: it appears in the signature of `defineSubscription`, which
 * `@theokit/sdk/subscription` publishes, so a consumer's type-aware lint has to be able to
 * resolve it.
 */
export interface ZodLike<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
  parse(value: unknown): T;
}
