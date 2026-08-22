import { expect, it } from "vitest";
import { getPricingEntry } from "../../../src/internal/budget/pricing-registry.js";

/**
 * CodeQL `js/polynomial-redos` #5, and the one in this batch that is **not** theoretical.
 *
 * `normalizeAnthropicDots` ran `/(\d+)\.(\d+)/g` over the model id. On a string of digits with no
 * dot, the engine consumes to the end at every start position and backtracks — quadratic, measured:
 *
 *      12_500 digits ->     762 ms
 *      25_000 digits ->   2_995 ms
 *      50_000 digits ->  11_960 ms
 *     200_000 digits -> 154_383 ms   (two and a half minutes, one CPU pinned)
 *
 * The model id comes from the caller, so that is a caller-supplied string stalling the process for
 * minutes — a denial of service in an SDK meant to run inside a server handling other people's
 * requests.
 */

it("normalises a long digit run without stalling", () => {
  // 200_000 digits took 154 seconds before the fix; the lookaround form does it in about 4 ms.
  const hostile = "9".repeat(200_000);

  const started = Date.now();
  getPricingEntry({ provider: "anthropic", model: hostile });
  const elapsed = Date.now() - started;

  // Deliberately loose: this asserts "not quadratic", not a benchmark number. The pre-fix
  // implementation misses this by three orders of magnitude.
  expect(elapsed).toBeLessThan(2_000);
});

it("still maps a dotted anthropic model to its dashed pricing key", () => {
  // The accepted case (`testing.md` § 4.2). A normaliser that stopped normalising would pass the
  // timing test above and quietly break every dotted model's price lookup.
  const dotted = getPricingEntry({ provider: "anthropic", model: "claude-opus-4.7" });
  const dashed = getPricingEntry({ provider: "anthropic", model: "claude-opus-4-7" });

  expect(dotted).toEqual(dashed);
});
