/**
 * `LlmClient` wrapper that pools multiple API keys for the same
 * provider and rotates on HTTP 429/402/401 (ADRs D123-D133).
 *
 * Composition wrapper (D127) — wraps a builder that produces a real
 * `LlmClient` for a given API key. The wrapper picks a key via the
 * pool, instantiates the real client, attempts the stream, and on a
 * pre-stream error decides retry-vs-rotate per the decision matrix.
 *
 * Once `yield*` starts (first event received), rotation is impossible —
 * partial output would corrupt the stream. Same contract as
 * `FallbackLlmClient` (D2).
 *
 * @internal
 */

import {
  AuthenticationError,
  CredentialPoolExhaustedError,
  NetworkError,
  RateLimitError,
} from "../../errors.js";
import { diag } from "../diagnostics.js";
import { CircuitBreaker } from "../retry/circuit-breaker.js";
import { abortError } from "./abort-error.js";
import type { CredentialPool } from "./credential-pool.js";
import { computeBackoffMs, sleepWithAbort } from "./retry.js";
import { relayStream, tryFirstEvent } from "./stream-relay.js";
import type { LlmClient, LlmEvent, LlmFinish, LlmRequest } from "./types.js";

/**
 * M2 #60 — optional resilience knobs. `breaker` guards the provider with a
 * consecutive-failure circuit breaker; `backoffBaseMs`/`rng` tune the
 * full-jitter sleep inserted before a same-key 429 retry (tests inject a
 * deterministic `rng` + a small base). All optional — omit for defaults.
 *
 * @internal
 */
export interface PoolResilienceOptions {
  breaker?: CircuitBreaker;
  backoffBaseMs?: number;
  rng?: () => number;
  /**
   * SE2 — invoked right before a 429 same-key retry backs off, so the runtime can
   * surface a `rate_limit` RunEvent. `attempt` is 1-based; `retryAfterMs` is the
   * backoff about to be waited. Best-effort observer — must not throw.
   */
  onRateLimit?: (info: { attempt: number; retryAfterMs?: number }) => void;
}

/** Decision returned by `classifyAndDecide`. */
type Decision = "retry" | "rotate" | "propagate";

/**
 * Pool-aware `LlmClient`. Constructs real clients on demand via
 * `buildClient(apiKey)` — kept lazy so the pool can pick AT request
 * time (not at construction) and rotation produces a fresh client
 * each iteration.
 *
 * @internal
 */
export class PoolAwareLlmClient implements LlmClient {
  readonly name: string;

  constructor(
    private readonly pool: CredentialPool,
    private readonly buildClient: (apiKey: string) => LlmClient,
    /**
     * T3.9 — Optional override for the upper bound on how long
     * `stream()` waits for a cooldown to expire before throwing
     * `CredentialPoolExhaustedError`. Defaults to 30 s. The actual
     * wait inside `pool.waitForAvailable` is jittered (AWS Brooker
     * 2015 full-jitter), so concurrent callers stagger their
     * re-probe of the pool — preventing reconnect storms.
     *
     * Set to `0` to opt out (legacy pre-T3.9 behavior — throw on
     * first `select()`-returns-null).
     *
     * @internal
     */
    private readonly waitForAvailableMs: number = 30_000,
    resilience: PoolResilienceOptions = {},
  ) {
    this.name = `pool-aware:${pool.provider}`;
    this.breaker = resilience.breaker ?? new CircuitBreaker();
    this.backoffBaseMs = resilience.backoffBaseMs;
    this.rng = resilience.rng;
    this.onRateLimit = resilience.onRateLimit;
  }

  private readonly onRateLimit?: (info: { attempt: number; retryAfterMs?: number }) => void;

