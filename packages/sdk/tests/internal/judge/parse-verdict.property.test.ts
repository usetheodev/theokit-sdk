/**
 * Adversarial property tests for parseVerdict (T5.1).
 *
 * 4 properties × 200 runs each = 800 randomized invariant assertions.
 */

import fc from "fast-check";
import { describe, it } from "vitest";

import { parseVerdict } from "../../../src/internal/judge/parse-verdict.js";

describe("parseVerdict — property invariants (T5.1)", () => {
  it("DONE: prefix → verdict=done, parseFailed=false (200 runs)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), (suffix) => {
        const result = parseVerdict(`DONE: ${suffix}`);
        return result.verdict === "done" && result.parseFailed === false;
      }),
      { numRuns: 200 },
    );
  });

  it("CONTINUE: prefix → verdict=continue, parseFailed=false (200 runs)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), (suffix) => {
        const result = parseVerdict(`CONTINUE: ${suffix}`);
        return result.verdict === "continue" && result.parseFailed === false;
      }),
      { numRuns: 200 },
    );
  });

  it("SKIPPED: prefix → verdict=skipped, parseFailed=false (200 runs)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), (suffix) => {
        const result = parseVerdict(`SKIPPED: ${suffix}`);
        return result.verdict === "skipped" && result.parseFailed === false;
      }),
      { numRuns: 200 },
    );
  });

  it("malformed input → parseFailed=true, fail-safe verdict=continue (200 runs)", () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 0, maxLength: 100 })
          .filter((s) => !/^\s*(DONE|CONTINUE|SKIPPED):/.test(s)),
        (text) => {
          const result = parseVerdict(text);
          return result.parseFailed === true && result.verdict === "continue";
        },
      ),
      { numRuns: 200 },
    );
  });
});
