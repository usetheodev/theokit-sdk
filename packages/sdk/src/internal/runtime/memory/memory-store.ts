import { migrateLegacyJson } from "../../memory/migration.js";
import {
  appendFact as appendFactMd,
  readFacts as readFactsMd,
} from "../../memory/storage/markdown-store.js";
import {
  MEMORY_KINDS,
  type MemoryConfig,
  type MemoryFact,
  type MemoryKind,
  redactSecrets,
} from "../../memory/types.js";

/**
 * Workspace-level memory store. Storage migrated from JSON-array to
 * markdown-first per memory-system-peer-project-parity-plan ADR D1: facts live in
 * `.theokit/memory/MEMORY.md` under a `## Facts` section. On first read the
 * legacy JSON file is migrated and deleted (ADR D8).
 *
 * Public surface (`readMemoryFacts` + `appendMemoryFact`) is unchanged.
 *
 * @internal
 */

export type { MemoryConfig, MemoryFact };
export { redactSecrets };

const REMEMBER_PATTERN =
  /^\s*Remember(?:\s+this\s+durable\s+preference)?\s*(?:\((user|feedback|project|reference)\))?\s*:\s*(.+)$/i;

/**
 * Predicate: does the user message opt into memory persistence via the
 * `Remember:` prefix? Anchored at start-of-message; case-insensitive.
 *
 * Shared by the fixture runtime and the real LLM runtime so both paths
 * agree on which user messages persist a fact.
 *
 * @internal
 */
export function isMemoryWritePrompt(message: string): boolean {
  return REMEMBER_PATTERN.test(message) || message.includes("Remember this durable");
}

/**
 * Extract the fact text from a user message that matched
 * {@link isMemoryWritePrompt}. Strips the leading "Remember:" prefix and
 * a trailing period. Returns an empty string when the capture group is
 * empty — callers must check for that and skip the persistence call.
 *
 * @internal
 */
export function extractMemoryFact(message: string): string {
  const match = REMEMBER_PATTERN.exec(message);
  if (match === null || match[2] === undefined) return "";
  return match[2].trim().replace(/\.$/, "");
}

/**
 * The kind a `Remember:` prompt declared, if it declared one (#401).
 *
 * `Remember (feedback): prefer tabs` types the fact; a bare `Remember:` leaves it untyped, which is
 * the honest default — a kind nobody stated is a kind nobody knows, and guessing it would make the
 * store confident about the wrong thing.
 *
 * ONLY the four kinds the store accepts are recognised as a kind. Any other parenthetical is not a
 * mistyped kind to punish but ordinary prose, and it keeps the pre-existing behaviour of the prompt
 * unchanged rather than being reinterpreted here.
 *
 * @internal
 */
export function extractMemoryKind(message: string): MemoryKind | undefined {
  const match = REMEMBER_PATTERN.exec(message);
  const declared = match?.[1];
  if (declared === undefined) return undefined;
  const lowered = declared.toLowerCase() as MemoryKind;
  return MEMORY_KINDS.includes(lowered) ? lowered : undefined;
}

export async function readMemoryFacts(
  cwd: string,
  config: MemoryConfig,
  memoryHome?: string,
): Promise<MemoryFact[]> {
  if (!config.enabled) return [];
  await migrateLegacyJson(cwd, config);
  return readFactsMd(cwd, config, memoryHome);
}

export async function appendMemoryFact(
  cwd: string,
  config: MemoryConfig,
  fact: MemoryFact,
  memoryHome?: string,
): Promise<void> {
  if (!config.enabled) return;
  await migrateLegacyJson(cwd, config);
  // #401 — this used to be `{ text: ... }` only, so a kind never reached storage even when a caller
  // supplied one: the field round-tripped through the file format and was severed at the one
  // chokepoint every write passes through. `modified` is deliberately NOT carried over — the SDK
  // stamps it, because a timestamp the caller controls can lie about when something was learned.
  const sanitized: MemoryFact = {
    text: redactSecrets(fact.text),
    ...(fact.kind === undefined ? {} : { kind: fact.kind }),
  };
  await appendFactMd(cwd, config, sanitized, memoryHome);
}
