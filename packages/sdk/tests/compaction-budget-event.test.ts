/**
 * M77 T2.1 — the context budget stops being silent.
 *
 * ## What was there
 *
 * A once-per-process `process.stderr.write` (`post-run-lifecycle.ts:113-124`), guarded by a
 * `Set` on a global symbol. No surface can react to that: the TUI does not read its own process's
 * stderr, headless exec does not correlate it with the turn, and a second unknown model in the same
 * session **warns nothing** because the `Set` already has the key.
 *
 * The right channel already exists and has a direct example: `RunEvent` (`types/run-events.ts:19`), with
 * `compact_boundary` (`:107`) emitted by `emitRunEvent` in the same file as the decision.
 *
 * ## The inverted-comment gate
 *
 * `post-run-lifecycle.ts:108` said:
 *
 * > *"Missing usage/window ⇒ the trigger never fires (fail-safe)"*
 *
 * It is backwards. Not compacting when the window is unknown lets the context **grow until the provider
 * refuses** — that is fail-OPEN. A comment calling the unsafe behavior safe is worse than
 * no comment at all: it ends the investigation of anyone reading the code looking for the defect.
 * The last test in this file is the truthfulness gate, following the M67 precedent
 * (`agents/m67-docs-truthfulness.test.ts`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveEffectiveContextWindow } from "../src/compaction.js";
import { buildContextBudgetEvent } from "../src/internal/runtime/lifecycle/context-budget-event.js";
import type { RunEvent } from "../src/types/run-events.js";

describe("M77 T2.1 — structured context-budget event", () => {
  it("test_a_model_outside_the_catalog_emits_compaction_fallback", () => {
    const resolved = resolveEffectiveContextWindow({ margin: 0.95, floor: 128_000 });
    const event = buildContextBudgetEvent("openrouter/some-model", resolved);

    expect(event, "an unknown model must produce an event, not silence").toBeDefined();
    expect(event?.type).toBe("compaction_fallback");
  });

  it("test_the_event_carries_the_MODEL_and_the_assumed_WINDOW", () => {
    // Without the model, the surface does not know WHICH configuration to fix. Without the window, the user does not
    // know what they are being measured against — and the gauge lies again, which is DoD 6 of this same
    // milestone.
    const resolved = resolveEffectiveContextWindow({ margin: 0.95, floor: 128_000 });
    const event = buildContextBudgetEvent("openrouter/x", resolved);

    expect(event?.model).toBe("openrouter/x");
    expect(event?.window).toBe(121_600);
  });

  it("test_a_model_IN_the_catalog_emits_neither", () => {
    // Mandatory COUNTER-PROOF: without it, an implementation that always emitted would pass both
    // tests above — and the event would become noise the surface learns to ignore.
    const resolved = resolveEffectiveContextWindow({ catalog: 200_000, margin: 0.95 });
    expect(buildContextBudgetEvent("gpt-5.4", resolved)).toBeUndefined();
  });

  it("test_an_override_is_also_silent_because_the_user_ALREADY_knows", () => {
    // The user who declared the window does not need to be told it was used.
    const resolved = resolveEffectiveContextWindow({ override: 50_000, margin: 0.95 });
    expect(buildContextBudgetEvent("anything", resolved)).toBeUndefined();
  });

  it("test_the_event_is_a_LEGITIMATE_RunEvent_variant", () => {
    // A type proof, not an execution one: if `compaction_fallback` were not part of the `RunEvent` union,
    // this assignment would fail at COMPILE time. `tsc` is what checks, not vitest.
    const resolved = resolveEffectiveContextWindow({ margin: 0.95, floor: 128_000 });
    const event = buildContextBudgetEvent("m", resolved);
    if (event !== undefined) {
      const asRunEvent: RunEvent = event;
      expect(asRunEvent.type).toBe("compaction_fallback");
    }
  });

  it("test_the_post_run_lifecycle_comment_no_longer_calls_it_fail_safe", () => {
    // Docs truthfulness gate — M67 precedent. The comment described as "fail-safe" the
    // behavior that makes the context overflow; a reader would believe the silence was safe.
    const source = readFileSync(
      join(import.meta.dirname, "../src/internal/runtime/lifecycle/post-run-lifecycle.ts"),
      "utf-8",
    );

    // The first version of this gate banned the STRING "fail-safe" and failed against the fix itself: the
    // corrective comment QUOTES the wrong term to explain it was wrong. Banning the word
    // would ban the correction too — the oracle must target the CLAIM, not the vocabulary.
    expect(
      /trigger never fires \(fail-safe\)/i.test(source),
      "the inverted claim is back: turning compaction off is NOT fail-safe",
    ).toBe(false);

    // And the counter-proof: without it, deleting the whole comment would pass — and the lesson goes with it.
    expect(
      /fail-OPEN/.test(source),
      "the correction must be written down, not just the wrong sentence removed",
    ).toBe(true);
  });
});
