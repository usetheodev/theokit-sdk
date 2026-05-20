/**
 * In-memory circuit breaker for Mem0Adapter (T5.1, EC-K).
 *
 * Trips after `threshold` consecutive 5xx-class failures. 429 / 401 /
 * 404 / invalid_input do NOT count toward the threshold — rate limits
 * are a caller-pace signal, not a provider-down signal (EC-K).
 *
 * @internal
 */

import { MemoryAdapterError } from "@usetheo/sdk";

const ADAPTER_ID = "mem0";

export interface CircuitBreakerOptions {
  threshold?: number;
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

  /** Increment failure counter. Trips when threshold reached. Only call for 5xx-class errors. */
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
