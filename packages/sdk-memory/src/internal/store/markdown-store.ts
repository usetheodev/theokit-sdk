import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { replaceFileAtomic, withCwdMutex } from "@theokit/sdk/persistence";

import { type MemoryConfig, type MemoryFact, redactSecrets } from "../memory-types.js";

/**
 * Markdown-first memory storage (ADR D1 of memory-system-peer-project-parity).
 *
 * Layout:
 *   .theokit/memory/
 *   ├── MEMORY.md          # facts under `## Facts`
 *   └── notes/
 *       └── <slug>.md      # per-topic notes
 *
 * All writes go through `replaceFileAtomic` + a per-cwd mutex (EC-4 of the
 * edge-case review) so concurrent `appendFact` calls within the same process
 * serialize. Multi-process safety is NOT provided.
 *
 * Iter 56 (Stage 3 source-move #13): hybrid copy from sdk-core's
 * `internal/memory/storage/markdown-store.ts`. sdk-core retains its
 * copy for v1.x markdown-first memory back-compat; sdk-memory ships
 * the canonical copy that future `tools.ts`, `dreaming-diary`,
 * `dreaming-run`, `session-loader`, `session-summary-writer`,
 * `transcript-store`, `wiki-loader`, `migration` moves will all
 * compose with as sibling.
 *
 * **Cross-package import contract:** sdk-core copy reaches into
 * sibling `../../persistence/{atomic-write,cwd-mutex}.js` (internal).
 * sdk-memory copy uses the public `@theokit/sdk/persistence`
 * sub-path (also used by sdk-memory's in-memory-provider since iter
 * 33). MemoryConfig / MemoryFact / redactSecrets come from sibling
 * `./memory-types.js` (moved iter 52).
 *
 * @internal
 */

const MEMORY_MD_HEADER =
  "# Memory\n\n> Auto-managed by @theokit/sdk. Edit freely — the SDK reads from here.\n";
const FACTS_HEADING = "## Facts";

/**
 * The memory root for a workspace: `<cwd>/.theokit/memory`. Every other path in
 * this package is derived from it, and `memory_get` refuses to read outside it.
 * Pure path computation — nothing is created on disk.
 */
export function memoryDir(cwd: string): string {
  return join(cwd, ".theokit", "memory");
}

/** Path to `MEMORY.md`, the single file holding the flat `## Facts` list. Pure path computation. */
export function memoryMdPath(cwd: string): string {
  return join(memoryDir(cwd), "MEMORY.md");
}

/**
 * Path to `<memory root>/notes`, where per-topic notes and the consolidated
 * notes written by a dreaming sweep live. Pure path computation — the directory
 * may not exist.
 */
export function notesDir(cwd: string): string {
  return join(memoryDir(cwd), "notes");
}

/** Read facts from `MEMORY.md`'s `## Facts` section. Returns `[]` when missing. */
export async function readFactsFromMarkdown(cwd: string): Promise<MemoryFact[]> {
  let raw: string;
  try {
    raw = await readFile(memoryMdPath(cwd), "utf8");
  } catch {
    return [];
  }
  return parseFactsSection(raw);
}

/** Append a fact to `MEMORY.md ## Facts`. Creates the section if missing. Atomic + serialized. */
export function appendFactToMarkdown(cwd: string, fact: MemoryFact): Promise<void> {
  return withCwdMutex(memoryDir(cwd), async () => {
    const path = memoryMdPath(cwd);
    let raw = "";
    try {
      raw = await readFile(path, "utf8");
    } catch {
      raw = "";
    }
    const sanitized = redactSecrets(fact.text);
    const next = insertFactBullet(raw, sanitized);
    await mkdir(memoryDir(cwd), { recursive: true });
    await replaceFileAtomic(path, next);
  });
}

/** One note discovered under `notes/`: its file name without the `.md` suffix, and its absolute path. */
export interface NoteFile {
  slug: string;
  path: string;
}

/**
 * List the `.md` files directly under `notes/`. Returns `[]` when the directory
 * does not exist, so a workspace that has never written a note is not an error.
 * Does not recurse into sub-directories.
 */
export async function listNotes(cwd: string): Promise<NoteFile[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(notesDir(cwd));
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".md"))
    .map((name) => ({ slug: name.replace(/\.md$/, ""), path: join(notesDir(cwd), name) }));
}

function parseFactsSection(raw: string): MemoryFact[] {
  const idx = raw.indexOf(FACTS_HEADING);
  if (idx === -1) return [];
  const tail = raw.slice(idx + FACTS_HEADING.length);
  // Stop at the next top-level or h2 heading.
  const nextHeading = tail.search(/\n#{1,2}\s/);
  const block = nextHeading === -1 ? tail : tail.slice(0, nextHeading);
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => ({ text: line.slice(2).trim() }));
}

function insertFactBullet(raw: string, fact: string): string {
  const bullet = `- ${fact}`;
  if (raw.length === 0) {
    return `${MEMORY_MD_HEADER}\n${FACTS_HEADING}\n\n${bullet}\n`;
  }
  const idx = raw.indexOf(FACTS_HEADING);
  if (idx === -1) {
    // Append a new ## Facts section, preserving prior content (EC-5).
    const sep = raw.endsWith("\n") ? "" : "\n";
    return `${raw}${sep}\n${FACTS_HEADING}\n\n${bullet}\n`;
  }
  // Find end of the facts block (next h2/h1 heading) and insert before it.
  const after = idx + FACTS_HEADING.length;
  const nextHeading = raw.slice(after).search(/\n#{1,2}\s/);
  if (nextHeading === -1) {
    const trailing = raw.endsWith("\n") ? "" : "\n";
    return `${raw}${trailing}${bullet}\n`;
  }
  const insertAt = after + nextHeading;
  return `${raw.slice(0, insertAt)}\n${bullet}${raw.slice(insertAt)}`;
}

/** Configuration-aware accessors honoring the existing MemoryConfig contract. */
export async function readFacts(cwd: string, config: MemoryConfig): Promise<MemoryFact[]> {
  if (!config.enabled) return [];
  return readFactsFromMarkdown(cwd);
}

/**
 * Append a fact, honouring the `enabled` gate on {@link MemoryConfig}: when
 * memory is disabled the call resolves without touching disk. This is the entry
 * point for configuration-aware callers; `appendFactToMarkdown` is the same
 * write without the gate.
 *
 * The write itself is atomic and serialised per memory root, and the fact text
 * passes through secret redaction first.
 */
export async function appendFact(
  cwd: string,
  config: MemoryConfig,
  fact: MemoryFact,
): Promise<void> {
  if (!config.enabled) return;
  await appendFactToMarkdown(cwd, fact);
}
