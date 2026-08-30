import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { MemoryRoot } from "./memory-root.js";

/**
 * Wiki supplement discovery (ADR Phase 10 of memory-system-peer-project-parity).
 *
 * Wiki files live under `.theokit/memory/wiki/*.md`. They are READ-ONLY —
 * the SDK never writes here. Each indexed chunk carries `source="wiki"` so
 * `memory_search { corpus: "wiki" }` and `corpus: "all"` can scope hits.
 *
 * @internal
 */

export interface WikiFile {
  absolutePath: string;
  relPath: string;
}

/** `<memory root>/wiki`. Takes the RESOLVED ROOT — see `storage/memory-root.ts` (#463). */
export function wikiDir(root: MemoryRoot): string {
  return join(root, "wiki");
}

export async function discoverWikiFiles(root: MemoryRoot): Promise<WikiFile[]> {
  let entries: string[];
  try {
    entries = await readdir(wikiDir(root));
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => ({
      absolutePath: join(wikiDir(root), entry),
      relPath: join("wiki", entry),
    }))
    .map((file) => ({
      absolutePath: file.absolutePath,
      relPath: relativeToRoot(root, file.absolutePath),
    }));
}

function relativeToRoot(root: string, absolutePath: string): string {
  // memory root is e.g. /tmp/x/.theokit/memory; wiki file is /tmp/x/.theokit/memory/wiki/foo.md
  // Strip the root + "/" prefix to get "wiki/foo.md".
  if (absolutePath.startsWith(`${root}/`)) return absolutePath.slice(root.length + 1);
  return absolutePath;
}
