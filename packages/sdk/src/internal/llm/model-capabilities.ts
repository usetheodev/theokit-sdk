/**
 * T3.10c — Model capability registry (DR3 #17).
 *
 * Typed per-model flags that let the SDK gate features at the boundary
 * (before hitting the provider) instead of letting opaque 400s surface.
 *
 * Resolution algorithm:
 *   1. Strip routing prefixes (openrouter/, vertex/, bedrock/) AND the
 *      OpenRouter `:variant` suffix (:free/:nitro/…) to find the bare vendor id.
 *   2. Exact match in the `EXACT` catalog → return entry.
 *   3. Vendor inference (e.g., `claude-*` → `anthropic/claude-*`) → return entry.
 *   4. No match → conservative defaults (all false, minimum tokens).
 *
 * Module is internal, but `ModelCapabilities` + `resolveModelCapabilities` are
 * re-exported publicly via the `@theokit/sdk/models` subpath (see their @public tags).
 */

/**
 * Per-model capability shape. Consumers use this to gate features at
 * the SDK boundary (before request construction, not after 400).
 *
 * @public
 */
export interface ModelCapabilities {
  supportsVision: boolean;
  supportsStructuredOutput: boolean;
  supportsToolUse: boolean;
  supportsCacheControl: boolean;
  maxContextTokens: number;
  maxOutputTokens: number;
}

const CONSERVATIVE_DEFAULTS: ModelCapabilities = {
  supportsVision: false,
  supportsStructuredOutput: false,
  supportsToolUse: false,
  supportsCacheControl: false,
  maxContextTokens: 4096,
  maxOutputTokens: 4096,
};

/** Exact-match capability entries. Keys are `vendor/model` (no routing prefix). */
const EXACT: ReadonlyMap<string, ModelCapabilities> = new Map([
  // OpenAI family
  [
    "openai/gpt-4o",
    {
      supportsVision: true,
      supportsStructuredOutput: true,
      supportsToolUse: true,
      supportsCacheControl: false,
      maxContextTokens: 128_000,
      maxOutputTokens: 16_384,
    },
  ],
  [
    "openai/gpt-4o-mini",
    {
      supportsVision: true,
      supportsStructuredOutput: true,
      supportsToolUse: true,
      supportsCacheControl: false,
      maxContextTokens: 128_000,
      maxOutputTokens: 16_384,
    },
  ],
  [
    "openai/gpt-4-turbo",
    {
      supportsVision: true,
      supportsStructuredOutput: false,
      supportsToolUse: true,
      supportsCacheControl: false,
      maxContextTokens: 128_000,
      maxOutputTokens: 4096,
    },
  ],
  [
    "openai/o1",
    {
      supportsVision: false,
      supportsStructuredOutput: true,
      supportsToolUse: true,
      supportsCacheControl: false,
      maxContextTokens: 200_000,
      maxOutputTokens: 100_000,
    },
  ],
  [
    "openai/o3",
    {
      supportsVision: false,
      supportsStructuredOutput: true,
      supportsToolUse: true,
      supportsCacheControl: false,
      maxContextTokens: 200_000,
      maxOutputTokens: 100_000,
    },
  ],
  // Anthropic family
  [
    "anthropic/claude-opus-4",
    {
      supportsVision: true,
      supportsStructuredOutput: false,
      supportsToolUse: true,
      supportsCacheControl: true,
      maxContextTokens: 200_000,
      maxOutputTokens: 32_000,
    },
  ],
  [
    "anthropic/claude-sonnet-4",
    {
      supportsVision: true,
      supportsStructuredOutput: false,
      supportsToolUse: true,
      supportsCacheControl: true,
      maxContextTokens: 200_000,
      maxOutputTokens: 16_000,
    },
  ],
  [
    "anthropic/claude-3-5-sonnet",
    {
      supportsVision: true,
      supportsStructuredOutput: false,
      supportsToolUse: true,
      supportsCacheControl: true,
      maxContextTokens: 200_000,
      maxOutputTokens: 8192,
    },
  ],
  [
    "anthropic/claude-3-5-sonnet-latest",
    {
      supportsVision: true,
      supportsStructuredOutput: false,
      supportsToolUse: true,
      supportsCacheControl: true,
      maxContextTokens: 200_000,
      maxOutputTokens: 8192,
    },
  ],
  [
    "anthropic/claude-3-5-haiku-latest",
    {
      supportsVision: false,
      supportsStructuredOutput: false,
      supportsToolUse: true,
      supportsCacheControl: true,
      maxContextTokens: 200_000,
      maxOutputTokens: 8192,
    },
  ],
  [
    "anthropic/claude-3-haiku",
    {
      supportsVision: true,
      supportsStructuredOutput: false,
      supportsToolUse: true,
      supportsCacheControl: true,
      maxContextTokens: 200_000,
      maxOutputTokens: 4096,
    },
  ],
  [
    "anthropic/claude-3-opus",
    {
      supportsVision: true,
      supportsStructuredOutput: false,
      supportsToolUse: true,
      supportsCacheControl: true,
      maxContextTokens: 200_000,
      maxOutputTokens: 4096,
    },
  ],
]);

/** Routing prefixes to strip to find the underlying vendor model. */
const ROUTING_PREFIXES = ["openrouter/", "vertex/", "bedrock/"] as const;

/**
 * Resolve per-model capability flags (vision/structured-output/tool-use/cache +
 * `maxContextTokens`/`maxOutputTokens`) for a model id. Pure, sync, offline (a
 * static catalog — no network). Strips routing prefixes (`openrouter/`/`vertex/`/
 * `bedrock/`) and OpenRouter `:variant` suffixes before lookup; unknown models get
 * conservative defaults. Public via `@theokit/sdk/models`.
 *
 * @public
 */
export function resolveModelCapabilities(modelId: string): ModelCapabilities {
  const bare = stripVariantSuffix(stripRoutingPrefix(modelId));
  const exact = EXACT.get(bare);
  if (exact !== undefined) return exact;
  // Routing-prefixed models (vertex/claude-3-5-sonnet) strip to bare
  // model name without vendor. Try inferring the vendor from the name.
  const withVendor = inferVendorPrefix(bare);
  if (withVendor !== bare) {
    const vendored = EXACT.get(withVendor);
    if (vendored !== undefined) return vendored;
  }
  return CONSERVATIVE_DEFAULTS;
}

function stripRoutingPrefix(modelId: string): string {
  for (const prefix of ROUTING_PREFIXES) {
    if (modelId.startsWith(prefix)) return modelId.slice(prefix.length);
  }
  return modelId;
}

/**
 * Strip an OpenRouter variant suffix (`:free`/`:nitro`/`:floor`/`:beta`/…) so the
 * catalog lookup hits the underlying model. Model slugs contain no `:` except the
 * variant separator, so cutting at the first `:` is safe.
 */
function stripVariantSuffix(modelId: string): string {
  const i = modelId.indexOf(":");
  return i >= 0 ? modelId.slice(0, i) : modelId;
}

/** Infer vendor prefix from bare model name for routing-prefixed lookups. */
function inferVendorPrefix(bare: string): string {
  if (bare.startsWith("claude")) return `anthropic/${bare}`;
  if (bare.startsWith("gpt-") || bare.startsWith("o1") || bare.startsWith("o3"))
    return `openai/${bare}`;
  if (bare.startsWith("gemini")) return `google/${bare}`;
  return bare;
}
