/**
 * Type-leaf — shared types between `active-memory.ts` and
 * `active-memory-cache.ts`. Extracted to break LOW type-only cycle #10
 * (audit `architecture-output/final_report.md`) per plan
 * arch-review-fixes-2026-06-06 § Phase 4 / T4.1 (D438).
 *
 * Internal — `active-memory.ts` re-exports these for in-tree consumers
 * that historically imported from there.
 *
 * **Iter 48 (Stage 3) note:** the original `MemorySearchHit` import
 * from `./index-manager-contract.js` was inlined as a duplicate
 * interface because rollup-plugin-dts treeshakes the source type out
 * of the dts emit (it's not reachable from any other public surface
 * yet). When `MemorySearchHit` gains a reachable consumer, the inline
 * duplicate here MUST be deleted + the import restored to maintain a
 * single source of truth. Inline shape is kept byte-identical to the
 * canonical declaration.
 *
 * @internal
 */

/** Mirror of `MemorySearchHit` from `index-manager-contract.ts` (iter 48 dts workaround). */
interface MemorySearchHit {
  /** Path relative to the memory root. */
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  /** Combined score (hybrid when vector backend active, else just textScore). */
  readonly score: number;
  /** FTS5 BM25 score normalized to 0..1 (higher = better). */
  readonly textScore: number;
}

export type ActiveMemoryQueryMode = "message" | "recent" | "full";

export type ActiveMemoryStatus = "ok" | "timeout" | "skipped" | "no-recall" | "error";

export interface ActiveMemoryResult {
  summary: string | undefined;
  durationMs: number;
  status: ActiveMemoryStatus;
  hits: ReadonlyArray<MemorySearchHit>;
}
