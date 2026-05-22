/**
 * Retry wrapper with exponential backoff (ADR D237).
 *
 * `withRetry(fn, policy, signal)` retries on throw until success or
 * `maxAttempts` reached. Aborts mid-backoff when signal fires.
 * Non-retryable errors (by name) propagate immediately.
 *
 * @internal
 */

import type { RetryPolicy } from "../../types/workflow.js";

const DEFAULT_NON_RETRYABLE = ["AbortError", "WorkflowSnapshotNotFoundError", "ConfigurationError"];

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  signal: AbortSignal,
): Promise<{ value: T; attempts: number }> {
  const max = policy.maxAttempts;
  const init = policy.initialBackoffMs ?? 1000;
  const coef = policy.backoffCoefficient ?? 2.0;
  const cap = policy.maximumBackoffMs ?? 30_000;
  const nonRetryable = new Set(policy.nonRetryableErrors ?? DEFAULT_NON_RETRYABLE);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= max; attempt += 1) {
    if (signal.aborted) {
      throw new DOMException(String(signal.reason ?? "Aborted"), "AbortError");
    }
    try {
      const value = await fn();
      return { value, attempts: attempt };
    } catch (err) {
      lastErr = err;
      const errName = err instanceof Error ? err.name : "Error";
      if (nonRetryable.has(errName)) throw err;
      if (attempt === max) throw err;
      const backoff = Math.min(init * coef ** (attempt - 1), cap);
      await abortableSleep(backoff, signal);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    throw new DOMException(String(signal.reason ?? "Aborted"), "AbortError");
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      cleanup();
      reject(new DOMException(String(signal.reason ?? "Aborted"), "AbortError"));
    };
    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
