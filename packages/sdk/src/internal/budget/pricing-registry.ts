/**
 * Pricing registry — bundled snapshot of LiteLLM JSON (ADR D379) with
 * lazy load + alias normalization (EC-2).
 *
 * Snapshot lives in `pricing-data.json` (hand-curated 2026-05; refresh
 * via `scripts/refresh-pricing.mjs`). All rates in USD per 1_000_000
 * tokens (D378).
 *
 * Lookup precedence (EC-2):
 *   1. Direct `provider/model` key
 *   2. Strip date suffix (-YYYYMMDD or -YYYY-MM-DD)
 *   3. Anthropic dot-to-dash normalization (claude-opus-4.7 → claude-opus-4-7)
 *   4. Strip `openrouter/` prefix
 *
 * @internal
 */

import { getCatalogModelInfo, isPatchedModelKey } from "../providers/catalog-loader.js";
import pricingData from "./pricing-data.json" with { type: "json" };

export interface PricingEntry {
  readonly provider: string;
  readonly model: string;
  readonly inputCostPerMillion: number;
  readonly outputCostPerMillion: number;
  readonly cacheReadCostPerMillion?: number;
  readonly cacheWriteCostPerMillion?: number;
  readonly reasoningCostPerMillion?: number;
  readonly pricingVersion: string;
}

interface RawModelEntry {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
}

interface RawPricingData {
  _meta: { pricingVersion: string; [k: string]: unknown };
  models: Record<string, RawModelEntry>;
}

const data = pricingData as RawPricingData;

function buildEntry(key: string, raw: RawModelEntry): PricingEntry {
  const [provider, ...modelParts] = key.split("/");
  return {
    provider: provider ?? "unknown",
    model: modelParts.join("/"),
    inputCostPerMillion: raw.input,
    outputCostPerMillion: raw.output,
    ...(raw.cacheRead !== undefined ? { cacheReadCostPerMillion: raw.cacheRead } : {}),
    ...(raw.cacheWrite !== undefined ? { cacheWriteCostPerMillion: raw.cacheWrite } : {}),
    ...(raw.reasoning !== undefined ? { reasoningCostPerMillion: raw.reasoning } : {}),
    pricingVersion: data._meta.pricingVersion,
  };
}

function stripDateSuffix(model: string): string {
  // EC-2: -20250507 or -2025-05-07 at end of name.
  return model.replace(/-\d{4}-?\d{2}-?\d{2}$/, "");
}

function normalizeAnthropicDots(model: string): string {
  // EC-2: claude-opus-4.7 → claude-opus-4-7
  //
  // Lookarounds rather than captured `\d+` runs, and the difference is not stylistic. The old
  // `/(\d+)\.(\d+)/g` consumed digits to the end of the string at every start position and then
  // backtracked looking for a dot that was not there — quadratic in a value the CALLER supplies
  // (CodeQL js/polynomial-redos #5). Measured on a run of digits with no dot:
  //
  //     12_500 ->     762 ms        50_000 ->  11_960 ms
  //     25_000 ->   2_995 ms       200_000 -> 154_383 ms
  //
  // Two and a half minutes of pinned CPU from one model id, inside an SDK built to run in a
  // server serving other people. The lookaround form matches a single dot and cannot backtrack:
  // the same 200_000 characters take about 4 ms.
  //
  // One behaviour difference, checked rather than assumed: an id with TWO dots between digits
  // ("1.2.3") normalised to "1-2.3" before and "1-2-3" now, because the old pattern consumed the
  // middle digit into its first match. No id in the provider catalog has two — measured across
  // all 34, of which 14 have exactly one — and normalising every dot is the more consistent
  // reading of what this function is for.
  return model.replace(/(?<=\d)\.(?=\d)/g, "-");
}

function stripOpenRouterPrefix(modelId: string): string {
  return modelId.startsWith("openrouter/") ? modelId.slice("openrouter/".length) : modelId;
}

function lookupRaw(key: string): RawModelEntry | undefined {
  return data.models[key];
}

