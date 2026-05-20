/**
 * Check-fn TTL cache — Layer 3 of the 3-layer tool surface (T2.3, ADR D103).
 *
 * Caches `entry.checkFn()` results for 30s so tools with expensive probes
 * (HTTP, package import) don't burn latency every turn. `requiresEnv` is
 * NOT cached — env lookup is O(1).
 *
 * @internal
 */

import type { ToolEntry } from "./registry.js";

const TTL_MS = 30_000;

interface CacheEntry {
  result: boolean;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 3-layer check (requiresEnv loop / checkFn presence / cache hit/miss) inlined for clarity per ADR D103.
export async function isToolAvailable(entry: ToolEntry): Promise<boolean> {
  // requiresEnv: hard env var check, no cache (cheap).
  if (entry.requiresEnv !== undefined) {
    for (const v of entry.requiresEnv) {
      const val = process.env[v];
      if (val === undefined || val.length === 0) return false;
    }
  }

  if (entry.checkFn === undefined) return true;

  const cached = cache.get(entry.name);
  if (cached !== undefined && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  let result: boolean;
  try {
    result = await entry.checkFn();
  } catch {
    result = false;
  }
  cache.set(entry.name, { result, expiresAt: Date.now() + TTL_MS });
  return result;
}

export async function getAvailableTools(entries: ReadonlyArray<ToolEntry>): Promise<ToolEntry[]> {
  const checks = await Promise.all(
    entries.map(async (e) => ({ entry: e, ok: await isToolAvailable(e) })),
  );
  return checks.filter((x) => x.ok).map((x) => x.entry);
}

/** Test-only reset. @internal */
export function _resetCheckFnCache(): void {
  cache.clear();
}
