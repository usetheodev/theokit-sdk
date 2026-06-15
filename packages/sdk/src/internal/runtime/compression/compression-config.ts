/**
 * T2.2 step 2/N — Compression config resolution (ADR D440).
 *
 * Bridges the compression-model-registry (step 1) with the
 * `Agent.create({compression})` override surface. Resolves:
 *
 *   - Compression model (registry default OR explicit override)
 *   - API key (env → explicit → main pool fallback)
 *   - Max attempts + grace (plan defaults: cap 3, grace 1)
 *
 * Pure config resolution — no I/O, no LLM calls, no pool
 * construction. The resolved config is consumed by the aux-LLM
 * client (step 3) which builds the actual `PoolAwareLlmClient`.
 *
 * @internal
 */

import { resolveCompressionModel } from "./compression-model-registry.js";

/**
 * Consumer-facing compression options on `Agent.create`.
 *
 * @public
 */
export interface CompressionConfig {
  /** Override the auto-resolved compression model. */
  model?: string;
  /** Override the API key used for the compression LLM call. */
  apiKey?: string;
  /** Override the base URL for the compression LLM endpoint. */
  baseUrl?: string;
  /** Max compression attempts before throwing. Default: 3. */
  maxAttempts?: number;
  /** Grace calls after first ContextWindowExceeded before compressing. Default: 1. */
  grace?: number;
}

/**
 * Fully resolved compression config ready for the aux-LLM client.
 *
 * @internal
 */
export interface ResolvedCompressionConfig {
  model: string;
  apiKey: string | undefined;
  apiKeySource: "env" | "explicit" | "main-pool-fallback";
  baseUrl: string | undefined;
  maxAttempts: number;
  grace: number;
}

/**
 * Resolve compression config from the agent's model + consumer overrides.
 *
 * Key resolution chain (first-match-wins per ADR D440):
 *   1. Explicit `config.apiKey` — consumer override
 *   2. `THEOKIT_COMPRESSION_API_KEY` env var — ops override
 *   3. Undefined — signals the aux-LLM client to use the agent's
 *      main CredentialPool (dev-local zero-config path)
 *
 * Note: explicit apiKey wins over env var because the consumer chose
 * to pass it programmatically — that's a stronger signal than an env
 * var that may be set system-wide.
 *
 * @throws `CompressionModelUnresolvedError` when the agent model has
 *   no registry entry AND no explicit `config.model` override.
 *
 * @internal
 */
export function resolveCompressionConfig(
  agentModel: string,
  config: CompressionConfig,
): ResolvedCompressionConfig {
  const model = config.model ?? resolveCompressionModel(agentModel);
  const { apiKey, apiKeySource } = resolveApiKey(config);
  return {
    model,
    apiKey,
    apiKeySource,
    baseUrl: config.baseUrl,
    maxAttempts: config.maxAttempts ?? 3,
    grace: config.grace ?? 1,
  };
}

function resolveApiKey(config: CompressionConfig): {
  apiKey: string | undefined;
  apiKeySource: ResolvedCompressionConfig["apiKeySource"];
} {
  if (config.apiKey !== undefined) {
    return { apiKey: config.apiKey, apiKeySource: "explicit" };
  }
  const envKey = process.env.THEOKIT_COMPRESSION_API_KEY;
  if (envKey !== undefined && envKey.length > 0) {
    return { apiKey: envKey, apiKeySource: "env" };
  }
  return { apiKey: undefined, apiKeySource: "main-pool-fallback" };
}
