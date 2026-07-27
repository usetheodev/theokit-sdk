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
 * Canonical factory for a custom LLM provider, mirroring {@link defineTool} and
 * {@link definePlugin} (Inviolable Rule 9 — every agentic capability ships as a
 * factory function).
 *
 * A {@link ProviderProfile} is data-only: it declares the provider name, the
 * HTTP dialect (`apiMode`), auth, base URL and fallback models. The transport
 * is selected from `apiMode` by the router, so any OpenAI-/Anthropic-compatible
 * endpoint (Groq, Together, Fireworks, a private gateway) is expressible as a
 * profile with no new code.
 *
 * Pass the result to `Agent.create({ plugins: [...] })` and route to it with
 * the `provider/model` id prefix or `providers.routes`:
 *
 * ```ts
 * const groq = defineProvider({
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
   * O builtin que atende `modelId`, ou `undefined` quando nenhum atende.
   *
   * A gramática de um id de modelo — `provider/modelo` — passa a ter **um** dono. M94: o consumidor
   * a refazia à mão com `modelId.slice(0, modelId.indexOf('/'))`, que num id **sem barra** devolve o
   * id menos o último caractere (`claude-opus-5` → `claude-opus-`): casa provider nenhum e o
   * chamador seguia para o default, sem distinguir isso de um acerto. Um modelo não-roteável era
   * indistinguível do caminho feliz.
   *
   * Devolve `undefined` em vez de lançar: quem decide se a ausência é erro é o chamador, e só ele
   * sabe se o modelo veio de um `--model` explícito (erro) ou do default (normal).
   *
   * @public
   */
  static forModel(modelId: string): Plugin | undefined {
    const corte = modelId.indexOf("/");
    if (corte <= 0) return undefined;
    const nome = modelId.slice(0, corte);
    return Provider.builtins().find((p) => p.name === nome);
  }
}
