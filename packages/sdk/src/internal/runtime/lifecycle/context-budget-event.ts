/**
 * M77 — turn the context-budget decision into a structured event.
 *
 * Before this, the only signal that auto-compaction had no window to budget against was a
 * `process.stderr.write` guarded by a once-per-process `Set` on a global symbol. No surface can react
 * to that: the TUI does not read its own stderr, headless exec cannot correlate it with a turn, and a
 * SECOND unknown model in the same session says nothing at all because the `Set` already has a key.
 *
 * The event rides the channel that already exists — `RunEvent` / `emitRunEvent` — mirroring the shape
 * of `compact_boundary` (`types/run-events.ts:107`), which is emitted from the same file that makes
 * this decision.
 *
 * Deliberately silent on the happy path. An event that fires on every turn is an event surfaces learn
 * to ignore, and then it stops being a signal.
 */
import type { EffectiveContextWindow } from "../../../compaction.js";
import type { RunCompactionFallbackEvent } from "../../../types/run-events.js";

/**
 * Build the fallback event, or `undefined` when no warning is warranted.
 *
 * Warranted only for `source === "fallback"` — neither the catalog nor the caller knew the window, so
 * the budget is running on a floor. `"catalog"` needs no event (it is the normal path) and
 * `"override"` needs none either: the caller who supplied the number already knows it is in use.
 */
export function buildContextBudgetEvent(
  model: string,
  resolved: EffectiveContextWindow,
): RunCompactionFallbackEvent | undefined {
  if (resolved.source !== "fallback") return undefined;
  return { type: "compaction_fallback", model, window: resolved.window };
}
