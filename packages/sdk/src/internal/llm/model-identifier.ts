/**
 * Model identifier parsing (T1.2 follow-up, ADR D182 zero-config UX).
 *
 * SDK callers pass model strings like:
 *   - `"ollama/llama3.2:3b"`             → provider="ollama", name="llama3.2:3b"
 *   - `"anthropic/claude-3-5-sonnet"`    → provider="anthropic", name="claude-3-5-sonnet"
 *   - `"openrouter/meta-llama/llama-3"`  → provider="openrouter", name="meta-llama/llama-3"
 *   - `"claude-sonnet-4-6"`              → provider=undefined, name="claude-sonnet-4-6"
 *
 * The first `/` separates the provider from the rest. Models with embedded
 * slashes (e.g. OpenRouter routing) keep the remainder intact. Tag suffixes
 * (`:latest`, `:3b`) are preserved as part of the name — Ollama expects them.
 *
 * **Returns `undefined` provider** when no `/` is present so callers can
 * fall back to env-var detection. Empty/whitespace components are treated
 * as no-prefix.
 *
 * Aligned with peer-project `extensions/ollama/src/discovery-shared.ts`
 * (`OLLAMA_PROVIDER_ID = "ollama"`) and Hermes `hermes_cli/providers.py`
 * (ALIASES table, `normalize_provider`).
 *
 * Public via `@theokit/sdk/models` (M5-8).
 *
 * @public
 */

export interface ParsedModelId {
  /** Provider name extracted from the prefix (lowercase), or undefined. */
  provider: string | undefined;
  /** Model name to send to the provider — prefix stripped. */
  name: string;
}

/** Provider aliases mirrored from Hermes `hermes_cli/providers.py` ALIASES. */
const PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  "llama-cpp": "llamacpp",
  "llama.cpp": "llamacpp",
  "lm-studio": "lmstudio",
  lm_studio: "lmstudio",
};

/**
 * Split a model string into `{ provider, name }` at the FIRST `/`.
 *
 *   parseModelId("ollama/llama3.2:3b")             // { provider: "ollama",     name: "llama3.2:3b" }
 *   parseModelId("openrouter/meta-llama/llama-3")  // { provider: "openrouter", name: "meta-llama/llama-3" }
 *   parseModelId("claude-sonnet-4-6")              // { provider: undefined,    name: "claude-sonnet-4-6" }
 *
 * Pure and synchronous: no catalog lookup, no network, and no check that the
 * provider or the model exists. The provider is lowercased and mapped through a
 * small alias table (`llama-cpp` / `llama.cpp` to `llamacpp`, `lm-studio` /
 * `lm_studio` to `lmstudio`); the name keeps its remaining slashes and any `:tag`
 * suffix, which Ollama needs.
 *
 * Never throws and never returns an error shape. `provider: undefined` means "no
 * usable prefix" and is the caller's cue to fall back to env-var detection.
 *
 * Traps:
 *  - `undefined` or `""` yields `{ provider: undefined, name: "" }` — an EMPTY
 *    name, not `undefined`. A caller forwarding `name` unchecked sends an empty
 *    model id to the provider.
 *  - A degenerate prefix is not an error. `"/foo"`, `"foo/"` and `" /x"` all come
 *    back with `provider: undefined` and the ORIGINAL, untrimmed string as `name`;
 *    trimming happens only when both halves are non-empty.
 *  - Only the first `/` splits. `"openrouter/meta-llama/llama-3"` keeps
 *    `meta-llama/llama-3` whole as the name.
 */
export function parseModelId(modelId: string | undefined): ParsedModelId {
  if (modelId === undefined || modelId.length === 0) {
    return { provider: undefined, name: "" };
  }
  const slash = modelId.indexOf("/");
  if (slash <= 0 || slash === modelId.length - 1) {
    return { provider: undefined, name: modelId };
  }
  const rawProvider = modelId.slice(0, slash).trim().toLowerCase();
  const name = modelId.slice(slash + 1).trim();
  if (rawProvider.length === 0 || name.length === 0) {
    return { provider: undefined, name: modelId };
  }
  const canonical = PROVIDER_ALIASES[rawProvider] ?? rawProvider;
  return { provider: canonical, name };
}
