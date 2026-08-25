import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { ConfigurationError } from "../../../errors.js";
import { replaceFileAtomic } from "../../persistence/atomic-write.js";
import { withCwdMutex } from "../../persistence/cwd-mutex.js";
import { MEMORY_KINDS, type MemoryConfig, type MemoryFact, redactSecrets } from "../types.js";
import { parseMemoryFile, renderMemoryFile, slugForFact } from "./memory-file.js";

/**
 * Markdown-first memory storage (ADR D1 of memory-system-peer-project-parity).
 *
 * Layout, converged with the one the Claude Code CLI reads:
 *   <memoryDir>/
 *   ├── MEMORY.md          # INDEX — one `- [text](slug.md)` line per memory
 *   ├── <slug>.md          # one memory, frontmatter carrying `metadata.type` + `modified`
 *   └── notes/
 *       └── <slug>.md      # hand-written per-topic notes (read by the indexer, never written here)
 *
 * The SDK already emits native Claude Code `.jsonl` sessions, so a consumer can point
 * `local.sessionDir` at `~/.claude` and `--continue` a session its agent wrote. Memory did not hold
 * that line: a fact was a bullet under `## Facts` with its kind in an HTML comment (#389), which
 * that CLI reads as prose. Pointing a memory directory at `~/.claude/projects/<project>/memory/`
 * produced nothing it could open.
 *
 * `## Facts` bullets are still READ. They are already on disk in consumers' repositories, and a
 * format change that stopped reading them would delete what someone recorded — worse than the
 * format it replaces.
 *
 * All writes go through `replaceFileAtomic` + a per-cwd mutex (EC-4 of the
 * edge-case review) so concurrent `appendFact` calls within the same process
 * serialize. Multi-process safety is NOT provided.
 *
 * @internal
 */

const MEMORY_MD_HEADER =
  "# Memory\n\n> Auto-managed by @theokit/sdk. Edit freely — the SDK reads from here.\n";
const FACTS_HEADING = "## Facts";

export function memoryDir(cwd: string): string {
  return join(cwd, ".theokit", "memory");
}

export function memoryMdPath(cwd: string): string {
  return join(memoryDir(cwd), "MEMORY.md");
}

export function notesDir(cwd: string): string {
  return join(memoryDir(cwd), "notes");
}

/**
 * Every memory in the store: the per-memory files, plus any legacy `## Facts` bullets still in
 * `MEMORY.md`. Returns `[]` when the directory does not exist.
 *
 * Reading both is not transitional politeness. Those bullets are already on disk in consumers'
 * repositories, and the store's own header invites editing them by hand — a converged writer that
 * stopped reading them would delete what someone recorded, which is worse than the format it fixes.
 */
export async function readFactsFromMarkdown(cwd: string): Promise<MemoryFact[]> {
  let entries: string[];
  try {
    entries = await readdir(memoryDir(cwd));
  } catch {
    return [];
  }

  const facts: MemoryFact[] = [];
  for (const entry of entries.sort()) {
    const fact = await readMemoryFileAt(cwd, entry);
    if (fact !== undefined) facts.push(fact);
  }

  try {
    facts.push(...parseFactsSection(await readFile(memoryMdPath(cwd), "utf8")));
  } catch {
    // no index yet — the per-memory files above are the whole store
  }
  return facts;
}

/**
 * One directory entry as a fact, or `undefined` when it is not one.
 *
 * `MEMORY.md` is the index, not a memory; a non-markdown entry is not a memory; and a markdown file
 * without the frontmatter is a note somebody wrote by hand. Turning any of those into a fact would
 * put text into recall that nobody recorded as one.
 */
async function readMemoryFileAt(cwd: string, entry: string): Promise<MemoryFact | undefined> {
  if (!entry.endsWith(".md") || entry === "MEMORY.md") return undefined;
  let raw: string;
  try {
    raw = await readFile(join(memoryDir(cwd), entry), "utf8");
  } catch {
    return undefined; // vanished between readdir and read
  }
  const parsed = parseMemoryFile(raw);
  if (parsed === undefined) return undefined;
  return {
    text: parsed.description,
    ...(parsed.kind !== undefined ? { kind: parsed.kind } : {}),
    ...(parsed.modified !== undefined ? { modified: parsed.modified } : {}),
  };
}

