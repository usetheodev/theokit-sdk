/**
 * In-memory circuit breaker for Mem0Adapter (T5.1, EC-K).
 *
 * Trips after `threshold` consecutive failures that `Mem0Adapter#translateError`
 * decides are provider-down signals: an HTTP 5xx, or a status-less error whose
 * message contains "network". 429 / 401 / 403 / 404 / invalid_input do NOT count
 * toward the threshold — rate limits are a caller-pace signal, not a
 * provider-down signal (EC-K).
 *
 * @internal
 */

import { MemoryAdapterError } from "@theokit/sdk";

const ADAPTER_ID = "mem0";

/**
 * Tuning for the Mem0 adapter's circuit breaker, passed as `mem0Memory({ breaker })`.
 *
 * @public
 */
export interface CircuitBreakerOptions {
  /**
   * Failures required to open the breaker. Default `5`.
   *
   * TWO kinds of failure count, not one: an HTTP 5xx, and a status-less error whose message
   * contains the substring `network` (case-insensitive) — that substring match is the only way a
   * transport failure is recognised, so a DNS/connection error surfacing as `"fetch failed"` maps
   * to `code: "unknown"` and does NOT count. 429 / 401 / 403 / 404 / `invalid_input` never count.
   *
   * Size it for transport flakiness as well as for Mem0 outages: with `threshold: 5`, five
   * consecutive `network`-shaped errors open the breaker exactly as five 500s would, and the
   * resulting error says `rate_limited`, which is not what caused it.
   *
   * A single success resets the counter to zero, so this is effectively "consecutive counted
   * failures" — 4 failures followed by a success followed by 4 more never trips a default breaker.
   */
  threshold?: number;
  /**
   * How long the breaker stays open, in milliseconds. Default `120000` (2 minutes).
   *
   * While open, every call fails immediately with `MemoryAdapterError(code: "rate_limited")`
   * without touching the network. There is no half-open probe: the breaker simply closes when the
   * cooldown elapses and the next call goes through for real.
   */
  cooldownMs?: number;
}

export class CircuitBreaker {
  readonly threshold: number;
  readonly cooldownMs: number;
  #failures = 0;
  #openUntil = 0;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.threshold = opts.threshold ?? 5;
    this.cooldownMs = opts.cooldownMs ?? 2 * 60 * 1000;
  }

  /** Throws `MemoryAdapterError(code: "rate_limited")` if breaker is open. */
  ensureClosed(op: string): void {
    if (Date.now() < this.#openUntil) {
      const secondsLeft = Math.ceil((this.#openUntil - Date.now()) / 1000);
      throw new MemoryAdapterError(
        `Mem0 circuit breaker open (${op}): ${secondsLeft}s cooldown remaining.`,
        { adapterId: ADAPTER_ID, code: "rate_limited" },
      );
    }
  }

  /** Increment failure counter. Trips when threshold reached. Call only for provider-down errors. */
  recordFailure(): void {
    this.#failures += 1;
    if (this.#failures >= this.threshold) {
      this.#openUntil = Date.now() + this.cooldownMs;
    }
  }

  /** Reset on first success — closes the breaker (EC-K). */
  recordSuccess(): void {
    this.#failures = 0;
    this.#openUntil = 0;
  }

  /** Test-only inspector. @internal */
  state(): { failures: number; isOpen: boolean; openUntil: number } {
    return {
      failures: this.#failures,
      isOpen: Date.now() < this.#openUntil,
      openUntil: this.#openUntil,
    };
  }
}
