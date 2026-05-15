import { ConfigurationError } from "../../errors.js";
import { AnthropicClient } from "./anthropic.js";
import { OpenAIClient } from "./openai.js";
import type { LlmClient } from "./types.js";

/**
 * Provider router. Resolves a concrete `LlmClient` from environment
 * variables for the named provider. Supports `anthropic` and `openai`; the
 * fallback chain in `providers.fallback` is honoured by callers that
 * iterate `resolveProviderChain`.
 *
 * @internal
 */

export type ProviderName = "anthropic" | "openai" | "openrouter" | (string & {});

export interface ProviderRouterOptions {
  primary: ProviderName;
  fallback?: ProviderName[];
}

export function resolveProviderChain(options: ProviderRouterOptions): LlmClient[] {
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
      `No provider client could be resolved (primary=${options.primary}). Set ANTHROPIC_API_KEY or OPENAI_API_KEY.`,
      { code: "provider_unresolved" },
    );
  }
  return clients;
}

function buildClient(name: string): LlmClient | undefined {
  if (name === "anthropic") return buildAnthropicFromEnv();
  if (name === "openai" || name === "openrouter") return buildOpenAILikeFromEnv(name);
  return undefined;
}

function buildAnthropicFromEnv(): LlmClient | undefined {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) return undefined;
  const opts: ConstructorParameters<typeof AnthropicClient>[0] = { apiKey };
  if (process.env.ANTHROPIC_API_BASE_URL !== undefined) {
    opts.baseUrl = process.env.ANTHROPIC_API_BASE_URL;
  }
  return new AnthropicClient(opts);
}

function buildOpenAILikeFromEnv(name: "openai" | "openrouter"): LlmClient | undefined {
  const apiKey =
    name === "openrouter"
      ? (process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY)
      : process.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) return undefined;
  const baseUrl =
    name === "openrouter"
      ? (process.env.OPENROUTER_API_BASE_URL ?? "https://openrouter.ai/api")
      : process.env.OPENAI_API_BASE_URL;
  const opts: ConstructorParameters<typeof OpenAIClient>[0] = { apiKey };
  if (baseUrl !== undefined) opts.baseUrl = baseUrl;
  if (process.env.OPENAI_ORGANIZATION !== undefined) {
    opts.organization = process.env.OPENAI_ORGANIZATION;
  }
  return new OpenAIClient(opts);
}
