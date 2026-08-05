/**
 * M93 — retry for the **single-key** path, which had none.
 *
 * ## The defect
 *
 * `buildPoolOrSingle` returns a `PoolAwareLlmClient` — with circuit breaker, full-jitter backoff,
 * `Retry-After` handling and rotation — when there are **>= 2** keys. With **one**, it returns the
 * raw transport. A consumer resolving exactly one credential (the common case) never gets a retry:
 * a 429 after eight tool calls kills the turn.
 *
 * The asymmetry has no domain justification. **A pool of 1 key is a pool of size 1** — what changes
 * between 1 and 2 keys is whether there is somewhere to rotate to, not whether resilience exists.
 *
 * ## Why a decorator, and why it is cheap
 *
 * `computeBackoffMs`, `sleepWithAbort` and `CircuitBreaker` **are already independent modules** —
 * `PoolAwareLlmClient` imports them, it does not contain them. So this is composition, not a
 * rewrite (parsimony rung 4: reuse what is already installed). What was missing was not the logic;
 * it was the logic being reachable outside the pool path.
 *
 * A decorator rather than a branch inside the pool: an `LlmClient` wrapping another applies to
 * **both** arms without duplicating anything, and the pool gains no degenerate one-element mode.
 *
 * ## Only transient errors are retried
 *
 * `error-handling.md` § 2 is explicit: "external-API timeout -> retry with backoff; business-rule
 * violation -> fail immediately". A 401 retried three times delays the error by seconds without
 * changing the outcome — and hides the real cause from the user for longer.
 *
 * @internal
 */
import {
  CredentialPoolExhaustedError,
  isTransientError,
  RateLimitError,
  TheokitAgentError,
} from "../../errors.js";
import { abortError } from "./abort-error.js";
import { computeBackoffMs, sleepWithAbort } from "./retry.js";
import type { LlmClient, LlmEvent, LlmFinish, LlmRequest } from "./types.js";

/** Attempt ceiling. Fixed at 3 — M93's DoD names the number. */
export const MAX_ATTEMPTS = 3;

/**
 * Is the error transient — that is, can retrying change the outcome?
 *
 * ## Delegates to `isTransientError`, and states what it subtracts
 *
 * The SDK **already** publishes `isTransientError` — documented as "a single source of truth rather
 * than a re-derivation", with the explicit warning that "It never inspects `err.message`". The first
 * version of this function ignored both: it re-derived, by regex over the message (`/\b4\d\d\b/`).
 * Adversarial review measured the cost — `connect ECONNREFUSED 127.0.0.1:443` was classified as NOT
 * transient, because the **port** matches the regex. The network errors retry exists for were
 * exactly the ones excluded.
 *
 * Reinventing here violated parsimony rung 4 with the part already at hand. What remains of this
 * function are **three subtractions** from the owner's verdict, each with a reason:
 *
 * | Subtraction | Why |
 * |---|---|
 * | `CredentialPoolExhaustedError` | the pool already spent its own attempt and rotation budget; `nextRetryAt` is tens of seconds out. Retrying would multiply the wait by `MAX_ATTEMPTS` with no chance of success. |
 * | `code === "circuit_open"` | the breaker exists **in order to** fail fast; wrapping it in a retry undoes from outside the decision it just made. |
 * | `RateLimitError` with 402 | a billing quota does not resolve in milliseconds — which is why the pool's `classifyAndDecide` rotates instead of waiting. |
 *
 * The first two came out of the review's measurements: with them treated as transient, the entire
 * pool was retried 3x, and a 30 s wait became ~90 s.
 */
export function isRetriableError(err: unknown): boolean {
  if (!isTransientError(err)) return false;
  if (err instanceof CredentialPoolExhaustedError) return false;
  if (err instanceof TheokitAgentError && err.code === "circuit_open") return false;
  if (err instanceof RateLimitError && err.metadata?.statusCode === 402) return false;
  return true;
}

/** The `Retry-After` normalized by the error mapper, in ms from now. */
function retryAfterHintMs(err: unknown): number | undefined {
  if (!(err instanceof RateLimitError)) return undefined;
  const seconds = err.metadata?.retryAfter;
  return typeof seconds === "number" && seconds > 0 ? seconds * 1000 : undefined;
}

