/**
 * Runtime helpers for `MemoryAdapter` (T1.1, ADR D141).
 *
 * Kept separate from `types/memory-adapter.ts` so the types module
 * stays import-free of runtime code (dep-cruise rule
 * `types-dont-import-runtime`). Adapter authors call `mkMemoryId` to
 * construct a branded id and `extractRawId` to unwrap with cross-adapter
 * safety (EC-B).
 *
 * @public
 */

import { MemoryAdapterError } from "./errors.js";
import type { MemoryId } from "./types/memory-adapter.js";

/**
 * Construct a branded `MemoryId` for an adapter. Embeds the adapter
 * identifier so `extractRawId` can reject ids minted by other adapters.
 *
 * @public
 */
export function mkMemoryId(adapterId: string, rawId: string): MemoryId {
  return `${adapterId}:${rawId}` as MemoryId;
}

/**
 * Extract the raw provider id from a `MemoryId`, enforcing that the
 * prefix matches `expectedAdapterId`. Throws `MemoryAdapterError(code:
 * "invalid_input")` on mismatch — prevents `mem0.delete(supermemoryId)`
 * from accidentally deleting unrelated data (EC-B).
 *
 * @public
 */
export function extractRawId(id: MemoryId, expectedAdapterId: string): string {
  const prefix = `${expectedAdapterId}:`;
  if (!id.startsWith(prefix)) {
    const sourcePrefix = id.split(":", 1)[0] ?? "<malformed>";
    throw new MemoryAdapterError(
      `MemoryId belongs to a different adapter (expected "${expectedAdapterId}", got "${sourcePrefix}")`,
      { adapterId: expectedAdapterId, code: "invalid_input" },
    );
  }
  return id.slice(prefix.length);
}
