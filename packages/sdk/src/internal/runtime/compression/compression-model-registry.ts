/**
 * T2.2 — Provider-agnostic compression-model registry (ADR D440).
 *
 * Resolves a cheaper-tier summarization model in the SAME vendor family
 * as the agent's main model. Provider-agnostic by design: a consumer
 * running on Anthropic-only / Ollama-only / Bedrock-only never needs
 * to provision a second vendor's key for the compression aux-LLM.
 *
 * Resolution algorithm:
 *
 *   1. Exact match in `EXACT_REGISTRY` → cheaper-tier id (most cases).
 *   2. Wildcard match in `WILDCARD_REGISTRY` (`*` suffix in key) →
 *      swap matched suffix (Bedrock region-prefixed variants).
 *   3. Provider in `NO_AUTH_PROVIDERS` (Ollama / LM Studio / llama.cpp)
 *      → return SAME model id (local — cost N/A; running the same
 *      model for summarization costs only the round-trip latency,
 *      acceptable in dev/local mode).
 *   4. No match → throw `CompressionModelUnresolvedError` with the
 *      actionable message naming the model + override path + the
 *      registry-PR remediation hint.
 *
 * Step 1 of T2.2 (compression-helpers wire). Step 2 wires this into
 * `compression-config.ts`. Step 3 builds the OTel-instrumented aux
 * client. Step 4 wires into `loop.ts` ContextWindowExceededError catch.
 *
 * @internal
 */

import { TheokitAgentError } from "../../../errors.js";

/**
 * Exact `agent-model → compression-model` map. Most cases land here.
 * Entries MUST keep cheaper-tier model within the SAME vendor family
 * as the key (Unbreakable Rule 9 — provider-agnostic).
 */
const EXACT_REGISTRY: ReadonlyMap<string, string> = new Map([
  // OpenAI family
  ["openai/gpt-4o", "openai/gpt-4o-mini"],
  ["openai/gpt-4-turbo", "openai/gpt-4o-mini"],
  ["openai/gpt-4", "openai/gpt-4o-mini"],
  ["openai/o1-preview", "openai/gpt-4o-mini"],
  ["openai/o1", "openai/gpt-4o-mini"],
  ["openai/o3", "openai/gpt-4o-mini"],
  ["openai/o3-mini", "openai/gpt-4o-mini"],
  // Anthropic family
  ["anthropic/claude-opus-4", "anthropic/claude-3-5-haiku-latest"],
  ["anthropic/claude-sonnet-4", "anthropic/claude-3-5-haiku-latest"],
  ["anthropic/claude-3-5-sonnet", "anthropic/claude-3-5-haiku-latest"],
  ["anthropic/claude-3-5-sonnet-latest", "anthropic/claude-3-5-haiku-latest"],
  ["anthropic/claude-3-opus", "anthropic/claude-3-haiku"],
  ["anthropic/claude-3-sonnet", "anthropic/claude-3-haiku"],
  // Vertex (Gemini + Anthropic-on-Vertex)
  ["vertex/gemini-1.5-pro", "vertex/gemini-1.5-flash"],
  ["vertex/gemini-2.0-pro", "vertex/gemini-1.5-flash"],
  ["vertex/claude-3-5-sonnet", "vertex/claude-3-5-haiku"],
  ["vertex/claude-3-opus", "vertex/claude-3-haiku"],
  // OpenRouter (preserve openrouter prefix, swap tier within same vendor)
  ["openrouter/openai/gpt-4o", "openrouter/openai/gpt-4o-mini"],
  ["openrouter/openai/gpt-4-turbo", "openrouter/openai/gpt-4o-mini"],
  ["openrouter/anthropic/claude-3-5-sonnet", "openrouter/anthropic/claude-3-5-haiku"],
  ["openrouter/anthropic/claude-opus-4", "openrouter/anthropic/claude-3-5-haiku"],
]);

/**
 * Wildcard `agent-model-prefix* → compression-model-prefix*` map.
 * Used for region-prefixed Bedrock variants where the registry can't
 * enumerate every region literal. Matching algorithm: the registry
 * key MUST end with `*`; the input MUST match the prefix; the input's
 * suffix after the prefix is appended to the resolved value (also
 * ending with `*` to mark the swap point).
 */
const WILDCARD_REGISTRY: ReadonlyArray<readonly [string, string]> = [
  // Bedrock Anthropic: us.anthropic.claude-sonnet-* → us.anthropic.claude-3-haiku-*
  ["bedrock/anthropic.claude-sonnet*", "bedrock/anthropic.claude-3-haiku*"],
  ["bedrock/anthropic.claude-opus*", "bedrock/anthropic.claude-3-haiku*"],
  ["bedrock/anthropic.claude-3-5-sonnet*", "bedrock/anthropic.claude-3-5-haiku*"],
];

/**
 * Providers declaring `authType: "none"` in their profile (D182, D188,
 * D189). For these, return the SAME model — local runtime has no
 * "cheaper tier" semantics, latency penalty of summarizing twice is
 * acceptable in dev/local mode. Keys are the provider prefix BEFORE
 * the slash.
 */
const NO_AUTH_PROVIDERS: ReadonlySet<string> = new Set(["ollama", "lmstudio", "llamacpp"]);

/**
 * T2.2 — Typed error thrown when `resolveCompressionModel` cannot
 * find a same-family-cheaper-tier mapping for `agentModel`. Surfaces
 * the offending model id so operators can either (a) provide
 * `Agent.create({compression: {model: ...}})` explicitly or (b) open
 * a registry-PR adding the missing entry.
 *
 * @public
 */
export class CompressionModelUnresolvedError extends TheokitAgentError {
  override readonly name = "CompressionModelUnresolvedError";
  readonly agentModel: string;
  constructor(agentModel: string) {
    // Not retryable: the registry has no entry for this model until someone adds one.
    super(
      `Could not resolve a same-family-cheaper-tier compression model for "${agentModel}". ` +
        `Provide Agent.create({compression: {model: "<your-cheaper-model>"}}) ` +
        `OR add "${agentModel}" to the compression-model-registry (see ADR D440).`,
      { code: "compression_model_unresolved", isRetryable: false },
    );
    this.agentModel = agentModel;
  }
}

/**
 * T2.2 — Resolve a cheaper-tier compression model from the agent's
 * main model id. Pure function — no I/O, no mutation, deterministic.
 *
 * @throws `CompressionModelUnresolvedError` when no rule matches.
 *
 * @internal
 */
export function resolveCompressionModel(agentModel: string): string {
  const exact = EXACT_REGISTRY.get(agentModel);
  if (exact !== undefined) return exact;
  const wildcard = matchWildcard(agentModel);
  if (wildcard !== null) return wildcard;
  if (isNoAuthProvider(agentModel)) return agentModel;
  throw new CompressionModelUnresolvedError(agentModel);
}

/** Wildcard suffix match — Bedrock region-prefixed variants. */
function matchWildcard(agentModel: string): string | null {
  for (const [pattern, replacement] of WILDCARD_REGISTRY) {
    const prefix = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
    if (!agentModel.startsWith(prefix)) continue;
    const suffix = agentModel.slice(prefix.length);
    const replPrefix = replacement.endsWith("*") ? replacement.slice(0, -1) : replacement;
    return `${replPrefix}${suffix}`;
  }
  return null;
}

/** Provider declares `authType: "none"` — local runtime, same model. */
function isNoAuthProvider(agentModel: string): boolean {
  const slashIdx = agentModel.indexOf("/");
  if (slashIdx <= 0) return false;
  return NO_AUTH_PROVIDERS.has(agentModel.slice(0, slashIdx));
}
