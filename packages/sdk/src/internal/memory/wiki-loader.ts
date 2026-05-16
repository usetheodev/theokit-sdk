import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { memoryDir } from "./markdown-store.js";

/**
 * Wiki supplement discovery (ADR Phase 10 of memory-system-openclaw-parity).
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

export function wikiDir(cwd: string): string {
  return join(memoryDir(cwd), "wiki");
}

export async function discoverWikiFiles(cwd: string): Promise<WikiFile[]> {
  let entries: string[];
  try {
    entries = await readdir(wikiDir(cwd));
  } catch {
    return [];
  }
  const root = memoryDir(cwd);
  return entries
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => ({
      absolutePath: join(wikiDir(cwd), entry),
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
