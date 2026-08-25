import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { ConfigurationError } from "../../../errors.js";
import { replaceFileAtomic } from "../../persistence/atomic-write.js";
import { withCwdMutex } from "../../persistence/cwd-mutex.js";
import { MEMORY_KINDS, type MemoryConfig, type MemoryFact, redactSecrets } from "../types.js";

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
    // Validate at the boundary (`error-handling.md` § 2): a kind outside the four would be written
    // to a file recall later trusts, so it is refused here rather than stored and believed.
    if (fact.kind !== undefined && !MEMORY_KINDS.includes(fact.kind)) {
      throw new ConfigurationError(
        `Unknown memory fact kind "${fact.kind}". Expected one of: ${MEMORY_KINDS.join(", ")}.`,
        { code: "invalid_memory_kind" },
      );
    }
    // `modified` is stamped HERE and never read from `fact` — see the field's docblock.
    const sanitized = redactSecrets(fact.text) + factMeta(fact, new Date());
    const next = insertFactBullet(raw, sanitized);
    await mkdir(memoryDir(cwd), { recursive: true });
    await replaceFileAtomic(path, next);
  });
}

/**
 * The metadata a typed fact carries at the END of its bullet (#389).
 *
 * An HTML comment, for three reasons. It is invisible in rendered markdown, so `## Facts` stays the
 * human-readable list its header promises. A hand-written bullet never produces one by accident, so
 * an untyped fact cannot be mistaken for a typed one. And if a human deletes it while editing, the
 * fact degrades to untyped — which is the correct direction to fail, since a kind is never inferred.
 *
 * Anchored to end-of-line: a bullet that merely MENTIONS a marker mid-sentence is the user's own
 * prose and survives verbatim.
 */
const FACT_META = /\s*<!--\s*theokit:fact\s+kind=([a-z]+)(?:\s+modified=(\S+))?\s*-->$/;

/** Render the trailing metadata for a typed fact; `""` when it has no kind. */
function factMeta(fact: MemoryFact, now: Date): string {
  if (fact.kind === undefined) return "";
  return `  <!-- theokit:fact kind=${fact.kind} modified=${now.toISOString()} -->`;
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
    .map((line) => parseFactBullet(line.slice(2).trim()));
}

/** Split a bullet's body into the fact's text and whatever metadata trails it. */
function parseFactBullet(body: string): MemoryFact {
  const match = FACT_META.exec(body);
  if (match === null) return { text: body };
  const kind = match[1] as MemoryFact["kind"];
  // An unknown kind on disk is treated as untyped rather than trusted: the file is hand-editable,
  // and recall must not act on a value outside the four.
  if (kind === undefined || !MEMORY_KINDS.includes(kind))
    return { text: body.slice(0, match.index) };
  return {
    text: body.slice(0, match.index),
    kind,
    ...(match[2] !== undefined ? { modified: match[2] } : {}),
  };
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

export async function appendFact(
  cwd: string,
  config: MemoryConfig,
  fact: MemoryFact,
): Promise<void> {
  if (!config.enabled) return;
  await appendFactToMarkdown(cwd, fact);
}
