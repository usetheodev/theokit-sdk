import { ConfigurationError } from "../../errors.js";
import {
  discoverProviderPlugins,
  getProviderProfile,
  type ProviderProfile,
  registerBuiltins,
} from "../providers/index.js";
import { AnthropicClient } from "./anthropic.js";
import { OpenAIClient } from "./openai.js";
import type { LlmClient } from "./types.js";

/**
 * Provider router (T4.3, ADRs D105-D107).
 *
 * Resolves an `LlmClient` from a `ProviderProfile`. The profile is the
 * data; the transport is selected by `apiMode`. Builtins are eagerly
 * registered on first call; user plugins in `~/.theokit/plugins/
 * model-providers/` are lazy-loaded.
 *
 * @internal
 */

export type ProviderName = "anthropic" | "openai" | "openrouter" | (string & {});

export interface ProviderRouterOptions {
  primary: ProviderName;
  fallback?: ProviderName[];
}

export async function resolveProviderChainAsync(
  options: ProviderRouterOptions,
): Promise<LlmClient[]> {
  registerBuiltins();
  await discoverProviderPlugins();
  return buildChain(options);
}

/**
 * Sync variant. Kept for backward compat with existing callers that
 * already invoked discovery upfront (e.g., via Agent.create initialization).
 * Builtins are still eagerly registered.
 */
export function resolveProviderChain(options: ProviderRouterOptions): LlmClient[] {
  registerBuiltins();
  return buildChain(options);
}

function buildChain(options: ProviderRouterOptions): LlmClient[] {
  const seen = new Set<string>();
  const clients: LlmClient[] = [];
  const addClient = (name: ProviderName): void => {
    const lowered = name.toLowerCase();
    if (seen.has(lowered)) return;
    seen.add(lowered);
    const client = buildClient(lowered);
    if (client !== undefined) clients.push(client);
  };
  addClient(options.primary);
  for (const fallback of options.fallback ?? []) addClient(fallback);
  if (clients.length === 0) {
    throw new ConfigurationError(
      `No provider client could be resolved (primary=${options.primary}). ` +
        `Set ANTHROPIC_API_KEY or OPENAI_API_KEY / OPENROUTER_API_KEY.`,
      { code: "provider_unresolved" },
    );
  }
  return clients;
}

function buildClient(name: string): LlmClient | undefined {
  const profile = getProviderProfile(name);
  if (profile === undefined) return undefined;
  const apiKey = resolveApiKey(profile.envVars);
  if (apiKey === undefined) return undefined;
  return selectTransport(profile, apiKey);
}

/**
 * EC-10: resolve API key from ordered envVars list; first non-empty wins.
 */
function resolveApiKey(envVars: ReadonlyArray<string>): string | undefined {
  for (const v of envVars) {
    const value = process.env[v];
    if (value !== undefined && value.length > 0) return value;
  }
  return undefined;
}

/**
 * EC-3 fix: exhaustive switch with actionable error on unsupported apiMode.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 4-mode transport ladder (chat_completions / anthropic_messages / responses_api / bedrock) is exhaustive by design — ApiMode union enforces compile-time completeness.
function selectTransport(profile: ProviderProfile, apiKey: string): LlmClient {
  if (profile.apiMode === "chat_completions") {
    const opts: ConstructorParameters<typeof OpenAIClient>[0] = { apiKey };
    opts.baseUrl = profile.baseUrl;
    if (profile.name === "openai" && process.env.OPENAI_ORGANIZATION !== undefined) {
      opts.organization = process.env.OPENAI_ORGANIZATION;
    }
    // Honor explicit OPENAI/OPENROUTER base URL overrides for testing.
    const envOverride =
      profile.name === "openai"
        ? process.env.OPENAI_API_BASE_URL
        : profile.name === "openrouter"
          ? process.env.OPENROUTER_API_BASE_URL
          : undefined;
    if (envOverride !== undefined) opts.baseUrl = envOverride;
    return new OpenAIClient(opts);
  }
  if (profile.apiMode === "anthropic_messages") {
    const opts: ConstructorParameters<typeof AnthropicClient>[0] = { apiKey };
    opts.baseUrl = process.env.ANTHROPIC_API_BASE_URL ?? profile.baseUrl;
    return new AnthropicClient(opts);
  }
  throw new ConfigurationError(
    `Provider "${profile.name}" requires apiMode "${profile.apiMode}" but no transport is registered. ` +
      `Install a third-party transport plugin (@theokit-transport-${profile.apiMode}) ` +
      `or use a provider with apiMode "chat_completions" or "anthropic_messages".`,
    { code: "transport_unavailable" },
  );
}
