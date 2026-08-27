import { mkdir, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { ConfigurationError } from "../../../errors.js";
import { replaceFileAtomic } from "../../persistence/atomic-write.js";
import { withCwdMutex } from "../../persistence/cwd-mutex.js";
import { encodeProjectDir } from "../../persistence/session-transcript.js";
import { MEMORY_KINDS, type MemoryConfig, type MemoryFact, redactSecrets } from "../types.js";
import { parseMemoryFile, renderMemoryFile, slugForFact } from "./memory-file.js";
import { scanForThreats } from "./threat-scan.js";

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

/**
 * The memory root for a workspace: `<cwd>/.theokit/memory`. Every other path here derives from it,
 * and `memory_get` refuses to read outside it. Pure path computation — nothing is created on disk.
 */
export function memoryDir(cwd: string): string {
  return join(cwd, ".theokit", "memory");
}

/**
 * Where a NEW fact should be written.
 *
 * `.theokit/memory` by default, exactly as before. When the agent was given a `local.sessionDir`,
 * it becomes `<sessionDir>/projects/<encoded-cwd>/memory` — the same place the transcript for that
 * project goes, so a session and the memories recorded during it land beside each other.
 *
 * `local.sessionDir` is the switch because it is already the option this project documents for CLI
 * interop: point it at `~/.claude` and the CLI can `--continue` a session this agent wrote. Someone
 * who set it has said they share state with that CLI, and memory following is what the sentence
 * already implied. It needs no new option, and nothing moves for anyone who never set it.
 *
 * Safe because of the rule this pairs with — WRITE ONE, READ ALL. {@link readFactsFromMarkdown}
 * covers every location, so a consumer whose new facts move keeps every fact they already had. The
 * change relocates where the next one lands; it orphans nothing.
 */
export function memoryWriteDir(cwd: string, sessionDir: string | undefined): string {
  if (sessionDir === undefined || sessionDir.trim().length === 0) return memoryDir(cwd);
  return join(sessionDir, "projects", encodeProjectDir(cwd), "memory");
}

/**
 * Where the Claude Code CLI keeps THIS project's memories.
 *
 * `<claudeHome>/projects/<encoded-cwd>/memory` — the same `encodeProjectDir` scheme the transcripts
 * already use, which is why no new encoding is invented here. `CLAUDE_CONFIG_DIR` names the home
 * when set (the CLI's own variable); `~/.claude` otherwise.
 *
 * Read, never written. Writing here by default would relocate every existing consumer's memories,
 * and an additive change must not move what is already on disk — so this is the direction that
 * costs nothing: a memory the CLI wrote becomes visible, and a memory the SDK wrote stays where the
 * SDK put it.
 */
export function claudeProjectMemoryDir(cwd: string): string {
  const home = process.env.CLAUDE_CONFIG_DIR?.trim();
  const root = home !== undefined && home.length > 0 ? home : join(homedir(), ".claude");
  return join(root, "projects", encodeProjectDir(cwd), "memory");
}

/**
 * Path to `MEMORY.md`, the index that points at the per-memory files — and, in stores written before
 * #389, the flat `## Facts` list itself. Pure path computation; the file may not exist.
 */
export function memoryMdPath(cwd: string): string {
  return join(memoryDir(cwd), "MEMORY.md");
}

/**
 * Path to `<memory root>/notes`, where per-topic notes and the consolidated notes a dreaming sweep
 * writes live. Pure path computation — the directory may not exist.
 */
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
export async function readFactsFromMarkdown(
  cwd: string,
  sessionDir?: string,
): Promise<MemoryFact[]> {
  const facts: MemoryFact[] = [];
  // Both stores: this SDK's, then the one the Claude Code CLI keeps for the same project. The
  // format has been shared since #389; only the directory was not, so a memory the CLI recorded was
  // invisible to an agent working in the same repository.
  // READ ALL: the project store, the location a configured `sessionDir` writes to, and the one the
  // CLI uses by default. Deduplicated, because with `sessionDir` pointed at the CLI's own home the
  // last two are the same directory and a fact would otherwise be recalled twice.
  const roots = [
    ...new Set([memoryDir(cwd), memoryWriteDir(cwd, sessionDir), claudeProjectMemoryDir(cwd)]),
  ];
  for (const dir of roots) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      const fact = await readMemoryFileIn(dir, entry);
      if (fact !== undefined) facts.push(fact);
    }
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
 *
 * The DIRECTORY is a parameter rather than derived from `cwd`, because both stores — this SDK's and
 * the one the Claude Code CLI keeps for the same project — read entries the same way, and a second
 * copy of this function is a second place for those three rules to drift.
 */
async function readMemoryFileIn(dir: string, entry: string): Promise<MemoryFact | undefined> {
  if (!entry.endsWith(".md") || entry === "MEMORY.md") return undefined;
  let raw: string;
  try {
    raw = await readFile(join(dir, entry), "utf8");
  } catch {
    return undefined; // vanished between readdir and read
  }
  const parsed = parseMemoryFile(raw);
  if (parsed === undefined) return undefined;
  // The BODY is the memory; `description` is the one-line recall aid. This SDK writes both the same,
  // so nothing it wrote changes — but the Claude Code CLI writes a summary in `description` and the
  // substance below it, and reading only the summary silently dropped the fact itself.
  const body = parsed.body.trim();
  return {
    text: body.length > 0 ? body : parsed.description,
    ...(parsed.kind !== undefined ? { kind: parsed.kind } : {}),
    ...(parsed.modified !== undefined ? { modified: parsed.modified } : {}),
    ...(parsed.observations !== undefined ? { observations: parsed.observations } : {}),
  };
}

/**
 * Write a fact as its own memory file and point the `MEMORY.md` index at it. Atomic + serialized.
 *
 * `modified` is stamped HERE and never read from `fact`: a timestamp a caller can set is a
 * timestamp that can lie about when something was learned, and weighing recency is the point.
 */
export function appendFactToMarkdown(
  cwd: string,
  fact: MemoryFact,
  targetDir: string = memoryDir(cwd),
): Promise<void> {
  return withCwdMutex(targetDir, async () => {
    // Validate at the boundary (`error-handling.md` § 2): a kind outside the four would be written
    // to a file recall later trusts, so it is refused here rather than stored and believed.
    if (fact.kind !== undefined && !MEMORY_KINDS.includes(fact.kind)) {
      throw new ConfigurationError(
        `Unknown memory fact kind "${fact.kind}". Expected one of: ${MEMORY_KINDS.join(", ")}.`,
        { code: "invalid_memory_kind" },
      );
    }
    const text = redactSecrets(fact.text);
    // Scan AFTER redaction and BEFORE persistence (SOP-06-05 step 1). After, so a redacted
    // secret cannot look like an encoded payload; before, because an entry that reaches disk is
    // recalled in every session afterwards.
    //
    // What this closes, stated so nobody cites it for more: the MALFORMED-ENTRY class,
    // completely — injection framing, role reassignment, invisible characters, encoded blobs.
    // It closes NONE of the class that was actually measured end to end. Both planted entries
    // from that run pass this scanner, the executive one included, and `threat-scan.ts` pins
    // that in tests rather than in a comment. Execution is answered at the tool boundary by the
    // permission engine; this is not a second line of defence for it.
    const threat = scanForThreats(text);
    if (threat !== undefined) {
      throw new ConfigurationError(
        `Refusing to write a memory entry that ${threat.why}: ${threat.excerpt}`,
        { code: "memory_threat_rejected" },
      );
    }
    const name = slugForFact(text);
    await mkdir(targetDir, { recursive: true });
    const observations = await nextObservationCount(targetDir, name, text);
    await replaceFileAtomic(
      join(targetDir, `${name}.md`),
      renderMemoryFile({
        name,
        description: text,
        ...(fact.kind !== undefined ? { kind: fact.kind } : {}),
        modified: new Date().toISOString(),
        observations,
        body: text,
      }),
    );
    // The index lives BESIDE the files it lists. A `MEMORY.md` in one directory pointing at
    // memories in another names files that are not there — and the CLI reads that index.
    await replaceFileAtomic(join(targetDir, "MEMORY.md"), await nextIndex(targetDir, text, name));
  });
}

/**
 * The corroboration count for the write about to happen.
 *
 * The rule that makes this a defence rather than a counter: **only the SAME text corroborates
 * itself.** Recording an identical fact a second time is a second observation; recording
 * different text under the same file is a REWRITE, and it starts again at one.
 *
 * That distinction is not decoration. `slugForFact` truncates at 64 characters, so two different
 * facts sharing a prefix land on the same filename — and a count that incremented on filename
 * alone would promote an entry to "corroborated" that nobody corroborated. A quarantine that can
 * be fooled by a rewrite is worse than no quarantine, because it hands confidence to exactly the
 * entry that has not earned it.
 *
 * Comparison is on normalized text (whitespace, case, trailing punctuation), so "X." recorded
 * after "x" counts as the same observation rather than as a new fact.
 */
// Returns 1 for a first write — and 1 is now recorded, because "counted once" and "unknown"
// are different claims and only the first one earns the [unconfirmed] marker.
async function nextObservationCount(dir: string, name: string, text: string): Promise<number> {
  let existing: string;
  try {
    existing = await readFile(join(dir, `${name}.md`), "utf8");
  } catch {
    return 1;
  }
  const parsed = parseMemoryFile(existing);
  if (parsed === undefined) return 1;
  const sameFact = normalizeFactText(parsed.body) === normalizeFactText(text);
  if (!sameFact) return 1;
  return (parsed.observations ?? 1) + 1;
}

/** Identity, not similarity — the same normalization the sweep uses for untyped entries. */
function normalizeFactText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "");
}

