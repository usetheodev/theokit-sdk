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

import type { MemorySearchHit } from "./index-manager-contract.js";

export type ActiveMemoryQueryMode = "message" | "recent" | "full";

export type ActiveMemoryStatus = "ok" | "timeout" | "skipped" | "no-recall" | "error";

export interface ActiveMemoryResult {
  summary: string | undefined;
  durationMs: number;
  status: ActiveMemoryStatus;
  hits: ReadonlyArray<MemorySearchHit>;
}
