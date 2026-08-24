import { parseModelId } from "./internal/llm/model-identifier.js";
import type { Plugin } from "./internal/plugins/types.js";
import { registerBuiltins } from "./internal/providers/builtin/index.js";
import { listProviders } from "./internal/providers/registry.js";
import type { ProviderProfile } from "./internal/providers/types.js";

/**
 * Options for {@link defineProvider}.
 *
 * @public
 */
export interface DefineProviderOptions {
  /** Plugin version surfaced in diagnostics. Default `"1.0.0"`. */
  version?: string;
}

/**
 * Canonical factory for a custom LLM provider, mirroring {@link Tool.create} and
 * {@link definePlugin} (Inviolable Rule 9 — every agentic capability ships as a
 * factory function).
 *
 * A {@link ProviderProfile} is data-only: it declares the provider name, the
 * HTTP dialect (`apiMode`), auth, base URL and fallback models. The transport
 * is selected from `apiMode` by the router, so any OpenAI-/Anthropic-compatible
 * endpoint (Groq, Together, Fireworks, a private gateway) is expressible as a
 * profile with no new code.
 *
 * Reached through {@link Provider.create}, which is the exported façade — this function
 * itself is internal. The docblock used to show `defineProvider(...)` as the call to write,
 * and it is not exported from any entry point, so following it produced
 * `TypeError: defineProvider is not a function`.
 *
 * One door rather than two, deliberately: `Provider` already owns `create`, `builtins` and
 * `forModel`, and a second exported way to build the same plugin would be a choice nobody
 * needs to make.
 *
 * Pass the result to `Agent.create({ plugins: [...] })` and route to it with
 * the `provider/model` id prefix or `providers.routes`:
 *
 * ```ts
 * const groq = Provider.create({
 *   name: "groq",
 *   apiMode: "chat_completions",
 *   authType: "api_key",
 *   envVars: ["GROQ_API_KEY"],
 *   baseUrl: "https://api.groq.com/openai/v1",
 *   fallbackModels: ["groq/llama-3.1-8b-instant"],
 * });
 * const agent = await Agent.create({
 *   model: { id: "groq/llama-3.1-8b-instant" },
 *   plugins: [groq],
 * });
 * ```
 *
 * @public
 */
function defineProvider(profile: ProviderProfile, opts?: DefineProviderOptions): Plugin {
  return {
    name: profile.name,
    version: opts?.version ?? "1.0.0",
    kind: "model-provider",
    profile,
  };
}

/** SE36 — uniform namespace API. `Provider.create` replaces `defineProvider` (ADR 0015). @public */
export class Provider {
  private constructor() {}
  static create(profile: ProviderProfile, opts?: DefineProviderOptions): Plugin {
    return defineProvider(profile, opts);
  }

  /**
   * Every first-party builtin provider (anthropic, openai, openrouter, gemini, ollama, the ChatGPT/Codex
   * `openai-chatgpt`, …) as model-provider plugins, ready to hand to `Agent.create({ plugins })` or any
   * runtime that consumes model-provider plugins (e.g. the `theokit` agent server / `@theokit/agents`, whose
   * own model resolution does NOT share this registry). Enables a consumer to route to ANY SDK builtin —
   * including one added later in a single SDK file — with ZERO provider-specific code: just
   * `.plugins(Provider.builtins())` once, then pick a `provider/model` id. @public
   */
  static builtins(): Plugin[] {
    registerBuiltins();
    return listProviders().map((profile) => defineProvider(profile));
  }

  /**
   * The builtin serving `modelId`, or `undefined` when none does.
   *
   * The grammar of a model id — `provider/model` — now has **one** owner. M94: the consumer
   * redid it by hand with `modelId.slice(0, modelId.indexOf('/'))`, which on an id **without a slash** returns the
   * id minus its last character (`claude-opus-5` -> `claude-opus-`): it matches no provider and the
   * caller fell through to the default, without distinguishing that from a hit. A non-routable model was
   * indistinguishable from the happy path.
   *
   * Returns `undefined` instead of throwing: the caller decides whether absence is an error, and only they
   * know whether the model came from an explicit `--model` (an error) or from the default (normal).
   *
   * @public
   */
  static forModel(modelId: string): Plugin | undefined {
    // Delegates to `parseModelId`, the grammar's canonical owner — M94's DoD asked for
    // exactly that ("reusing the SDK's own id parser so the grammar has ONE
    // owner") and the first version redid `indexOf`/`slice` inline, reinventing the owner right next to it.
    //
    // Adversarial review measured the cost: 7 of 8 divergences. `lm-studio/qwen3` resolves to the
    // real `lmstudio` builtin via the parser and to NOTHING via the slice — and since the consumer now
    // throwing when there is no provider, a custom command that worked before M94 would start
    // fails. `Anthropic/...`, ` openai/...`, `llama.cpp/...` likewise. And the inverse: `openai/` (empty name) the
    // the parser rejects and the slice used to accept.
    const { provider } = parseModelId(modelId);
    if (provider === undefined) return undefined;
    return Provider.builtins().find((p) => p.name === provider);
  }
}