/**
 * The `MEMORY.md` index with `name` present exactly once.
 *
 * Rewriting the same memory replaces its line rather than adding a second: the index is a map from
 * memory to file, and two lines for one file is a map that disagrees with itself.
 */
async function nextIndex(dir: string, text: string, name: string): Promise<string> {
  let existing = "";
  try {
    // The index in the directory being WRITTEN, not the project one — see the caller.
    existing = await readFile(join(dir, "MEMORY.md"), "utf8");
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

/** A `MEMORY.md` index entry: a link whose target is a sibling `.md` file. */
const INDEX_ENTRY = /^\[[^\]]*\]\([^)]+\.md\)$/;

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

/**
 * Every memory in the store, honouring the `enabled` gate on {@link MemoryConfig}: when memory is
 * disabled the call resolves to `[]` without touching disk. Configuration-aware entry point;
 * {@link readFactsFromMarkdown} is the same read without the gate.
 */
export async function readFacts(
  cwd: string,
  config: MemoryConfig,
  memoryHome?: string,
): Promise<MemoryFact[]> {
  if (!config.enabled) return [];
  return readFactsFromMarkdown(cwd, memoryHome);
}

/**
 * Record a fact, honouring the `enabled` gate on {@link MemoryConfig}: when memory is disabled the
 * call resolves without touching disk. Configuration-aware entry point;
 * {@link appendFactToMarkdown} is the same write without the gate.
 *
 * `memoryHome` is the agent's `local.sessionDir` when it has one — see {@link memoryWriteDir} for
 * which store that sends the fact to.
 */
export async function appendFact(
  cwd: string,
  config: MemoryConfig,
  fact: MemoryFact,
  memoryHome?: string,
): Promise<void> {
  if (!config.enabled) return;
  await appendFactToMarkdown(cwd, fact, memoryWriteDir(cwd, memoryHome));
}
