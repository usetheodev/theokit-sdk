/**
 * Dynamic provider catalog loader (T10.1, ADR D447).
 *
 * Loads provider metadata from `provider-catalog.json` at runtime.
 * Malformed entries are skipped with WARN (EC-1) — never crash.
 *
 * @internal
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diag } from "../diagnostics.js";
import { globalSingleton } from "../global-singleton.js";
import { type CatalogModel, catalogModelSchema } from "./catalog-schema.js";
import { getProviderProfile, registerProvider } from "./registry.js";
import type { ApiMode, AuthType, ProviderProfile } from "./types.js";

const __dirname_resolved = dirname(fileURLToPath(import.meta.url));

export interface ProviderCapabilities {
  supportsToolUse: boolean;
  supportsVision: boolean;
  supportsStructuredOutput: boolean;
  supportsStreaming: boolean;
  supportsCacheControl: boolean;
  maxContextTokens?: number;
  maxOutputTokens?: number;
}

export interface CatalogEntry {
  id: string;
  displayName: string;
  apiMode: ApiMode;
  authType: AuthType;
  baseUrl: string;
  envVars: string[];
  fallbackModels: string[];
  capabilities: ProviderCapabilities;
  aliases?: string[];
  modelsUrl?: string;
  hostname?: string;
  extraHeaders?: Record<string, string>;
  /**
   * M44 — OPTIONAL per-model data (models.dev shape, snake_case — see `catalog-schema.ts`), keyed by the
   * BARE model id. Additive: entries without it behave byte-identically to before. The loader indexes this
   * into the model-info index (`getCatalogModelInfo`) rather than onto `ProviderProfile` (ADR D2 — the
   * builtins-first registration skip means profile-attached data would never reach builtin providers).
   */
  models?: Record<string, CatalogModel>;
}

/**
 * M44 — the model-info index: `provider/model` → per-model catalog data (the EXACT-map key convention).
 * Populated by the vendored catalog load AND patched by the optional models-dev source (cache entries win
 * per model). The single lookup surface for capability / cost / limit enrichment.
 */
// M44 B1 fix — index state on globalThis (Symbol.for) so every bundle copy shares the SAME maps (see the
// identical pattern + rationale in registry.ts).
const modelInfoIndex = globalSingleton(
  "theokit-sdk.providers.model-info-index",
  () => new Map<string, CatalogModel>(),
);
/** M44 M5 fix — keys patched by the live models-dev source (honest pricing provenance). */
const patchedModelKeys = globalSingleton(
  "theokit-sdk.providers.model-info-patched",
  () => new Set<string>(),
);
const indexState = globalSingleton("theokit-sdk.providers.model-info-loaded", () => ({
  loaded: false,
}));

/**
 * Look up per-model catalog data by `provider/model` key.
 *
 * Semver-exempt: not declared in `package.json` `exports`, but re-exported by
 * `catalog-source-models-dev.ts`, whose declaration is reachable from published entries — so it
 * must be EMITTED.
 */
export function getCatalogModelInfo(key: string): CatalogModel | undefined {
  ensureModelIndexLoaded();
  return modelInfoIndex.get(key);
}

/** Was this key patched by the LIVE models-dev source (vs the vendored catalog)? @internal */
export function isPatchedModelKey(key: string): boolean {
  return patchedModelKeys.has(key);
}

/**
 * Patch the index with fresher per-model data (the models-dev source). M44 H2 fix — a per-FIELD shallow
 * MERGE, not a wholesale replace: models.dev can never supply the theokit extension fields
 * (`cache_control`, `structured_output` overlays), so a replace would wipe them and silently flip
 * capability answers. Incoming fields win; existing fields survive when the patch omits them.
 * @internal
 */
export function patchModelInfo(key: string, model: CatalogModel): void {
  ensureModelIndexLoaded();
  const existing = modelInfoIndex.get(key);
  modelInfoIndex.set(key, existing === undefined ? model : { ...existing, ...model });
  patchedModelKeys.add(key);
}

/** All indexed `provider/model` keys (for maintenance/tests). @internal */
export function listModelInfoKeys(): string[] {
  ensureModelIndexLoaded();
  return [...modelInfoIndex.keys()];
}

function ensureModelIndexLoaded(): void {
  if (indexState.loaded) return;
  indexState.loaded = true;
  // M44 L9 fix — never throw from a capability/pricing lookup: a missing/corrupt vendored catalog degrades
  // to conservative defaults with a WARN (the deleted EXACT map could never throw; keep that property).
  try {
    const catalog = loadProviderCatalog();
    for (const entry of Object.values(catalog)) {
      indexEntryModels(entry);
    }
  } catch (err) {
    diag(
      `[theokit-sdk] WARN: provider catalog unavailable (${(err as Error).message}) — per-model data disabled\n`,
    );
  }
}

/**
 * Index an entry's `models` block. Runs for EVERY catalog entry — including those whose PROVIDER
 * registration is skipped builtins-first — so builtin providers still get their per-model data (ADR D2).
 * A malformed model sub-entry drops THAT MODEL with WARN and keeps the provider (EC-1 philosophy extended).
 */