/**
 * Returns the pricing entry for a given `{provider, model}` route.
 * Tries direct lookup, then 3 alias normalizations (EC-2).
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 4-step alias resolution chain (direct → date-strip → dot-norm → openrouter-strip) is intrinsic to the lookup; refactor adds noise without separation.
export function getPricingEntry(opts: {
  provider: string;
  model: string;
  baseUrl?: string;
}): PricingEntry | undefined {
  // OpenRouter normalization: strip prefix if model includes it
  const cleaned = stripOpenRouterPrefix(opts.model);
  const directKey = `${opts.provider}/${cleaned}`;

  // 1. Direct
  const direct = lookupRaw(directKey);
  if (direct !== undefined) return buildEntry(directKey, direct);

  // 2. Strip date suffix
  const noSuffix = stripDateSuffix(cleaned);
  if (noSuffix !== cleaned) {
    const noSuffixKey = `${opts.provider}/${noSuffix}`;
    const found = lookupRaw(noSuffixKey);
    if (found !== undefined) return buildEntry(noSuffixKey, found);
  }

  // 3. Anthropic dot-to-dash
  if (opts.provider === "anthropic") {
    const normalized = normalizeAnthropicDots(stripDateSuffix(cleaned));
    const normKey = `${opts.provider}/${normalized}`;
    const found = lookupRaw(normKey);
    if (found !== undefined) return buildEntry(normKey, found);
  }

  // 4. Model id contains provider/model (e.g., openrouter passthrough)
  if (cleaned.includes("/")) {
    const found = lookupRaw(cleaned);
    if (found !== undefined) return buildEntry(cleaned, found);
    // Try strip date on the full path too
    const stripped = stripDateSuffix(cleaned);
    if (stripped !== cleaned) {
      const found2 = lookupRaw(stripped);
      if (found2 !== undefined) return buildEntry(stripped, found2);
    }
  }

  // 5. M44 — catalog fallback (ADR D3: pricing-data.json FEEDS from the catalog, never replaced by it).
  // On a TOTAL LiteLLM miss, consult the model-info index's `cost` (models.dev USD-per-1M convention —
  // same unit as D378). Provenance marked "catalog-vendored" so CostBreakdown stays honest about the source.
  const catalogEntry = catalogCostFallback(opts.provider, cleaned);
  if (catalogEntry !== undefined) return catalogEntry;

  return undefined;
}

/** Step-5 catalog cost lookup: direct `provider/model`, then the model id as-is when it carries a path. */
// PRE-EXISTING debt, exposed when M75 fixed the Biome config that used to abort before
// sweeping these files (a nested root under refactor/). It is not new code and was not touched
// by M75; refactoring SDK internals without review would trade a visible problem for a diff
// risky. Tracked in usetheodev/theokit-sdk#151.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: see the reason just above
function catalogCostFallback(provider: string, cleanedModel: string): PricingEntry | undefined {
  // M44 L10 fix — also try the date-stripped id (parity with the LiteLLM chain's step 2).
  const stripped = stripDateSuffix(cleanedModel);
  const candidates = [`${provider}/${cleanedModel}`, cleanedModel];
  if (stripped !== cleanedModel) candidates.push(`${provider}/${stripped}`, stripped);
  for (const key of candidates) {
    const info = getCatalogModelInfo(key);
    const cost = info?.cost;
    if (cost === undefined) continue;
    const [prov, ...modelParts] = key.split("/");
    return {
      provider: prov ?? provider,
      model: modelParts.join("/") || cleanedModel,
      inputCostPerMillion: cost.input,
      outputCostPerMillion: cost.output,
      ...(cost.cache_read !== undefined ? { cacheReadCostPerMillion: cost.cache_read } : {}),
      ...(cost.cache_write !== undefined ? { cacheWriteCostPerMillion: cost.cache_write } : {}),
      // M44 M5 fix — honest provenance: a key patched by the LIVE models-dev source is not "vendored".
      pricingVersion: isPatchedModelKey(key) ? "catalog-models-dev" : "catalog-vendored",
    };
  }
  return undefined;
}

export function pricingVersion(): string {
  return data._meta.pricingVersion;
}
