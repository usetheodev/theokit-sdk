import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { memoryDir } from "./markdown-store.js";
import { sessionsDir } from "./session-summary-writer.js";

/**
 * Session summary discovery (ADR D20).
 *
 * Mirrors `wiki-loader.ts:discoverWikiFiles`: scans
 * `.theokit/memory/sessions/*.md` and returns `MemoryFileEntry`-shaped
 * records. IndexManager tags each chunk with `source="sessions"` so
 * `memory_search({ corpus: "sessions" })` filters them in.
 *
 * Iter 62 (Stage 3 source-move #19): hybrid copy from sdk-core's
 * `internal/memory/storage/session-loader.ts`. sdk-core retains its
 * copy for v1.x sessions back-compat; sdk-memory ships the canonical
 * copy. **Closes the sessions/ cluster in sdk-memory** — session
 * summary writer (iter 61) + session-loader (this iter) are both
 * canonical. Dependencies (sibling, both moved):
 * - `memoryDir` from `./markdown-store.js` (moved iter 56)
 * - `sessionsDir` from `./session-summary-writer.js` (moved iter 61)
 *
 * @internal
 */

export interface SessionFile {
  absolutePath: string;
  relPath: string;
}

/**
 * List the session summaries under `sessions/`, with each path expressed
 * relative to the memory root so the index can store a stable `sessions/<id>.md`.
 * Returns `[]` when the directory does not exist. Does not recurse.
 */
export async function discoverSessionFiles(cwd: string): Promise<SessionFile[]> {
  let entries: string[];
  try {
    entries = await readdir(sessionsDir(cwd));
  } catch {
    return [];
  }
  const root = memoryDir(cwd);
  return entries
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => {
      const absolutePath = join(sessionsDir(cwd), entry);
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
