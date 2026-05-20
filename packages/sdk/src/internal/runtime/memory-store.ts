import { appendFact as appendFactMd, readFacts as readFactsMd } from "../memory/markdown-store.js";
import { migrateLegacyJson } from "../memory/migration.js";
import {
  legacyMemoryJsonPath,
  type MemoryConfig,
  type MemoryFact,
  redactSecrets,
} from "../memory/types.js";

/**
 * Workspace-level memory store. Storage migrated from JSON-array to
 * markdown-first per memory-system-openclaw-parity-plan ADR D1: facts live in
 * `.theokit/memory/MEMORY.md` under a `## Facts` section. On first read the
 * legacy JSON file is migrated and deleted (ADR D8).
 *
 * Public surface (`readMemoryFacts` + `appendMemoryFact`) is unchanged.
 *
 * @internal
 */

export type { MemoryConfig, MemoryFact };
export { redactSecrets };

const REMEMBER_PATTERN = /^\s*Remember(?:\s+this\s+durable\s+preference)?\s*:\s*(.+)$/i;

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
  if (match === null || match[1] === undefined) return "";
  return match[1].trim().replace(/\.$/, "");
}

/** @internal — kept for migration helpers + tests. */
export function memoryFilePath(cwd: string, config: MemoryConfig): string {
  return legacyMemoryJsonPath(cwd, config);
}

export async function readMemoryFacts(cwd: string, config: MemoryConfig): Promise<MemoryFact[]> {
  if (!config.enabled) return [];
  await migrateLegacyJson(cwd, config);
  return readFactsMd(cwd, config);
}

export async function appendMemoryFact(
  cwd: string,
  config: MemoryConfig,
  fact: MemoryFact,
): Promise<void> {
  if (!config.enabled) return;
  await migrateLegacyJson(cwd, config);
  const sanitized: MemoryFact = { text: redactSecrets(fact.text) };
  await appendFactMd(cwd, config, sanitized);
}
