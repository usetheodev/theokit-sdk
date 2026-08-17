import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { Retry } from "../../retry.js";
import { diag } from "../diagnostics.js";
import { registerBuiltins } from "./builtin/index.js";
import { getCatalogModelInfo, loadProviderCatalog, patchModelInfo } from "./catalog-loader.js";
import { catalogModelSchema } from "./catalog-schema.js";
import { getProviderProfile } from "./registry.js";

/**
 * M44 — the OPTIONAL models.dev catalog source. Explicit opt-in ONLY (`refreshModelCatalog()`): the SDK
 * NEVER fetches at startup or per-request — the vendored catalog + any existing disk cache are the offline
 * base, and every failure mode fails CLOSED back to them (ROADMAP constraint: no runtime hard network dep).
 *
 * The models.dev consumption mechanism:
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

/** The cache file for a source URL (custom URLs get a hash-suffixed name). */
export function cachePathFor(url: string): string {
  // M44 L8 fix — honor the SDK home override so tests and multi-home setups never touch the real ~/.theokit.
  const base = process.env.THEOKIT_HOME?.trim() || join(homedir(), ".theokit");
  const dir = join(base, "cache", "models-dev");
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

/**
 * M44 H3 fix — models.dev provider ids ≠ theokit ids (google↔google-gemini, zai↔zhipu, togetherai↔together,
 * fireworks-ai↔fireworks, amazon-bedrock↔bedrock, google-vertex↔vertex). The RUNTIME mapping mirrors the
 * maintenance script's table; targets resolve against the CATALOG entries (id + aliases — the same namespace
 * the vendored index uses) first, then the registry.
 */
const MODELS_DEV_ID_MAP: Record<string, string> = {
  google: "google-gemini",
  zai: "zhipu",
  togetherai: "together",
  "fireworks-ai": "fireworks",
  "amazon-bedrock": "bedrock",
  "google-vertex": "vertex",
};

let _catalogTargets: Map<string, { keys: string[] }> | undefined;
/** external-id → the index keys (entry id + aliases) its models patch under. Lazy; catalog-first. */
function catalogTargets(): Map<string, { keys: string[] }> {
  if (_catalogTargets !== undefined) return _catalogTargets;
  _catalogTargets = new Map();
  try {
    for (const entry of Object.values(loadProviderCatalog())) {
      const keys = [entry.id, ...(entry.aliases ?? [])];
      for (const k of keys) {
        if (!_catalogTargets.has(k)) _catalogTargets.set(k, { keys });
      }
    }
  } catch {
    // catalog unavailable — registry fallback below still works
  }
  return _catalogTargets;
}

function resolvePatchKeys(externalId: string): string[] | undefined {
  const mapped = MODELS_DEV_ID_MAP[externalId] ?? externalId;
  const fromCatalog = catalogTargets().get(mapped);
  if (fromCatalog !== undefined) return fromCatalog.keys;
  const profile = getProviderProfile(mapped);
  if (profile !== undefined) return [profile.name, ...(profile.aliases ?? [])];
  return undefined;
}

/** Parse + patch the index from an api.json payload. Unknown providers are skipped with WARN (once each). */
// PRE-EXISTING debt, exposed when M75 fixed the Biome config that used to abort before
// sweeping these files (a nested root under refactor/). It is not new code and was not touched
// by M75; refactoring SDK internals without review would trade a visible problem for a diff
// risky. Tracked in usetheodev/theokit-sdk#151.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: see the reason just above
function patchIndexFromApiJson(raw: unknown): number {
  if (typeof raw !== "object" || raw === null) return 0;
  let patched = 0;
  const skipped: string[] = [];
  for (const [providerId, provider] of Object.entries(raw as Record<string, unknown>)) {
    const models = (provider as { models?: Record<string, unknown> })?.models;
    if (models === undefined || typeof models !== "object") continue;
    // Enrich ONLY providers the SDK knows — models.dev's npm/api fields cannot be mapped to a theokit
    // apiMode/authType safely, so unknown providers are data we cannot route.
    const keys = resolvePatchKeys(providerId);
    if (keys === undefined) {
      skipped.push(providerId);
      continue;
    }
    for (const [modelId, rawModel] of Object.entries(models)) {
      const parsed = catalogModelSchema.safeParse(rawModel);
      if (!parsed.success) continue; // malformed model — drop silently (live data, additive drift expected)
      for (const key of keys) patchModelInfo(`${key}/${modelId}`, parsed.data);
      patched++;
    }
  }
  if (skipped.length > 0) {
    diag(
      `[theokit-sdk] WARN: models-dev refresh skipped ${skipped.length} unknown provider(s) (e.g. ${skipped.slice(0, 3).join(", ")})\n`,
    );
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // corrupt cache: delete and fall through to the vendored catalog.
    // M44 L9 fix — only a PARSE failure is cache corruption; a patch error must never delete a valid cache.
    try {
      unlinkSync(path);
    } catch {
      // best effort
    }
    diag(`[theokit-sdk] WARN: corrupt models-dev cache deleted (${path})\n`);
    return 0;
  }
  try {
    return patchIndexFromApiJson(parsed);
  } catch (err) {
    diag(`[theokit-sdk] WARN: models-dev cache patch failed (${(err as Error).message})\n`);
    return 0;
  }
}

/**
 * Explicitly refresh the model catalog from models.dev (the ONLY network trigger in the subsystem).
 * Fail-closed: any failure keeps serving the current index (cache or vendored). Kill-switch:
 * `THEOKIT_DISABLE_MODELS_FETCH`.
 */
// PRE-EXISTING debt, exposed when M75 fixed the Biome config that used to abort before
// sweeping these files (a nested root under refactor/). It is not new code and was not touched
// by M75; refactoring SDK internals without review would trade a visible problem for a diff
// risky. Tracked in usetheodev/theokit-sdk#151.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: see the reason just above
export async function refreshModelCatalog(
  opts: RefreshModelCatalogOptions = {},
): Promise<RefreshModelCatalogResult> {
  // M44 M4 fix — self-initialize provider registration so the `@theokit/sdk/models` subpath works standalone
  // (without the consumer having built an Agent first).
  registerBuiltins();
  // M44 L11 fix — presence-based would treat "0"/"false"/"" as disabled; only truthy values disable.
  const kill = process.env.THEOKIT_DISABLE_MODELS_FETCH;
  if (kill !== undefined && kill !== "" && kill !== "0" && kill.toLowerCase() !== "false") {
    return { source: "skipped", models: 0 };
  }
  const url = opts.url ?? process.env.THEOKIT_MODELS_URL ?? DEFAULT_URL;
  const path = cachePathFor(url);
  const now = opts.deps?.now ?? (() => Date.now());

  // TTL gate: a fresh cache serves without network (mtime freshness).
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
      // 2 transient retries with backoff; every error here is worth one more try —
      // the whole call is already fail-closed at the caller.
      { retries: 2, isRetryable: () => true, initialDelayMs: 200 },
    );
    body = await res.text();
    JSON.parse(body); // validate before persisting — never cache garbage
  } catch (err) {
    diag(
      `[theokit-sdk] WARN: models-dev refresh failed (${(err as Error).message}) — serving existing data\n`,
    );
    // fail-closed: serve whatever we already have (stale cache if present, else vendored)
    return { source: "cache", models: loadCacheIntoIndex(url) };
  }

  try {
    writeCacheAtomic(path, body);
  } catch (err) {
    diag(`[theokit-sdk] WARN: models-dev cache write failed (${(err as Error).message})\n`);
  }
  try {
    return { source: "network", models: patchIndexFromApiJson(JSON.parse(body)) };
  } catch (err) {
    diag(
      `[theokit-sdk] WARN: models-dev patch failed (${(err as Error).message}) — serving existing data\n`,
    );
    return { source: "cache", models: 0 };
  }
}

/** The enriched per-model view (public via `@theokit/sdk/models`): index lookup by (possibly prefixed) id. */
export function getModelInfo(modelId: string): ReturnType<typeof getCatalogModelInfo> {
  return getCatalogModelInfo(modelId);
}
