import { expect, it } from "vitest";
import { humanizeModelName } from "../../src/internal/llm/model-option.js";

/**
 * CodeQL `js/polynomial-redos` #6, and the second of the eight in this batch that actually
 * reproduces.
 *
 * `humanizeModelName` is `@public` and takes a model id. It stripped trailing slashes with
 * `/\/+$/`, which on a run of slashes followed by anything else makes the engine consume to the
 * end at every start position and backtrack. Measured:
 *
 *      25_000 slashes ->     496 ms
 *     100_000 slashes ->  31_305 ms
 *
 * Thirty-one seconds of pinned CPU to render a label.
 */

it("humanizes a pathological model id without stalling", () => {
  const hostile = `openai/${"/".repeat(100_000)}a`;

  const started = Date.now();
  humanizeModelName(hostile);
  const elapsed = Date.now() - started;

  // Loose on purpose: this asserts "not quadratic", not a benchmark. The pre-fix
  // implementation misses it by four orders of magnitude.
  expect(elapsed).toBeLessThan(1_000);
});

it("still strips a trailing slash, and keeps the name it precedes", () => {
  // The accepted case (`testing.md` § 4.2). A stripper that stopped stripping would pass the
  // timing test above while quietly changing every label the docblock promises.
  expect(humanizeModelName("openai/gpt-4o/")).toBe(humanizeModelName("openai/gpt-4o"));
  expect(humanizeModelName("openai/gpt-4o///")).toBe(humanizeModelName("openai/gpt-4o"));
});

it("leaves an id with no trailing slash untouched", () => {
  expect(humanizeModelName("openai/gpt-4o")).toBe("GPT 4o");
});
