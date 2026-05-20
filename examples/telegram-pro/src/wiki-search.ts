import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Server-side wiki search. Bypasses the LLM entirely — gemini-flash was
 * unreliable with the multi-step "grep then cat" tool flow (would hallucinate
 * "no match" or print the cat command as text instead of executing it).
 *
 * We list `.theokit/memory/wiki/*.md`, grep their contents + filenames
 * case-insensitively against `query`, and return the matching chunks.
 *
 * @internal to the example
 */

export interface WikiHit {
  filename: string;
  excerpt: string;
}

export async function searchWiki(cwd: string, query: string): Promise<WikiHit[]> {
  const wikiDir = join(cwd, ".theokit", "memory", "wiki");
  let entries: string[];
  try {
    entries = await readdir(wikiDir);
  } catch {
    return [];
  }
  const lowerQ = query.toLowerCase().trim();
  if (lowerQ.length === 0) return [];
  const hits: WikiHit[] = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const path = join(wikiDir, name);
    const raw = await readFile(path, "utf8");
    const filenameMatch = name.toLowerCase().includes(lowerQ);
    const contentMatch = raw.toLowerCase().includes(lowerQ);
    if (!filenameMatch && !contentMatch) continue;
    // Extract a 6-line excerpt centered around the first content match (or
    // the whole file when only the filename matched).
    let excerpt: string;
    if (contentMatch) {
      const lines = raw.split("\n");
      const idx = lines.findIndex((l) => l.toLowerCase().includes(lowerQ));
      const start = Math.max(0, idx - 1);
      const end = Math.min(lines.length, idx + 6);
      excerpt = lines.slice(start, end).join("\n");
    } else {
      excerpt = raw.split("\n").slice(0, 8).join("\n");
    }
    hits.push({ filename: name, excerpt: excerpt.trim() });
  }
  return hits;
}
