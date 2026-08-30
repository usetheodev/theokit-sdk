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
 * @internal
 */

export interface SessionFile {
  absolutePath: string;
  relPath: string;
}

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
