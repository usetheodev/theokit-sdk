import { describe, expect, it } from "vitest";
import { MEMORY_KINDS } from "../src/internal/memory/types.js";
import { unstoredRememberWarning } from "../src/internal/runtime/memory/memory-store.js";

/*
 * #462 — a `Remember` phrase one token away from the supported form stored nothing, and said
 * nothing.
 *
 * `persistMemoryFactIfWritePrompt` had three early returns and no diagnostic on any of them. The
 * turn answered normally, the transcript indexer still surfaced the sentence on a follow-up
 * question, and the developer concluded memory was on. What they had was full-text search over
 * transcripts: no `MEMORY.md`, nothing to commit, nothing a human can edit, and nothing that
 * survives transcript pruning.
 *
 * The reported near-miss is not exotic. `Remember (project): …` was ignored by every version before
 * 4.57.0 and captured from 4.57.0 on, with nothing announcing the change — so a consumer on a caret
 * range had a different set of working phrases depending on what the lockfile resolved.
 *
 * This is the pure half of the fix, in the shape `indexBudgetWarning` already established here:
 * return the sentence, let the caller decide where to put it. A pure function is testable without a
 * filesystem or a captured stderr, and the emission site stays one line.
 */
describe("unstoredRememberWarning", () => {
  it("test_an_ordinary_turn_says_nothing", () => {
    for (const message of [
      "What does the deploy script do?",
      "Please summarise the changes.",
      "I will remember to check that later.",
      "",
    ]) {
      expect(unstoredRememberWarning(message)).toBeUndefined();
    }
  });

  // The accepted input, and the reason the case above is not vacuous: a supported phrase has to
  // stay silent, or the warning would fire on every successful capture.
  it("test_a_supported_phrase_says_nothing", () => {
    expect(
      unstoredRememberWarning("Remember: deploys go through the release branch"),
    ).toBeUndefined();
    for (const kind of MEMORY_KINDS) {
      expect(
        unstoredRememberWarning(`Remember (${kind}): deploys go through release`),
      ).toBeUndefined();
    }
    expect(
      unstoredRememberWarning("Remember this durable preference: tabs over spaces"),
    ).toBeUndefined();
  });

  // The reported phrases. Each reads as correct and is captured by no version.
  it("test_a_near_miss_is_reported", () => {
    for (const message of [
      "Remember, please: deploys go through the release branch",
      "Remember that: deploys go through the release branch",
      "Remember (deployment): deploys go through the release branch",
      "Please remember: deploys go through the release branch",
    ]) {
      expect(unstoredRememberWarning(message)).toBeDefined();
    }
  });

  // `Remember:` with nothing after it reached `extractMemoryFact`, came back empty, and returned —
  // the second silent path, and the one a typo produces.
  it("test_a_capture_with_no_fact_is_reported", () => {
    expect(unstoredRememberWarning("Remember:   ")).toBeDefined();
    expect(unstoredRememberWarning("Remember this durable preference")).toBeDefined();
  });

  /*
   * The message names the supported forms, and derives them from the same constant the pattern
   * admits. A hand-written list is a second source of truth for the vocabulary, and this issue IS
   * the vocabulary changing without the reader being told — a warning that could go stale the same
   * way would reproduce the defect one layer up.
   */
  it("test_the_message_names_every_supported_kind_from_the_one_source", () => {
    const message = unstoredRememberWarning("Remember, please: something");
    expect(message).toBeDefined();
    for (const kind of MEMORY_KINDS) expect(message).toContain(kind);
    expect(message).toContain("Remember:");
  });

  it("test_the_message_quotes_what_was_not_stored_so_the_reader_can_find_it", () => {
    const message = unstoredRememberWarning("Remember, please: the vault rotates on Fridays");
    expect(message).toContain("the vault rotates on Fridays");
  });

  /*
   * The property, not a magic number: the diagnostic must not GROW with the turn. An earlier
   * version of this case asserted `< 400` — a number picked before the message existed, which
   * measures the prose rather than the truncation it was written to check.
   */
  it("test_the_message_does_not_grow_with_the_input", () => {
    const short = unstoredRememberWarning("Remember, please: x") as string;
    const long = unstoredRememberWarning(`Remember, please: ${"x".repeat(5000)}`) as string;
    expect(short).toBeDefined();
    expect(long).toBeDefined();
    // The quote is capped, so a 5000-character turn costs at most the cap plus the ellipsis.
    expect(long.length).toBeLessThanOrEqual(short.length + 140);
  });
});
