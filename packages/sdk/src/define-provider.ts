import type { Plugin } from "./internal/plugins/types.js";
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
}
