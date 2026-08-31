import { access, readFile, unlink } from "node:fs/promises";
import { legacyMemoryJsonPath, type MemoryConfig, type MemoryFact } from "../memory-types.js";
import { appendFactToMarkdown, memoryMdPath, resolveMemoryRoot } from "../store/markdown-store.js";

/**
 * One-shot legacy-JSON → markdown migration (ADR D8 of memory-system-peer-project-parity).
 *
 * Triggers when `.theokit/memory/<namespace>/<scope>-<userId>.json` exists AND
 * `.theokit/memory/MEMORY.md` does not. Reads the JSON facts, writes each
 * bullet to MEMORY.md, then deletes the JSON file. Idempotent.
 *
 * Iter 63 (Stage 3 source-move #20): hybrid copy from sdk-core's
 * `internal/memory/migration.ts`. sdk-core retains its copy for v1.x
 * legacy migration back-compat; sdk-memory ships the canonical copy.
 *
 * **Process-global migration flag map (`migrationRun`) is per-package.**
 * sdk-core's copy and sdk-memory's copy each maintain their own
 * `Set<string>` so the same key migrated through one package's copy
 * is NOT recorded in the other's. In v1.x active-memory-mode this
 * runs only via sdk-core; once sdk-core's runtime swaps to consume
 * sdk-memory's exports (later Stage 4), only sdk-memory's flag map
 * matters. Stage 3 source-move alone doesn't switch consumers.
 *
 * Dependency chain (sibling, all moved):
 * - `appendFactToMarkdown`, `memoryMdPath` → ./markdown-store.js (iter 56)
 * - `legacyMemoryJsonPath`, `MemoryConfig`, `MemoryFact` → ./memory-types.js (iter 52)
 *
 * @internal
 */

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readLegacyFacts(jsonPath: string): Promise<MemoryFact[] | undefined> {
  try {
    const raw = await readFile(jsonPath, "utf8");
    const parsed = JSON.parse(raw) as { facts?: MemoryFact[] };
    return Array.isArray(parsed.facts) ? parsed.facts : [];
  } catch {
    return undefined;
  }
}

async function writeMigratedFacts(
  cwd: string,
  jsonPath: string,
  facts: MemoryFact[],
): Promise<MigrationResult> {
  try {
    for (const fact of facts) await appendFactToMarkdown(cwd, fact);
    await unlink(jsonPath).catch(() => undefined);
    process.stderr.write(
      `[theokit-sdk] migrated ${facts.length} fact(s) from ${jsonPath} to MEMORY.md\n`,
    );
    return { migrated: true, factCount: facts.length };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`[theokit-sdk] memory migration failed (readonly fs?): ${message}\n`);
    return { migrated: false, factCount: 0, reason: "readonly-fs" };
  }
}

const migrationRun = new Set<string>();

/**
 * Outcome of {@link migrateLegacyJson}. `reason` is present on every non-migrated
 * result and says which guard stopped it: `already-migrated` (this key was
 * attempted earlier in this process), `no-legacy-json` (nothing to migrate, or
 * the file could not be read or parsed), `markdown-exists` (both files present,
 * so neither was touched), `readonly-fs` (the write failed).
 */
export interface MigrationResult {
  migrated: boolean;
  factCount: number;
  reason?: "already-migrated" | "no-legacy-json" | "markdown-exists" | "readonly-fs";
}

/**
 * Move facts from the pre-markdown JSON store into `MEMORY.md`, once.
 *
 * It runs only when the legacy file exists and `MEMORY.md` does not. When both
 * exist it stops and leaves both alone — merging would need a conflict rule
 * nobody has picked, and losing hand-written notes is worse than skipping. On
 * success each fact is appended as a `## Facts` bullet and the JSON file is
 * deleted.
 *
 * Guarded by a per-process set keyed on cwd, namespace, scope and user id, so
 * the second call for the same key returns `already-migrated` without touching
 * disk — including after a genuine failure. That set is per module instance, so
 * a process that loads both this package's copy and the one inside
 * `@theokit/sdk` has two independent sets.
 *
 * Never throws: a JSON file that cannot be read or parsed reports
 * `no-legacy-json`, and a failed write reports `readonly-fs` after a warning on
 * stderr.
 */
export async function migrateLegacyJson(
  cwd: string,
  config: MemoryConfig,
): Promise<MigrationResult> {
  const key = `${cwd}::${config.namespace ?? "default"}::${config.scope ?? "agent"}::${config.userId ?? "default"}`;
  if (migrationRun.has(key)) return { migrated: false, factCount: 0, reason: "already-migrated" };
  migrationRun.add(key);

  const jsonPath = legacyMemoryJsonPath(cwd, config);
  if (!(await fileExists(jsonPath))) {
    return { migrated: false, factCount: 0, reason: "no-legacy-json" };
  }
  if (await fileExists(memoryMdPath(resolveMemoryRoot(cwd)))) {
    process.stderr.write(
      `[theokit-sdk] memory migration skipped: both MEMORY.md and legacy JSON exist at ${jsonPath}; leaving both intact\n`,
    );
    return { migrated: false, factCount: 0, reason: "markdown-exists" };
  }

  const facts = await readLegacyFacts(jsonPath);
  if (facts === undefined) return { migrated: false, factCount: 0, reason: "no-legacy-json" };
  return writeMigratedFacts(cwd, jsonPath, facts);
}

/** Test-only — reset the in-process migration flag map. */
export function resetMigrationStateForTests(): void {
  migrationRun.clear();
}
