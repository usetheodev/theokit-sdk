/**
 * One memory as a file, in the shape the Claude Code CLI reads.
 *
 * `@theokit/sdk` already writes native Claude Code `.jsonl` sessions — the README's differentiator
 * is "point `local.sessionDir` at `~/.claude` and the Claude Code CLI can `--continue` a session
 * your agent wrote". Memory had no such convergence: a fact was a bullet under `## Facts` with its
 * kind in an HTML comment (#389), which that CLI reads as prose. Pointing a memory directory at
 * `~/.claude/projects/<project>/memory/` produced nothing it could open.
 *
 * The contract here was measured against a real store rather than inferred from documentation. Of
 * nine files, all nine carry `name`, `description` and `metadata.type`; six also carry
 * `node_type`, `originSessionId` and `modified`, which the runtime stamps on write. So the minimum
 * a reader must accept is the first three — refusing the rest would refuse memories the CLI itself
 * accepts.
 *
 * `originSessionId` is deliberately not written. It identifies the session that learned the fact,
 * and the append path has no session in scope; inventing one would be worse than omitting a field
 * the format already treats as optional.
 *
 * @internal
 */

import { parseSimpleYaml, splitFrontmatter } from "../../runtime/context/context-yaml-lite.js";
import { safeFilenameForId } from "../../security/path-guard.js";
import { MEMORY_KINDS, type MemoryKind } from "../types.js";

/** The fields one memory file carries. */
export interface MemoryFileFields {
  /** Slug, and the file's basename. */
  readonly name: string;
  /** One-line summary — what the index shows and what recall ranks. */
  readonly description: string;
  /** `metadata.type`, absent when the file does not declare one this contract admits. */
  readonly kind?: MemoryKind;
  /** `metadata.modified`, an ISO 8601 instant stamped by whoever wrote the file. */
  readonly modified?: string;
  /**
   * How many times this exact text has been recorded — the corroboration count SOP-06-01 needs.
   *
   * One observation may be a coincidence, a mistake, or a plant. Requiring a second INDEPENDENT
   * observation before an entry is treated as established is the cheapest defence against memory
   * poisoning that exists, and a live run showed its absence is not theoretical: a single planted
   * fact made the agent assert that the team's deploy convention was `--skip-tests`.
   *
   * Absent means one, so every file written before this field existed reads as uncorroborated
   * rather than as trusted — the safe direction for a field that gates confidence.
   */
  readonly observations?: number;
  /** The markdown after the frontmatter. */
  readonly body: string;
}

/** The safe filename grammar a slug must satisfy before it is used as one. */
const SAFE_SLUG = /^[a-z0-9][a-z0-9_-]*$/;
/** Long enough to stay readable, short enough to survive every filesystem's component limit. */
const MAX_SLUG_LENGTH = 64;

/**
 * A readable, filesystem-safe slug for `text`.
 *
 * Readability is the goal — a directory of `h-3f2a…` files is a directory nobody browses — but it
 * is not the floor. The text comes from whatever a caller learned, so anything that fails the safe
 * grammar falls back to {@link safeFilenameForId}, which is total and always yields a valid
 * component.
 */
export function slugForFact(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "");
  return SAFE_SLUG.test(slug) ? slug : safeFilenameForId(text);
}

/**
 * The optional metadata a memory file carries, with every value this contract does not admit
 * dropped rather than passed through.
 *
 * Extracted from `parseMemoryFile` rather than inlined: that function decides what counts as a
 * memory, which makes it a trust boundary, and this repo caps cognitive complexity at 10 for
 * exactly that kind of code. Three inline validations pushed it to 13.
 *
 * Everything here fails toward absence. An unknown `type` reads as untyped rather than as a fifth
 * kind; a non-integer count reads as uncorroborated. The file is hand-editable, so a value that
 * does not fit the contract must not be believed just because it is present.
 */
function readMetadata(raw: unknown): Pick<MemoryFileFields, "kind" | "modified" | "observations"> {
  const metadata = (raw ?? {}) as Record<string, unknown>;
  const rawKind = metadata.type;
  const kind =
    typeof rawKind === "string" && MEMORY_KINDS.includes(rawKind as MemoryKind)
      ? (rawKind as MemoryKind)
      : undefined;
  const modified = typeof metadata.modified === "string" ? metadata.modified : undefined;
  const observations = readObservationCount(metadata.observations);
  return {
    ...(kind !== undefined ? { kind } : {}),
    ...(modified !== undefined ? { modified } : {}),
    ...(observations !== undefined ? { observations } : {}),
  };
}

/**
 * The corroboration count a file claims, or `undefined` when it claims none this contract admits.
 *
 * Extracted rather than inlined: `parseMemoryFile` decides what counts as a memory, which makes it
 * a trust boundary, and this repo caps cognitive complexity at 10 for exactly that kind of code.
 * Inlining the validation pushed it to 13.
 *
 * Anything that is not a positive integer reads as absent — i.e. as a single, uncorroborated
 * observation. The file is hand-editable, so trusting an arbitrary value here would let a file
 * claim corroboration nobody gave it, which is the failure quarantine exists to prevent.
 */
function readObservationCount(raw: unknown): number | undefined {
  if (typeof raw !== "number") return undefined;
  if (!Number.isInteger(raw) || raw <= 0) return undefined;
  return raw;
}

/** Render one memory file. `description` is quoted so a colon in the text cannot break the block. */
export function renderMemoryFile(fields: MemoryFileFields): string {
  const metadata = ["  node_type: memory"];
  if (fields.kind !== undefined) metadata.push(`  type: ${fields.kind}`);
  if (fields.modified !== undefined) metadata.push(`  modified: ${fields.modified}`);
  // Written even when it is 1. Absent and 1 are DIFFERENT states: absent means the store does
  // not know how many times this was seen (written before this field existed, or by hand), 1
  // means the store counted and the answer is one. Collapsing them would erase the distinction
  // the marker depends on.
  if (fields.observations !== undefined) {
    metadata.push(`  observations: ${fields.observations}`);
  }
  return [
    "---",
    `name: ${fields.name}`,
    `description: ${JSON.stringify(fields.description)}`,
    "metadata:",
    ...metadata,
    "---",
    "",
    fields.body,
    "",
  ].join("\n");
}

/**
 * Read one memory file, or `undefined` when the content is not one.
 *
 * `undefined` rather than a throw, and rather than a best-effort object: the directory holds
 * hand-written notes and a `MEMORY.md` index alongside the memories, and turning any of those into
 * a fact would put text into recall that nobody recorded as one.
 */
export function parseMemoryFile(raw: string): MemoryFileFields | undefined {
  const { yaml, body } = splitFrontmatter(raw);
  if (yaml === undefined) return undefined;

  let fields: Record<string, unknown>;
  try {
    fields = parseSimpleYaml(yaml);
  } catch {
    return undefined; // malformed frontmatter is not a memory
  }

  const name = fields.name;
  const description = fields.description;
  if (typeof name !== "string" || typeof description !== "string") return undefined;

  return {
    name,
    description,
    ...readMetadata(fields.metadata),
    body: body.trim(),
  };
}
