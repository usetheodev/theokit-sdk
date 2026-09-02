import { join } from "node:path";
import { listMarkdownIn } from "./list-markdown.js";
import type { MemoryRoot } from "./memory-root.js";

/**
 * Wiki supplement discovery (ADR Phase 10 of memory-system-peer-project-parity).
 *
 * Wiki files live under `.theokit/memory/wiki/*.md`. They are READ-ONLY —
 * the SDK never writes here. Each indexed chunk carries `source="wiki"` so
 * `memory_search { corpus: "wiki" }` and `corpus: "all"` can scope hits.
 *
 * Shared with `@theokit/sdk-memory` through the semver-exempt `internal/memory-store`
 * sub-path, so it carries no internal-visibility tag. `stripInternal` matches that tag as TEXT
 * anywhere in the block, so naming it here — even in backticks, even to say it is absent — deletes
 * this symbol from the published declarations and forces the satellite back onto a copy. Measured:
 * the first draft of this very note did exactly that. See #430 and #463.
 */

export interface WikiFile {
  absolutePath: string;
  relPath: string;
}

/** `<memory root>/wiki`. Takes the RESOLVED ROOT — see `storage/memory-root.ts` (#463). */
export function wikiDir(root: MemoryRoot): string {
  return join(root, "wiki");
}

/**
 * Every wiki supplement under `<memory root>/wiki`, as `{ absolutePath, relPath }` records.
 *
 * Returns `[]` when the directory does not exist. These are read-only supplements the indexer tags
 * with `source="wiki"`, so `memory_search({ corpus: "wiki" })` can scope to them.
 */
export async function discoverWikiFiles(root: MemoryRoot): Promise<WikiFile[]> {
  // The first `.map` here built a relPath the second `.map` then threw away — dead work that only
  // survived because the two copies of this function drifted apart. See `listMarkdownIn` for why
  // the hand-rolled `relativeToRoot` it used is gone.
  return await listMarkdownIn(wikiDir(root), root);
}