/**
 * Write a fact as its own memory file and point the `MEMORY.md` index at it. Atomic + serialized.
 *
 * `modified` is stamped HERE and never read from `fact`: a timestamp a caller can set is a
 * timestamp that can lie about when something was learned, and weighing recency is the point.
 */
export function appendFactToMarkdown(cwd: string, fact: MemoryFact): Promise<void> {
  return withCwdMutex(memoryDir(cwd), async () => {
    // Validate at the boundary (`error-handling.md` § 2): a kind outside the four would be written
    // to a file recall later trusts, so it is refused here rather than stored and believed.
    if (fact.kind !== undefined && !MEMORY_KINDS.includes(fact.kind)) {
      throw new ConfigurationError(
        `Unknown memory fact kind "${fact.kind}". Expected one of: ${MEMORY_KINDS.join(", ")}.`,
        { code: "invalid_memory_kind" },
      );
    }
    const text = redactSecrets(fact.text);
    const name = slugForFact(text);
    await mkdir(memoryDir(cwd), { recursive: true });
    await replaceFileAtomic(
      join(memoryDir(cwd), `${name}.md`),
      renderMemoryFile({
        name,
        description: text,
        ...(fact.kind !== undefined ? { kind: fact.kind } : {}),
        modified: new Date().toISOString(),
        body: text,
      }),
    );
    await replaceFileAtomic(memoryMdPath(cwd), await nextIndex(cwd, text, name));
  });
}

/**
 * The `MEMORY.md` index with `name` present exactly once.
 *
 * Rewriting the same memory replaces its line rather than adding a second: the index is a map from
 * memory to file, and two lines for one file is a map that disagrees with itself.
 */
async function nextIndex(cwd: string, text: string, name: string): Promise<string> {
  let existing = "";
  try {
    existing = await readFile(memoryMdPath(cwd), "utf8");
  } catch {
    existing = "";
  }
  const entry = `- [${text}](${name}.md)`;
  const kept = existing
    .split("\n")
    .filter((line) => !line.startsWith(`- [`) || !line.includes(`](${name}.md)`));
  const body = kept.join("\n").trimEnd();
  const head = body.length > 0 ? body : MEMORY_MD_HEADER.trimEnd();
  return `${head}\n${entry}\n`;
}

/**
 * Facts from a legacy `## Facts` section — the shape every released version wrote.
 *
 * Kept for reading only. The converged writer puts each memory in its own file, and this parser
 * exists so a store written by an earlier version keeps answering.
 *
 * There is no metadata to recover from a bullet: `kind` and `modified` are absent, which is exactly
 * right, since nothing recorded them. A brief encoding that carried them in a trailing HTML comment
 * (#389) never reached a published version — 4.55.0 was published at 17:23Z and that commit landed
 * at 20:06Z — so there is no store in the wild to migrate from it.
 */
/** A `MEMORY.md` index entry: a link whose target is a sibling `.md` file. */
const INDEX_ENTRY = /^\[[^\]]*\]\([^)]+\.md\)$/;

function parseFactsSection(raw: string): MemoryFact[] {
  const idx = raw.indexOf(FACTS_HEADING);
  if (idx === -1) return [];
  const tail = raw.slice(idx + FACTS_HEADING.length);
  // Stop at the next top-level or h2 heading.
  const nextHeading = tail.search(/\n#{1,2}\s/);
  const block = nextHeading === -1 ? tail : tail.slice(0, nextHeading);
  return (
    block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim())
      // An index entry is a POINTER to a memory, not a memory. Both are `- ` bullets, and when a
      // legacy `## Facts` heading is present the appended index lines land under it — counting them
      // here would report every converged memory twice, once from its file and once from its link.
      .filter((body) => !INDEX_ENTRY.test(body))
      .map((body) => ({ text: body }))
  );
}

/** Configuration-aware accessors honoring the existing MemoryConfig contract. */
export async function readFacts(cwd: string, config: MemoryConfig): Promise<MemoryFact[]> {
  if (!config.enabled) return [];
  return readFactsFromMarkdown(cwd);
}

export async function appendFact(
  cwd: string,
  config: MemoryConfig,
  fact: MemoryFact,
): Promise<void> {
  if (!config.enabled) return;
  await appendFactToMarkdown(cwd, fact);
}
