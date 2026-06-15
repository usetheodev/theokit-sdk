/**
 * Iteration budget for the agent loop (T2.1, ADRs D90-D91).
 *
 * Tracks remaining iterations + compression attempts + grace-call usage.
 * Caps prevent the 4 compression death spirals Hermes shipped:
 *   - v0.4 #1723: `compression_attempts` never reset
 *   - v0.7 #4750: compression triggers → fails → triggers again
 *   - v0.11 #10065: stale agent timeout, empty response after tools
 *   - v0.11 #10472: empty-tools after tools, premature loop exit
 *
 * Default: max 8 iterations, max 3 compressions per session, 1 grace call.
 *
 * NOTE on caller-supplied huge maxIterations (EC-12): `Number.MAX_SAFE_INTEGER`
 * is honored — caller is responsible for picking a reasonable cap. Recommended
 * ≤32 for production workloads.
 *
 * NOTE on per-send reset (EC-14): each `Agent.send` should construct a fresh
 * `IterationBudget`. This is intentional — every send is its own iteration
 * round, not a long-running budget shared across sends.
 *
 * @internal
 */

export class IterationBudgetExhaustedError extends Error {
  override readonly name: string = "IterationBudgetExhaustedError";
}

export class CompressionExhaustedError extends Error {
  override readonly name: string = "CompressionExhaustedError";
}

export class CompressionIneffectiveError extends Error {
  override readonly name: string = "CompressionIneffectiveError";
}

export interface IterationBudgetOptions {
  /** Total iterations before grace call. Default 8. */
  maxIterations?: number;
  /** Max compression attempts per session (D91). Default 3. */
  maxCompressions?: number;
  /** When true (default), one final iteration is allowed after budget exhausted. */
  allowGraceCall?: boolean;
}

/**
 * Stateful budget tracker. Encapsulates state per ADR D90 — class is the
 * canonical home so leak across sessions is impossible (vs POJO that Hermes
 * #1723 shipped as a bug).
 *
 * @internal
 */
export class IterationBudget {
  #remaining: number;
  readonly #total: number;
  #compressionAttempts = 0;
  #graceCallUsed = false;
  readonly #maxCompressions: number;
  readonly #allowGrace: boolean;

  constructor(opts: IterationBudgetOptions = {}) {
    this.#total = opts.maxIterations ?? 8;
    this.#remaining = this.#total;
    this.#maxCompressions = opts.maxCompressions ?? 3;
    this.#allowGrace = opts.allowGraceCall ?? true;
  }

  get remaining(): number {
    return this.#remaining;
  }

  get total(): number {
    return this.#total;
  }

  get compressionAttempts(): number {
    return this.#compressionAttempts;
  }

  get graceCallUsed(): boolean {
    return this.#graceCallUsed;
  }

  /**
   * Decrement remaining by `amount` (default 1). EC-4 fix: NaN / negative
   * / non-finite values are treated as 0 (no-op) to prevent state corruption.
   */
  consume(amount = 1): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.#remaining = Math.max(0, this.#remaining - amount);
  }

  /**
   * Record a compression attempt. Returns `{ allowed: false, reason }` if
   * cap reached — caller MUST honor and abort compression.
   */
  recordCompression(): { allowed: boolean; reason?: string } {
    if (this.#compressionAttempts >= this.#maxCompressions) {
      return {
        allowed: false,
        reason: `compression cap reached (${this.#maxCompressions} per session)`,
      };
    }
    this.#compressionAttempts += 1;
    return { allowed: true };
  }

  /**
   * True iff the loop should run another iteration:
   *   - remaining > 0, OR
   *   - grace not yet used AND grace allowed.
   */
  shouldContinue(): boolean {
    if (this.#remaining > 0) return true;
    if (this.#allowGrace && !this.#graceCallUsed) return true;
    return false;
  }

  /**
   * Mark grace call as used. Idempotent — calling more than once is no-op.
   * Caller invokes when `remaining === 0` and takes the last shot.
   */
  useGraceCall(): void {
    this.#graceCallUsed = true;
  }
}
