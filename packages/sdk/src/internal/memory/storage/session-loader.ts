import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { MemoryRoot } from "./memory-root.js";
import { sessionsDir } from "./session-summary-writer.js";

/**
 * Session summary discovery (ADR D20).
 *
 * Mirrors `wiki-loader.ts:discoverWikiFiles`: scans
 * `.theokit/memory/sessions/*.md` and returns `SessionFile` records —
 * `{ absolutePath, relPath }`. IndexManager tags each chunk with
 * `source="sessions"` so `memory_search({ corpus: "sessions" })` filters
 * them in.
 *
 * B-140: this said "returns `MemoryFileEntry`-shaped records" and that was
 * not true — `MemoryFileEntry` carried four fields (`path`, `relPath`,
 * `mtime`, `hash`) against this function's two, and even the path field was
 * named differently. Nothing consumed the interface, so it was removed and
 * the sentence now names the type the function actually returns. A docblock
 * asserting agreement between two shapes is worth no more than the agreement.
 *
 * Shared with `@theokit/sdk-memory` through the semver-exempt `internal/memory-store`
 * sub-path, so it carries no internal-visibility tag. `stripInternal` matches that tag as TEXT
 * anywhere in the block, so naming it here — even in backticks, even to say it is absent — deletes
 * this symbol from the published declarations and forces the satellite back onto a copy. Measured:
 * the first draft of this very note did exactly that. See #430 and #463.
 */

export interface SessionFile {
  absolutePath: string;
  relPath: string;
}

/**
 * Every session summary under `<memory root>/sessions`, as `{ absolutePath, relPath }` records.
 *
 * Returns `[]` when the directory does not exist, so a workspace that has never finished a run is
 * not an error. `IndexManager` tags what this returns with `source="sessions"`, which is what
 * `memory_search({ corpus: "sessions" })` filters on.
 */
export async function discoverSessionFiles(root: MemoryRoot): Promise<SessionFile[]> {
  let entries: string[];
  try {
    entries = await readdir(sessionsDir(root));
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => {
      const absolutePath = join(sessionsDir(root), entry);
      return {
        absolutePath,
        relPath: relativeToRoot(root, absolutePath),
      };
    });
}

function relativeToRoot(root: string, absolutePath: string): string {
  if (absolutePath.startsWith(`${root}/`)) return absolutePath.slice(root.length + 1);
  return absolutePath;
}