/**
 * Forwards the inner stream, flagging `state` as soon as the first event leaves.
 *
 * The flag has to live OUTSIDE the generator because the `catch` that decides about retrying is in
 * the caller — and it is that distinction (emitted or not) that separates "a retriable failure"
 * from "a turn already partially delivered to the consumer".
 */
async function* consume(
  gen: AsyncGenerator<LlmEvent, LlmFinish, void>,
  state: { emitted: boolean },
): AsyncGenerator<LlmEvent, LlmFinish, void> {
  let step = await gen.next();
  while (step.done !== true) {
    state.emitted = true;
    yield step.value;
    step = await gen.next();
  }
  return step.value;
}

/** Worth retrying? Not if it already emitted, not on the last attempt, not if the error is final. */
function canRetry(err: unknown, emitted: boolean, attempt: number): boolean {
  if (emitted) return false;
  if (attempt === MAX_ATTEMPTS - 1) return false;
  return isRetriableError(err);
}

/**
 * ## Why there is NO circuit breaker here
 *
 * The package's `CircuitBreaker` is **keyed by credential** (`recordSuccess(key)` /
 * `recordTimeout(key)`): it exists so the pool can mark a key unhealthy and **skip** to another.
 * With a single key there is nowhere to skip to, so a breaker here would record state nobody reads.
 *
 * Parsimony rung 1 — "does this need to exist?". No: it would be ceremony with resilience's name on
 * it. What protects the single-key path is the attempt ceiling and the backoff, and both are below.
 */
export class RetryingLlmClient implements LlmClient {
  readonly #inner: LlmClient;
  readonly #rng: (() => number) | undefined;

  constructor(inner: LlmClient, opts?: { rng?: () => number }) {
    this.#inner = inner;
    this.#rng = opts?.rng;
  }

  /**
   * The decorated client. Public by the same convention as `FaultInjectingLlmClient.inner`: the
   * router's wiring tests assert `instanceof PoolAwareLlmClient` and need to see through the
   * decorators. Without this, adding a decorator breaks tests whose intent is still valid — which is
   * exactly what M93 did to 4 pre-existing tests.
   */
  get inner(): LlmClient {
    return this.#inner;
  }

  get name(): string {
    return this.#inner.name;
  }

  /**
   * Waits out attempt `n`'s backoff, honoring the provider's `Retry-After` when one arrived.
   *
   * Its own method because `stream` is a generator with a nested loop, and inlining the conditional
   * option assembly here pushed cognitive complexity to 19 (project ceiling: 10). The body of
   * `stream` stays nothing but the attempt machine.
   */
  async #waitBackoff(err: unknown, attempt: number, signal: AbortSignal): Promise<void> {
    const hint = retryAfterHintMs(err);
    const ms = computeBackoffMs({
      attempt,
      ...(hint !== undefined ? { retryAfterMs: hint } : {}),
      ...(this.#rng !== undefined ? { rng: this.#rng } : {}),
    });
    await sleepWithAbort(ms, signal);
  }

  async *stream(
    request: LlmRequest,
    signal: AbortSignal,
  ): AsyncGenerator<LlmEvent, LlmFinish, void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (signal.aborted) throw lastError ?? abortError(signal);
      // A failure AFTER the first event is NOT retriable: the consumer has already seen tokens, and
      // repeating would produce duplicated text — and, in the scenario that motivates M93 (a 429
      // after eight tool calls), duplicated `tool_use` blocks.
      //
      // Until M93's adversarial review this invariant lived only in the comment: the `yield` and the
      // following `gen.next()` both sat inside the `try`, so a failure mid-stream retried the whole
      // turn. Measured: the consumer received `[tok1, tok2]` across 2 attempts. The comment asserted
      // a guarantee the code did not provide — the rot class `adr-governance.md` § 5 residue 2
      // enumerates.
      const state = { emitted: false };
      try {
        return yield* consume(this.#inner.stream(request, signal), state);
      } catch (err) {
        lastError = err;
        if (!canRetry(err, state.emitted, attempt)) throw err;
        await this.#waitBackoff(err, attempt, signal);
      }
    }
    throw lastError ?? new Error("retries exhausted with no recorded error");
  }
}
