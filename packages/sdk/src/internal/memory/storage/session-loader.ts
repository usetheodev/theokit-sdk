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
 * @internal
 */

export interface SessionFile {
  absolutePath: string;
  relPath: string;
}

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
