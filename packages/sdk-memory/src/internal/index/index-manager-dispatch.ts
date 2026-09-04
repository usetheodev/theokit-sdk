/**
 * Dispatch helpers for `IndexManager.open`. Extracted to keep
 * `index-manager.ts` under the G8 400-LoC budget (lancedb-backend-ship-v1-1).
 *
 * Iter 70 (Stage 3 source-move #27): hybrid copy from sdk-core's
 * `internal/memory/index-manager-dispatch.ts`. sdk-core retains
 * its copy for v1.x back-compat; sdk-memory ships the canonical
 * copy that the future `index-manager.ts` move will compose with
 * as a sibling. Dependency chain (all sibling, all moved):
 * - `@theokit/sdk/errors` for `ConfigurationError` (public)
 * - `./index-manager-contract.js` for `MemoryBackend` +
 *   `OpenIndexOptions` (moved iter 47)
 * - `./lance-index.js` for `LanceIndex` (moved iter 68)
 * - `./lance-memory-adapter.js` for `LanceMemoryAdapter` (moved iter 69)
 * - `./memory-index.js` for `MemoryIndex` (moved iter 50)
 *
 * @internal
 */

import { ConfigurationError } from "@theokit/sdk/errors";
import type { MemoryBackend, OpenIndexOptions } from "./index-manager-contract.js";
import { LanceIndex } from "./lance-index.js";
import { LanceMemoryAdapter } from "./lance-memory-adapter.js";
import type { MemoryIndex } from "./memory-index.js";

/** Valid backend identifiers — runtime guard against TS-narrowing escapes (EC-1). */
export const VALID_BACKENDS: readonly MemoryBackend[] = ["sqlite-vec", "lance"];

/**
 * EC-1: runtime guard for `opts.backend`. TS union is compile-time only;
 * consumers passing JS `as any` typos must hit a typed error, not silent
 * SQLite fallback.
 */
export function assertValidBackend(backend: string): asserts backend is MemoryBackend {
  if (!VALID_BACKENDS.includes(backend as MemoryBackend)) {
    throw new ConfigurationError(
      `Invalid memory backend "${backend}". Valid values: ${VALID_BACKENDS.join(", ")}.`,
      { code: "invalid_memory_backend" },
    );
  }
}

/**
 * Lance-path open. Throws `lance_requires_embedding` when no embedding
 * runtime is provided (Lance is vector-only — no FTS fallback).
 * Surfaces `lance_backend_unavailable` from LanceIndex.open when peer
 * dep is absent.
 */
export async function openLanceIndex(opts: OpenIndexOptions): Promise<MemoryIndex> {
  if (opts.embedding === undefined) {
    throw new ConfigurationError(
      "Lance backend requires an embedding runtime. Pass `embedding: { provider, model, apiKey }` in Memory.create options (or omit `backend` to use SQLite default).",
      { code: "lance_requires_embedding" },
    );
  }
  const lance = await LanceIndex.open({
    cwd: opts.cwd,
    embedding: opts.embedding,
    ...(opts.filePath !== undefined ? { storagePath: opts.filePath } : {}),
  });
  return new LanceMemoryAdapter(lance);
}
