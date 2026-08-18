/**
 * Adversarial property tests for CredentialPool (T5.1).
 *
 * 5 properties × 200 fast-check runs = 1000+ invariant assertions.
 */

import fc from "fast-check";
import { describe, it } from "vitest";

import { CredentialPool, newPooledCredential } from "../../../src/internal/llm/credential-pool.js";
import type { CredentialPoolStrategy } from "../../../src/internal/llm/credential-pool-types.js";

function pool(tokens: string[], strategy: CredentialPoolStrategy = "fill_first"): CredentialPool {
  // Ensure unique tokens — strategies don't make sense with duplicates after dedupe.
  const unique = Array.from(new Set(tokens));
  return new CredentialPool(
    "openrouter",
    unique.map((t, i) =>
      newPooledCredential({
        provider: "openrouter",
        accessToken: t,
        priority: i,
        source: "manual",
      }),
    ),
    strategy,
  );
}

const tokenArb = fc.array(fc.string({ minLength: 1, maxLength: 16 }), {
  minLength: 1,
  maxLength: 10,
});

describe("CredentialPool — property invariants (T5.1)", () => {
  it("fill_first: every select before exhaustion returns entries[0] (200 runs)", async () => {
    await fc.assert(
      fc.asyncProperty(tokenArb, async (tokens) => {
        const p = pool(tokens, "fill_first");
        const first = await p.select();
        const second = await p.select();
        return first?.accessToken === second?.accessToken;
      }),
      { numRuns: 200 },
    );
  });

  it("round_robin: N selects yield N distinct entries when N ≤ entries.length (200 runs)", async () => {
    await fc.assert(
      fc.asyncProperty(tokenArb, async (tokens) => {
        const p = pool(tokens, "round_robin");
        const n = p.list().length;
        const picks: string[] = [];
        for (let i = 0; i < n; i += 1) {
          const x = await p.select();
          if (x !== null) picks.push(x.accessToken);
        }
        return new Set(picks).size === picks.length;
      }),
      { numRuns: 200 },
    );
  });

  it("least_used: max - min requestCount ≤ 1 after K selects when K is a multiple of entries.length (200 runs)", async () => {
    await fc.assert(
      fc.asyncProperty(tokenArb, async (tokens) => {
        const p = pool(tokens, "least_used");
        const n = p.list().length;
        for (let i = 0; i < n * 3; i += 1) {
          await p.select();
        }
        const counts = p.list().map((e) => e.requestCount);
        const max = Math.max(...counts);
        const min = Math.min(...counts);
        return max - min <= 1;
      }),
      { numRuns: 200 },
    );
  });

  it("random: never returns an exhausted entry (200 runs)", async () => {
    await fc.assert(
      fc.asyncProperty(
        tokenArb.filter((t) => new Set(t).size >= 2),
        async (tokens) => {
          const p = pool(tokens, "random");
          // Exhaust the first entry.
          const first = await p.select();
          if (first === null) return true;
          await p.markExhaustedAndRotate({ entryId: first.id, statusCode: 429 });
          // Now 50 random picks must never return `first`.
          for (let i = 0; i < 50; i += 1) {
            const x = await p.select();
            if (x?.id === first.id) return false;
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it("exhaustion invariant: marked entry never returned within cooldown (200 runs)", async () => {
    await fc.assert(
      fc.asyncProperty(
        tokenArb.filter((t) => new Set(t).size >= 2),
        async (tokens) => {
          const p = pool(tokens, "fill_first");
          const first = await p.select();
          if (first === null) return true;
          await p.markExhaustedAndRotate({ entryId: first.id, statusCode: 429 });
          // 20 picks must never return `first` (within 1h cooldown).
          for (let i = 0; i < 20; i += 1) {
            const x = await p.select();
            if (x?.id === first.id) return false;
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });
});

// B-033 — a test named "property suite ran 1000 randomized scenarios", whose entire body was
// `expect(true).toBe(true)`, was deleted here rather than repaired.
//
// It FABRICATED a verification: nothing inside it could observe the five `fc.asyncProperty` blocks
// above, so deleting every one of them would have left it reporting that 1000 scenarios ran. The
// claim is also redundant — fast-check fails the run when a property fails, and `numRuns: 200` is
// declared at each call site where a reader can check it.
//
// Repairing it was not an option: the fact it asserts is about OTHER tests, and a test cannot
// honestly witness its siblings. Deleting it lowers the file's test count by one and its oracle
// strength not at all.
