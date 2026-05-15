import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";

/**
 * Process- and workspace-level memory store. Persists durable facts under
 * `.theokit/memory/<namespace>/<scope>-<userId>.json`. Secret values are
 * stripped before persistence (token-shaped strings are dropped).
 *
 * @internal
 */

export interface MemoryConfig {
  enabled: boolean;
  namespace?: string;
  userId?: string;
  scope?: "agent" | "user" | "team";
  storePath?: string;
}

export interface MemoryFact {
  text: string;
}

const SECRET_PATTERN = /\b(?:sk-proj-[A-Za-z0-9-]+|ghp_[A-Za-z0-9-]+|sk-[A-Za-z0-9-]+)\b/g;

function memoryFilePath(cwd: string, config: MemoryConfig): string {
  const namespace = config.namespace ?? "default";
  const scope = config.scope ?? "agent";
  const userId = config.userId ?? "default";
  const relativePath =
    config.storePath ?? join(".theokit", "memory", namespace, `${scope}-${userId}.json`);
  return resolvePath(cwd, relativePath);
}

export async function readMemoryFacts(
  cwd: string,
  config: MemoryConfig,
): Promise<MemoryFact[]> {
  if (!config.enabled) return [];
  const file = memoryFilePath(cwd, config);
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as { facts?: MemoryFact[] };
    return Array.isArray(parsed.facts) ? parsed.facts : [];
  } catch {
    return [];
  }
}

export async function appendMemoryFact(
  cwd: string,
  config: MemoryConfig,
  fact: MemoryFact,
): Promise<void> {
  if (!config.enabled) return;
  const file = memoryFilePath(cwd, config);
  await mkdir(dirname(file), { recursive: true });
  const existing = await readMemoryFacts(cwd, config);
  const sanitized: MemoryFact = { text: redactSecrets(fact.text) };
  existing.push(sanitized);
  await writeFile(file, JSON.stringify({ facts: existing }, null, 2), "utf8");
}

export function redactSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, "***");
}
