/**
 * Adversarial property tests for AsyncLocalStorage tool whitelist (T5.1).
 *
 * Confirms that parallel forks NEVER cross-contaminate state.
 */

import fc from "fast-check";
import { describe, it } from "vitest";

import {
  currentToolWhitelist,
  withToolWhitelist,
} from "../../../src/internal/runtime/async-local-storage.js";

describe("AsyncLocalStorage — property invariants (T5.1)", () => {
  it("parallel forks see only their own whitelist (200 runs)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
          minLength: 1,
          maxLength: 10,
        }),
        async (names) => {
          const sets = names.map((n) => new Set([n]));
          const results = await Promise.all(
            sets.map((set) =>
              withToolWhitelist(set, async () => {
                await new Promise((r) => setTimeout(r, 0));
                return currentToolWhitelist();
              }),
            ),
          );
          for (let i = 0; i < sets.length; i += 1) {
            if (results[i] !== sets[i]) return false;
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });
});
