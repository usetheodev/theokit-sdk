/**
 * Persistence for the credential-pool subsystem (ADRs D123, D129).
 *
 * Storage layout (`$THEOKIT_HOME/credential-pool.json`):
 *
 * ```json
 * {
 *   "_schemaVersion": 1,
 *   "data": {
 *     "pools": {
 *       "openrouter": {
 *         "provider": "openrouter",
 *         "strategy": "round_robin",
 *         "entries": [ { "id": "...", "label": "...", ... } ]
 *       }
 *     }
 *   }
 * }
 * ```
 *
 * Load is lazy (D129) — callers invoke `loadCredentialPoolStore` on the
 * first `Agent.create()` that registers `apiKeys`. Save is debounced at
 * the wrapper layer; this file exposes only the raw load/save primitive.
 *
 * Cross-process safety: writes acquire `withFileLock` (D61) on the
 * companion lockfile `credential-pool.json.lock`. Reads do not lock
 * because read-during-write at worst yields stale data; the next save
 * heals (EC-G is documented in this file's header).
 *
 * WHY IT LIVES IN internal/llm/ AND NOT internal/persistence/. One concept — the credential pool —
 * had no single home: `credential-pool.ts`, `credential-pool-types.ts` and `credential-pool-context.ts`
 * were here, and only the store was under persistence/. The store then had to import the concept's
 * types back across the folder boundary, which was the RETURN EDGE of the only folder-level mutual
 * dependency in this slice. The cycle was the symptom; the split home was the disease.
 *
 * It still consumes persistence primitives — `withFileLock`, `readVersionedJson`, `getTheokitHome` —
 * and that direction (llm -> persistence) is the correct one: a concept depends on the storage
 * mechanism, never the reverse.
 *
 * @internal
 */

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { diag } from "../diagnostics.js";
import { withFileLock } from "../persistence/file-lock.js";
import { getTheokitHome } from "../persistence/paths.js";
import { readVersionedJson, writeVersionedJson } from "../persistence/schema-version.js";
import type { CredentialPoolSnapshot } from "./credential-pool-types.js";

const SCHEMA_VERSION = 1;

interface PoolStoreData {
  pools: Record<string, CredentialPoolSnapshot>;
}

function poolPath(cwd: string): string {
  return join(getTheokitHome(cwd), "credential-pool.json");
}

/**
 * Load all pools for the given workspace. Returns an empty Map when:
 * - file missing (cold start)
 * - file corrupt (logs warn via `readVersionedJson`)
 *
 * @internal
 */
export async function loadCredentialPoolStore(
  cwd: string,
): Promise<Map<string, CredentialPoolSnapshot>> {
  const data = await readVersionedJson<PoolStoreData>({
    path: poolPath(cwd),
    currentVersion: SCHEMA_VERSION,
    migrate: () => ({ pools: {} }),
    defaultValue: () => ({ pools: {} }),
  });
  const result = new Map<string, CredentialPoolSnapshot>();
  for (const [provider, snapshot] of Object.entries(data.pools)) {
    if (snapshot !== undefined) result.set(provider, snapshot);
  }
  return result;
}

/**
 * Save all pools atomically. Acquires the companion file lock to
 * serialize concurrent processes (D61). Best-effort: if the lock
 * times out or the write fails, the caller (T3.1) catches and logs
 * via stderr per EC-A, continuing with in-memory state.
 *
 * @internal
 */
export async function saveCredentialPoolStore(
  cwd: string,
  pools: Map<string, CredentialPoolSnapshot>,
): Promise<void> {
  const path = poolPath(cwd);
  // Ensure parent dir exists — withFileLock fails if it can't create the
  // companion lockfile beside the data file (mkdir -p semantics).
  // T5.7 — mode 0o700 (owner-only) on the credential snapshot directory.
  // The default mkdir mode is 0o777 minus umask (typically 0o755 = world-
  // listable); credential snapshot directories must be owner-only so an
  // attacker enumerating the parent cannot even see the pool exists.
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const data: PoolStoreData = { pools: {} };
  for (const [provider, snapshot] of pools.entries()) {
    data.pools[provider] = snapshot;
  }
  await withFileLock(path, async () => {
    await writeVersionedJson(path, data, SCHEMA_VERSION);
  });
}

/**
 * Debounce wrapper that serializes save calls per-cwd and collapses
 * rapid mutations into one write (D129). Pending timer is `clearTimeout`'d
 * on every mutate; final save runs `delayMs` after the LAST mutation
 * (EC-E: only one setTimeout outstanding at a time).
 *
 * @internal
 */
export class DebouncedPoolSaver {
  private pending: ReturnType<typeof setTimeout> | undefined;
  private nextSave: Promise<void> = Promise.resolve();

  constructor(
    private readonly cwd: string,
    private readonly getSnapshots: () => Map<string, CredentialPoolSnapshot>,
    private readonly delayMs: number = 200,
  ) {}

  /** Schedule a save `delayMs` after the last call. */
  schedule(): void {
    if (this.pending !== undefined) {
      clearTimeout(this.pending);
    }
    this.pending = setTimeout(() => {
      this.pending = undefined;
      this.nextSave = saveCredentialPoolStore(this.cwd, this.getSnapshots()).catch((err) => {
        diag(
          `[theokit-sdk] credential-pool: debounced save failed: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
        );
      });
    }, this.delayMs);
  }

  /** Await the most recently scheduled save (used in tests + dispose paths). */
  async flush(): Promise<void> {
    if (this.pending !== undefined) {
      clearTimeout(this.pending);
      this.pending = undefined;
      this.nextSave = saveCredentialPoolStore(this.cwd, this.getSnapshots()).catch((err) => {
        diag(
          `[theokit-sdk] credential-pool: flush save failed: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
        );
      });
    }
    await this.nextSave;
  }
}