// PRE-EXISTING debt, exposed when M75 fixed the Biome config that used to abort before
// sweeping these files (a nested root under refactor/). It is not new code and was not touched
// by M75; refactoring SDK internals without review would trade a visible problem for a diff
// risky. Tracked in usetheodev/theokit-sdk#151.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: see the reason just above
function indexEntryModels(entry: CatalogEntry): void {
  if (entry.models === undefined || typeof entry.models !== "object") return;
  for (const [modelId, raw] of Object.entries(entry.models)) {
    const parsed = catalogModelSchema.safeParse(raw);
    if (!parsed.success) {
      diag(
        `[theokit-sdk] WARN: Skipping malformed catalog model "${entry.id}/${modelId}": ` +
          `${parsed.error.issues[0]?.message ?? "invalid"}\n`,
      );
      continue;
    }
    // Index under the entry id AND every alias — capability lookups are VENDOR-keyed (e.g.
    // `google/gemini-2.5-pro` while the entry id is `google-gemini` with alias `google`), so alias keys are
    // what make the vendor-keyed convention resolve without a second mapping table.
    modelInfoIndex.set(`${entry.id}/${modelId}`, parsed.data);
    for (const alias of entry.aliases ?? []) {
      const key = `${alias}/${modelId}`;
      if (!modelInfoIndex.has(key)) modelInfoIndex.set(key, parsed.data);
    }
  }
}

/** Test-only reset for the model-info index. @internal */
export function _resetModelInfoIndexForTests(): void {
  modelInfoIndex.clear();
  patchedModelKeys.clear();
  indexState.loaded = false;
}

interface LoadOptions {
  _testInjectMalformed?: boolean;
}

function validateEntry(raw: Record<string, unknown>): CatalogEntry | null {
  if (
    typeof raw.id !== "string" ||
    typeof raw.displayName !== "string" ||
    typeof raw.apiMode !== "string" ||
    typeof raw.authType !== "string" ||
    typeof raw.baseUrl !== "string" ||
    !Array.isArray(raw.envVars) ||
    !Array.isArray(raw.fallbackModels) ||
    raw.capabilities == null ||
    typeof raw.capabilities !== "object"
  ) {
    return null;
  }
  return raw as unknown as CatalogEntry;
}

export function loadProviderCatalog(opts?: LoadOptions): Record<string, CatalogEntry> {
  const catalogPath = join(__dirname_resolved, "provider-catalog.json");
  const rawText = readFileSync(catalogPath, "utf-8");
  let entries: Record<string, unknown>[] = JSON.parse(rawText);

  if (opts?._testInjectMalformed) {
    entries = [
      ...entries,
      { id: "malformed-provider", displayName: "Bad" } as Record<string, unknown>,
    ];
  }

  const result: Record<string, CatalogEntry> = {};
  for (const raw of entries) {
    const validated = validateEntry(raw as Record<string, unknown>);
    if (validated === null) {
      diag(
        `[theokit-sdk] WARN: Skipping malformed catalog entry: ${JSON.stringify(raw).slice(0, 100)}\n`,
      );
      continue;
    }
    result[validated.id] = validated;
  }
  return result;
}

let _capabilitiesCache: Record<string, ProviderCapabilities> | null = null;

// PRE-EXISTING debt, exposed when M75 fixed the Biome config that used to abort before
// sweeping these files (a nested root under refactor/). It is not new code and was not touched
// by M75; refactoring SDK internals without review would trade a visible problem for a diff
// risky. Tracked in usetheodev/theokit-sdk#151.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: see the reason just above
export function getCatalogCapabilities(providerId: string): ProviderCapabilities | undefined {
  if (_capabilitiesCache === null) {
    const catalog = loadProviderCatalog();
    _capabilitiesCache = {};
    for (const entry of Object.values(catalog)) {
      _capabilitiesCache[entry.id] = entry.capabilities;
      // M45 review L4 — alias keys too (e.g. entry `google-gemini` alias `google`), consistent with the
      // model-info index's alias-keyed convention.
      for (const alias of entry.aliases ?? []) {
        if (_capabilitiesCache[alias] === undefined) _capabilitiesCache[alias] = entry.capabilities;
      }
    }
  }
  return _capabilitiesCache[providerId];
}

export function registerCatalogProviders(opts?: LoadOptions): void {
  const catalog = loadProviderCatalog(opts);
  for (const entry of Object.values(catalog)) {
    // Skip catalog entries that would overwrite first-party builtins.
    // Builtins have richer env-var handling and are registered first.
    // Also skip if any alias collides with an existing provider name.
    if (getProviderProfile(entry.id) !== undefined) continue;
    if (entry.aliases?.some((a) => getProviderProfile(a) !== undefined)) continue;

    const profile: ProviderProfile = {
      name: entry.id,
      apiMode: entry.apiMode,
      authType: entry.authType,
      baseUrl: entry.baseUrl,
      envVars: entry.envVars,
      fallbackModels: entry.fallbackModels,
      displayName: entry.displayName,
      aliases: entry.aliases,
      modelsUrl: entry.modelsUrl,
      hostname: entry.hostname,
      extraHeaders: entry.extraHeaders,
    };
    registerProvider(profile);
  }
}
