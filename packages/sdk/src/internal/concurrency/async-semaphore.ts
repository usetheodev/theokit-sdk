/**
 * Async-aware counting semaphore (ADR D135).
 *
 * N-permit gate for cooperative concurrency control inside a single
 * Node process. Used by `Agent.batch` to bound parallel agent count
 * without pulling in `p-limit` or `p-queue` (~30 LoC in-house).
 *
 * Contract: `acquire()` returns a release function. Caller MUST call
 * release exactly once when done — typically in a `finally` block.
 * Release is idempotent (multiple calls are no-ops after the first)
 * for defense against caller bugs, but leaking the release function
 * permanently consumes one permit (EC-G — caller responsibility).
 *
 * @internal
 */

import { ConfigurationError } from "../../errors.js";

export interface AsyncSemaphore {
  /** Acquire a permit. Returns the release function (call once). */
  acquire(): Promise<() => void>;
  /** Permits currently held in flight. */
  inFlight(): number;
  /** Total: in-flight + queued waiters. */
  pending(): number;
}

export function createSemaphore(permits: number): AsyncSemaphore {
  if (!Number.isInteger(permits) || permits < 1) {
    throw new ConfigurationError(
      `async-semaphore: permits must be a positive integer, got ${permits}`,
      { code: "invalid_concurrency" },
    );
  }
  let active = 0;
  const queue: Array<() => void> = [];

  function tryGrant(): void {
    if (active < permits && queue.length > 0) {
      const resolve = queue.shift();
      if (resolve !== undefined) {
        active += 1;
        resolve();
      }
    }
  }

  return {
    inFlight: () => active,
    pending: () => queue.length + active,
    async acquire() {
      await new Promise<void>((resolve) => {
        queue.push(resolve);
        tryGrant();
      });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
        tryGrant();
      };
    },
  };
}
