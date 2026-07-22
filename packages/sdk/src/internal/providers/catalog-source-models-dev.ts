import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { Retry } from "../../retry.js";
import { getCatalogModelInfo, patchModelInfo } from "./catalog-loader.js";
import { catalogModelSchema } from "./catalog-schema.js";
import { getProviderProfile } from "./registry.js";

/**
 * M44 — the OPTIONAL models.dev catalog source. Explicit opt-in ONLY (`refreshModelCatalog()`): the SDK
 * NEVER fetches at startup or per-request — the vendored catalog + any existing disk cache are the offline
 * base, and every failure mode fails CLOSED back to them (ROADMAP constraint: no runtime hard network dep).
 *
 * Mechanism adapted from OpenCode's models.dev consumption (MIT © 2025 opencode — `core/src/models-dev.ts`):
 * disk cache with mtime TTL, atomic tempfile+rename write, corrupt-cache delete-and-fall-through, kill-switch
 * env. Library adaptations: NO background refresh loop (a consumer composes refresh with the SDK's cron);
 * TTL 1h (not 5min — no background refresher to keep it warm); no cross-process flock v1 (atomic rename +
 * idempotent upstream content — at most one wasted fetch).
 *
 * @internal (the public surface is `refreshModelCatalog` re-exported via `@theokit/sdk/models`)
 */

const DEFAULT_URL = "https://models.dev/api.json";
const TTL_MS = 60 * 60 * 1000; // 1 hour
const FETCH_TIMEOUT_MS = 10_000;

export interface RefreshModelCatalogOptions {
  /** Override the source URL (`THEOKIT_MODELS_URL` env also honored). */
  url?: string;
  /** Bypass the TTL freshness gate. */
  force?: boolean;
  /** Injected for tests. */
  deps?: { fetch?: typeof fetch; now?: () => number };
}

export interface RefreshModelCatalogResult {
  /** Where the data came from: a fresh network fetch, the still-fresh disk cache, or skipped entirely. */
  source: "network" | "cache" | "skipped";
  /** How many models were patched into the index. */
  models: number;
}

/** The cache file for a source URL (custom URLs get a hash-suffixed name, mirroring OpenCode). */
export function cachePathFor(url: string): string {
  const dir = join(homedir(), ".theokit", "cache", "models-dev");
  if (url === DEFAULT_URL) return join(dir, "api.json");
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 12);
  return join(dir, `api-${hash}.json`);
}

/** Atomic write: temp file + rename (crash mid-write never leaves a partial cache). */
function writeCacheAtomic(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${randomBytes(6).toString("hex")}`;
  try {
    writeFileSync(tmp, body);
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // best effort
    }
    throw err;
  }
}

/** Parse + patch the index from an api.json payload. Unknown providers are skipped with WARN. */
function patchIndexFromApiJson(raw: unknown): number {
  if (typeof raw !== "object" || raw === null) return 0;
  let patched = 0;
  for (const [providerId, provider] of Object.entries(raw as Record<string, unknown>)) {
    const models = (provider as { models?: Record<string, unknown> })?.models;
    if (models === undefined || typeof models !== "object") continue;
    // Enrich ONLY providers the SDK knows (id or alias) — models.dev's npm/api fields cannot be mapped to a
    // theokit apiMode/authType safely, so unknown providers are data we cannot route (skip with WARN).
    const profile = getProviderProfile(providerId);
    if (profile === undefined) continue;
    for (const [modelId, rawModel] of Object.entries(models)) {
      const parsed = catalogModelSchema.safeParse(rawModel);
      if (!parsed.success) continue; // malformed model — drop silently (live data, additive drift expected)
      patchModelInfo(`${profile.name}/${modelId}`, parsed.data);
      patched++;
    }
  }
  return patched;
}

/**
 * Load an existing disk cache into the index (called by refresh when fresh, or opportunistically by a
 * consumer at startup — NEVER fetches). Corrupt cache → delete + fall through to vendored data.
 */
export function loadCacheIntoIndex(url: string = DEFAULT_URL): number {
  const path = cachePathFor(url);
  let body: string;
  try {
    body = readFileSync(path, "utf-8");
  } catch {
    return 0; // no cache — vendored data only
  }
  try {
    return patchIndexFromApiJson(JSON.parse(body));
  } catch {
    // corrupt cache: delete and fall through to the vendored catalog (OpenCode's delete-and-fall-through)
    try {
      unlinkSync(path);
    } catch {
      // best effort
    }
    process.stderr.write(`[theokit-sdk] WARN: corrupt models-dev cache deleted (${path})\n`);
    return 0;
  }
}

/**
 * Explicitly refresh the model catalog from models.dev (the ONLY network trigger in the subsystem).
 * Fail-closed: any failure keeps serving the current index (cache or vendored). Kill-switch:
 * `THEOKIT_DISABLE_MODELS_FETCH`.
 */
export async function refreshModelCatalog(
  opts: RefreshModelCatalogOptions = {},
): Promise<RefreshModelCatalogResult> {
  if (process.env.THEOKIT_DISABLE_MODELS_FETCH !== undefined) {
    return { source: "skipped", models: 0 };
  }
  const url = opts.url ?? process.env.THEOKIT_MODELS_URL ?? DEFAULT_URL;
  const path = cachePathFor(url);
  const now = opts.deps?.now ?? (() => Date.now());

  // TTL gate: a fresh cache serves without network (mtime freshness, OpenCode's gate).
  if (opts.force !== true) {
    try {
      const age = now() - statSync(path).mtimeMs;
      if (age < TTL_MS) {
        return { source: "cache", models: loadCacheIntoIndex(url) };
      }
    } catch {
      // no cache — proceed to fetch
    }
  }

  const fetchImpl = opts.deps?.fetch ?? fetch;
  let body: string;
  try {
    const res = await Retry.create(
      async () => {
        const r = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r;
      },
      // 2 transient retries with backoff (OpenCode does the same); every error here is worth one more try —
      // the whole call is already fail-closed at the caller.
      { retries: 2, isRetryable: () => true, initialDelayMs: 200 },
    );
    body = await res.text();
    JSON.parse(body); // validate before persisting — never cache garbage
  } catch (err) {
    process.stderr.write(
      `[theokit-sdk] WARN: models-dev refresh failed (${(err as Error).message}) — serving existing data\n`,
    );
    // fail-closed: serve whatever we already have (stale cache if present, else vendored)
    return { source: "cache", models: loadCacheIntoIndex(url) };
  }

  try {
    writeCacheAtomic(path, body);
  } catch (err) {
    process.stderr.write(
      `[theokit-sdk] WARN: models-dev cache write failed (${(err as Error).message})\n`,
    );
  }
  return { source: "network", models: patchIndexFromApiJson(JSON.parse(body)) };
}

/** The enriched per-model view (public via `@theokit/sdk/models`): index lookup by (possibly prefixed) id. */
export function getModelInfo(modelId: string): ReturnType<typeof getCatalogModelInfo> {
  return getCatalogModelInfo(modelId);
}
