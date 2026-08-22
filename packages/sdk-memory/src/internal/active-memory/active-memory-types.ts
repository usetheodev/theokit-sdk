/**
 * Type-leaf — shared types between `active-memory.ts` and
 * `active-memory-cache.ts`. Extracted to break LOW type-only cycle #10
 * (audit `architecture-output/final_report.md`) per plan
 * arch-review-fixes-2026-06-06 § Phase 4 / T4.1 (D438).
 *
 * Internal — `active-memory.ts` re-exports these for in-tree consumers
 * that historically imported from there.
 *
 * **Iter 48 → iter 50 evolution:** the original `MemorySearchHit`
 * import from `./index-manager-contract.js` was temporarily inlined
 * as a duplicate interface because rollup-plugin-dts treeshook it out
 * of sdk-memory's dist (no reachable consumer yet). Iter 50 moved
 * `memory-index.ts` into sdk-memory and the barrel now publicly
 * re-exports `MemorySearchHit` — creating the reachable consumer —
 * so this file restores the canonical import and the inline mirror
 * is gone. Single source of truth is back.
 *
 * @internal
 */

import type { MemorySearchHit } from "../index/index-manager-contract.js";

/**
 * How the recall query is built from the conversation.
 *
 * `message` uses only the incoming user text. `recent` (the default) prepends
 * the last few user turns, so a follow-up like "and the other one?" still
 * carries its subject. `full` prepends every prior user turn, which broadens
 * recall but lets an old topic dominate a long conversation. Assistant turns are
 * never included in any mode.
 */
export type ActiveMemoryQueryMode = "message" | "recent" | "full";

/**
 * Outcome of one recall attempt.
 *
 * `ok` is the only status that carries a summary. `no-recall` means the search
 * ran and matched nothing, or the built query was empty. `skipped` means no
 * search was attempted at all — recall disabled, no index, or the circuit
 * breaker open. `timeout` means the search outlived `timeoutMs`, and `error`
 * that it threw. The four non-`ok` statuses are reported, never thrown: recall
 * failing must not fail the agent run.
 */
export type ActiveMemoryStatus = "ok" | "timeout" | "skipped" | "no-recall" | "error";

/**
 * Result of one recall attempt. `summary` is set only when `status` is `ok`, and
 * is the text the system-prompt pipeline injects. `hits` carries the underlying
 * matches so a caller can render its own block instead. `durationMs` covers the
 * search only, and is 0 on the `skipped` paths.
 */
export interface ActiveMemoryResult {
  summary: string | undefined;
  durationMs: number;
  status: ActiveMemoryStatus;
  hits: ReadonlyArray<MemorySearchHit>;
}