  /** M2 #60 — provider-level circuit breaker (consecutive-failure). */
  private readonly breaker: CircuitBreaker;
  private readonly backoffBaseMs: number | undefined;
  private readonly rng: (() => number) | undefined;

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: stream() must serialize pool-select → build client → first-event probe → classify → retry/rotate/propagate. Extracting helpers fragments the linear narrative; the comments above each branch keep it readable.
  async *stream(
    request: LlmRequest,
    signal: AbortSignal,
  ): AsyncGenerator<LlmEvent, LlmFinish, void> {
    // M2 #60 — fail fast while the provider circuit is open, instead of
    // re-running the whole select→retry→rotate dance against a down provider.
    if (this.breaker.shouldSkip(this.pool.provider)) {
      throw new NetworkError(`${this.pool.provider} circuit open — failing fast`, {
        code: "circuit_open",
      });
    }
    let hasRetried429 = false;
    while (true) {
      if (signal.aborted) throw abortError(signal);

      let entry = await this.pool.select();
      if (entry === null) {
        // T3.9 — Reconnect storm prevention. Instead of throwing
        // immediately, wait (with jitter) for the earliest cooldown to
        // expire. Concurrent callers each pick a random delay within
        // the window to the earliest reset, so they wake at staggered
        // times and do not all re-hammer the upstream at the same
        // instant. `waitForAvailableMs === 0` opts out for legacy
        // callers and for unit tests that prefer the pre-T3.9
        // throw-fast contract.
        if (this.waitForAvailableMs > 0) {
          const available = await this.pool.waitForAvailable(signal, {
            maxWaitMs: this.waitForAvailableMs,
          });
          if (available) {
            entry = await this.pool.select();
          }
        }
        if (entry === null) {
          // M2 #60 — a whole-attempt terminal failure trips the breaker.
          this.breaker.recordTimeout(this.pool.provider);
          throw new CredentialPoolExhaustedError(
            `All ${this.pool.provider} credentials exhausted; next retry available at ${
              this.nextRetryHint() ?? "unknown"
            }`,
            { provider: this.pool.provider, nextRetryAt: this.nextRetryHint() },
          );
        }
      }

      // EC-D: a failure inside buildClient (e.g., invalid baseUrl) is
      // a transport-config bug, NOT a credential failure. Propagate
      // without marking the entry exhausted.
      const realClient: LlmClient = this.buildClient(entry.accessToken);

      const attempt = await tryFirstEvent(realClient, request, signal);
      if (attempt.kind === "ok") {
        // Stream started — rotation is no longer possible. A healthy start
        // closes the circuit breaker (M2 #60).
        this.breaker.recordSuccess(this.pool.provider);
        return yield* relayStream(attempt.generator, attempt.firstResult);
      }

      const decision = classifyAndDecide(attempt.error, hasRetried429);
      if (decision === "retry") {
        // D126: first 429 retries the same key. Don't mark exhausted yet.
        // M2 #60 — back off with full jitter before re-hitting the SAME key,
        // so a shared-quota thundering herd no longer burns the retry in <1ms
        // (AWS Brooker 2015). We deliberately do NOT sleep the provider's
        // `Retry-After` here: for a multi-key pool the right move on a 429 is to
        // fail this brief retry and ROTATE to a fresh key immediately (waiting
        // would defeat the pool). `Retry-After` IS honored at the pool-selection
        // level — the rotate path below sets the key's `resetAtMs` cooldown, so
        // subsequent selection skips a rate-limited key until its window passes
        // (a single-key pool then fails fast with CredentialPoolExhaustedError).
        const backoffMs = computeBackoffMs({
          attempt: 0,
          ...(this.backoffBaseMs !== undefined ? { baseMs: this.backoffBaseMs } : {}),
          ...(this.rng !== undefined ? { rng: this.rng } : {}),
        });
        // SE2 — surface a `rate_limit` RunEvent for the retry that is about to back off.
        this.onRateLimit?.({ attempt: 1, retryAfterMs: backoffMs });
        await sleepWithAbort(backoffMs, signal);
        hasRetried429 = true;
        continue;
      }
      if (decision === "rotate") {
        // EC-A: persistence failures during rotate must NOT abort the
        // stream. Pool state in-memory is the source of truth; disk
        // staleness self-corrects on the next successful save.
        try {
          await this.pool.markExhaustedAndRotate({
            entryId: entry.id,
            statusCode: attempt.error.metadata?.statusCode ?? inferStatusCode(attempt.error),
            ...(parseRetryAfterMs(attempt.error) !== undefined
              ? { resetAtMs: parseRetryAfterMs(attempt.error) }
              : {}),
          });
        } catch (persistErr) {
          diag(
            `[theokit-sdk] credential-pool: persist failed during rotate; continuing in-memory: ${
              persistErr instanceof Error ? persistErr.message : String(persistErr)
            }\n`,
          );
        }
        hasRetried429 = false;
        continue;
      }
      // decision === "propagate" — a whole-attempt terminal failure (M2 #60).
      this.breaker.recordTimeout(this.pool.provider);
      throw attempt.error;
    }
  }

  /**
   * Earliest epoch ms among entries' `lastErrorResetAt` — best estimate
   * for the caller's `CredentialPoolExhaustedError.nextRetryAt`.
   */
  private nextRetryHint(): number | undefined {
    const resets = this.pool
      .list()
      .map((e) => e.lastErrorResetAt)
      .filter((v): v is number => v !== undefined);
    return resets.length === 0 ? undefined : Math.min(...resets);
  }
}

/**
 * Decision matrix per ADR D125 + D126. Pure function — testable in isolation.
 *
 * @internal
 */
export function classifyAndDecide(
  error: RateLimitError | AuthenticationError | NetworkError,
  hasRetried429: boolean,
): Decision {
  // 5xx / network errors: pool doesn't help — propagate so cross-provider
  // fallback (FallbackLlmClient) can try a different provider.
  if (error instanceof NetworkError) return "propagate";

  // 401/403: rotate. No OAuth refresh in v1 (out of scope).
  if (error instanceof AuthenticationError) return "rotate";

  // RateLimitError covers 429 AND 402 (billing/quota) — distinguish via statusCode.
  const status = error.metadata?.statusCode ?? 429;
  if (status === 402) return "rotate"; // immediate, no retry (billing won't recover in ms)

  // 429: retry once, rotate on second.
  return hasRetried429 ? "rotate" : "retry";
}

/**
 * Convert provider's `retry-after` hint (seconds) into epoch ms.
 * The error mapper (D67) normalizes the header into `metadata.retryAfter`
 * (numeric seconds form only). Older formats land in `metadata.raw`.
 *
 * @internal
 */
export function parseRetryAfterMs(
  error: RateLimitError | AuthenticationError | NetworkError,
): number | undefined {
  const seconds = error.metadata?.retryAfter;
  if (typeof seconds === "number" && seconds > 0) {
    return Date.now() + seconds * 1000;
  }
  return undefined;
}

function inferStatusCode(error: RateLimitError | AuthenticationError | NetworkError): number {
  if (error instanceof AuthenticationError) return 401;
  if (error instanceof RateLimitError) return 429;
  return 0;
}
