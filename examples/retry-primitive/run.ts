/**
 * Retry.create — run a flaky function with exponential backoff until it succeeds. Deterministic.
 *
 * NOTE: by default only *transient* errors (network/rate-limit) are retried. Pass `isRetryable`
 * to retry your own error class.
 */
import { Retry } from "@theokit/sdk/retry";

let attempts = 0;
const value = await Retry.create(
  async () => {
    attempts += 1;
    if (attempts < 3) throw new Error(`transient (attempt ${attempts})`);
    return `ok after ${attempts} attempts`;
  },
  { retries: 3, initialDelayMs: 20, isRetryable: () => true },
);

console.log("Result:", value);
