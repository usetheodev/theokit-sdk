import { ConfigurationError } from "../../errors.js";
import { getProviderProfile, type ProviderProfile, registerBuiltins } from "../providers/index.js";
import { AnthropicClient } from "./anthropic.js";
import { BedrockAnthropicClient } from "./bedrock-anthropic.js";
import { CredentialPool, newPooledCredential } from "./credential-pool.js";
import { currentCredentialPool } from "./credential-pool-context.js";
import type { CredentialPoolStrategy } from "./credential-pool-types.js";
import { maybeWrapWithFaultInjection } from "./fault-injection.js";
import { OllamaNativeClient } from "./ollama-native.js";
import { OpenAIClient } from "./openai.js";
import { PoolAwareLlmClient } from "./pool-aware-client.js";
import { ResponsesApiClient } from "./responses.js";
import type { LlmClient } from "./types.js";
import { VertexRouterClient } from "./vertex-router.js";

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
  /** Credential pools per provider (ADRs D123-D133). Optional. */
  apiKeys?: Record<string, string[]>;
  /** Pool rotation strategy per provider. Optional; default `"fill_first"`. */
  credentialPoolStrategy?: Record<string, CredentialPoolStrategy>;
  /**
   * Per-run opt-in leaked-dialect safe-parse derived from the chat route
   * (theokit#58 follow-up). When `true`, the resolved profile is cloned with
   * `extractToolCallsFromContent: true` so the OpenAI-compatible transport
   * recovers Hermes `<function=…></tool_call>` dialect leaked as text. Applied
   * to the resolved chain; fail-open, so a non-leaking provider is unaffected.
   */
  extractToolCallsFromContent?: boolean;
  /**
   * SE2 — forwarded into the pool-aware client so a 429 retry surfaces a
   * `rate_limit` RunEvent. Wired from `SendOptions.onRunEvent` at the run boundary.
   */
  onRateLimit?: (info: { attempt: number; retryAfterMs?: number }) => void;
}

/**
 * Resolves the provider chain synchronously. Builtins are eagerly registered.
 * Provider plugin discovery is expected to have run upfront (e.g., via
 * Agent.create initialization) before this is called.
 */
export function resolveProviderChain(options: ProviderRouterOptions): LlmClient[] {
  registerBuiltins();
  return buildChain(options);
}

function buildChain(options: ProviderRouterOptions): LlmClient[] {
  // EC-B: warn (once) on apiKeys entries for providers we don't recognize.
  warnUnknownProvidersInApiKeys(options.apiKeys);

  const seen = new Set<string>();
  const clients: LlmClient[] = [];
  const addClient = (name: ProviderName): void => {
    const lowered = name.toLowerCase();
    if (seen.has(lowered)) return;
    seen.add(lowered);
    const client = buildClient(lowered, options);
    // D14: wrap every resolved client with the fault-injection decorator.
    // The wrapper is a cheap noop unless `NODE_ENV=test` AND
    // `THEOKIT_TEST_RESPONSE_OVERRIDE` are both set — production is unaffected.
    if (client !== undefined) clients.push(maybeWrapWithFaultInjection(client));
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

function buildClient(name: string, routerOptions: ProviderRouterOptions): LlmClient | undefined {
  const baseProfile = getProviderProfile(name);
  if (baseProfile === undefined) return undefined;
  // theokit#58 follow-up: per-run route opt-in clones the resolved profile with
  // the leaked-dialect recovery flag so the OpenAI-compatible transport surfaces
  // Hermes `<function=…></tool_call>` calls leaked as text. Built-in profiles
  // ship the flag off; this is the per-run enablement path.
  const profile =
    routerOptions.extractToolCallsFromContent === true &&
    baseProfile.extractToolCallsFromContent !== true
      ? { ...baseProfile, extractToolCallsFromContent: true }
      : baseProfile;
  const resilience =
    routerOptions.onRateLimit !== undefined ? { onRateLimit: routerOptions.onRateLimit } : {};
  const ambient = currentCredentialPool(name);
  if (ambient !== undefined) {
    return new PoolAwareLlmClient(
      ambient,
      (apiKey) => selectTransport(profile, apiKey),
      undefined,
      resilience,
    );
  }
  const poolKeys = filterPoolKeys(routerOptions.apiKeys?.[name]);
  const noAuthOverride = maybeBuildNoAuthTransport(profile, poolKeys);
  if (noAuthOverride !== undefined) return noAuthOverride;
  return buildPoolOrSingle({ name, profile, poolKeys, routerOptions });
}

/**
 * EC-C MUST FIX (ADR D187): `authType: "none"` providers ignore apiKeys.
 * Building a CredentialPool against a runtime without auth is semantically
 * meaningless; emit one-shot warn and route to the sentinel transport.
 */
function maybeBuildNoAuthTransport(
  profile: ProviderProfile,
  poolKeys: string[] | undefined,
): LlmClient | undefined {
  if (profile.authType !== "none" || poolKeys === undefined || poolKeys.length === 0) {
    return undefined;
  }
  warnNoAuthApiKeysIgnoredOnce(profile.name);
  const sentinel = sentinelForNoAuth(profile);
  if (sentinel === undefined) return undefined;
  return selectTransport(profile, sentinel);
}

/** Pool path for ≥2 keys; single-key fast path otherwise; sentinel fallback. */
function buildPoolOrSingle(args: {
  name: string;
  profile: ProviderProfile;
  poolKeys: string[] | undefined;
  routerOptions: ProviderRouterOptions;
}): LlmClient | undefined {
  const { name, profile, poolKeys, routerOptions } = args;
  if (poolKeys !== undefined && poolKeys.length >= 2) {
    const strategy = routerOptions.credentialPoolStrategy?.[name] ?? "fill_first";
    const entries = poolKeys.map((accessToken, priority) =>
      newPooledCredential({ provider: name, accessToken, priority, source: "manual" }),
    );
    const pool = new CredentialPool(name, entries, strategy);
    const resilience =
      routerOptions.onRateLimit !== undefined ? { onRateLimit: routerOptions.onRateLimit } : {};
    return new PoolAwareLlmClient(
      pool,
      (apiKey) => selectTransport(profile, apiKey),
      undefined,
      resilience,
    );
  }
  // 1-entry pool / single-key fast path: prefer explicit apiKeys[name] over env.
  // D182: `authType: "none"` providers fall back to a sentinel placeholder
  // when no key is set — transports that ignore the Authorization header still work.
  // D286/D288: `aws_bearer` / `gcp_oauth` profiles use a lazy sentinel so the
  // client can resolve real credentials at stream time (helpful error if missing).
  const apiKey =
    poolKeys?.[0] ??
    resolveApiKey(profile.envVars) ??
    sentinelForNoAuth(profile) ??
    sentinelForLazyAuth(profile);
  if (apiKey === undefined) return undefined;
  return selectTransport(profile, apiKey);
}

function resolveBaseUrlEnvOverride(providerName: string): string | undefined {
  switch (providerName) {
    case "openai":
      return process.env.OPENAI_API_BASE_URL;
    case "openrouter":
      return process.env.OPENROUTER_API_BASE_URL;
    case "ollama":
      return process.env.OLLAMA_HOST;
    case "lmstudio":
      return process.env.LMSTUDIO_HOST;
    case "llamacpp":
      return process.env.LLAMACPP_HOST;
    default:
      return undefined;
  }
}

// EC-C: one-shot warn keyed by provider name.
const warnedNoAuthApiKeys = new Set<string>();
function warnNoAuthApiKeysIgnoredOnce(provider: string): void {
  if (warnedNoAuthApiKeys.has(provider)) return;
  warnedNoAuthApiKeys.add(provider);
  process.stderr.write(
    `[theokit-sdk] provider "${provider}" has authType: "none" — apiKeys ignored (no auth required for local runtime).\n`,
  );
}

/** Test-only reset. @internal */
export function _resetNoAuthApiKeyWarnings(): void {
  warnedNoAuthApiKeys.clear();
}

/**
 * D182: providers declaring `authType: "none"` use a placeholder credential
 * so the OpenAI-compat transport keeps working. The placeholder value is
 * never sensitive — local runtimes ignore the Authorization header.
 */
function sentinelForNoAuth(profile: ProviderProfile): string | undefined {
  return profile.authType === "none" ? profile.name : undefined;
}

/**
 * D286 / D288: providers with lazy-resolved auth (Bedrock Bearer via
 * `@aws/bedrock-token-generator`, Vertex via `google-auth-library`) may not
 * have credentials available at construction time — the client resolves
 * them per-request and throws helpful `ConfigurationError` if missing
 * (EC-1, EC-6 absorbed). Use a placeholder so the router still builds
 * the client; the user sees the helpful error on the first `agent.send`.
 */
function sentinelForLazyAuth(profile: ProviderProfile): string | undefined {
  if (profile.authType === "aws_bearer") return "__bedrock_lazy_token__";
  if (profile.authType === "gcp_oauth") return "__vertex_lazy_token__";
  return undefined;
}

function filterPoolKeys(keys: string[] | undefined): string[] | undefined {
  if (keys === undefined) return undefined;
  const cleaned = keys.filter((k) => typeof k === "string" && k.length > 0);
  return cleaned.length === 0 ? undefined : cleaned;
}

const warnedProviders = new Set<string>();
function warnUnknownProvidersInApiKeys(apiKeys: Record<string, string[]> | undefined): void {
  if (apiKeys === undefined) return;
  for (const name of Object.keys(apiKeys)) {
    if (warnedProviders.has(name)) continue;
    const profile = getProviderProfile(name);
    if (profile === undefined) {
      warnedProviders.add(name);
      process.stderr.write(
        `[theokit-sdk] credential-pool: unknown provider "${name}" in apiKeys (no profile registered)\n`,
      );
    }
  }
}

/** Test-only reset. @internal */
export function _resetCredentialPoolWarnings(): void {
  warnedProviders.clear();
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
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 4-mode transport ladder (chat_completions / anthropic_messages / responses_api / bedrock) + Ollama native dispatch (D191) + per-provider envOverride is one cohesive switch — splitting hurts readability and obscures the dispatch contract.
function selectTransport(profile: ProviderProfile, apiKey: string): LlmClient {
  if (profile.apiMode === "chat_completions") {
    // ADR D191 (T8.1 dogfood fix): Ollama tool calling REQUIRES the native
    // `/api/chat` endpoint. OpenAI-compat `/v1/chat/completions` causes
    // models to emit raw tool JSON as plain text — confirmed via peer-project
    // upstream warning and our own dogfood of telegram-pro.
    if (profile.name === "ollama") {
      const ollamaBase = process.env.OLLAMA_HOST ?? profile.baseUrl;
      return new OllamaNativeClient({ apiKey, baseUrl: ollamaBase });
    }
    const opts: ConstructorParameters<typeof OpenAIClient>[0] = { apiKey };
    opts.baseUrl = profile.baseUrl;
    // T1.1 (ADR D185): forward provider name so OpenAIClient can dispatch
    // Ollama-specific error mapping for ECONNREFUSED / 404-not-pulled / 503-loading.
    opts.providerName = profile.name;
    // theokit#58 follow-up: opt-in leaked-dialect safe-parse, declared per-profile (default off).
    if (profile.extractToolCallsFromContent === true) {
      opts.extractToolCallsFromContent = true;
    }
    if (profile.name === "openai" && process.env.OPENAI_ORGANIZATION !== undefined) {
      opts.organization = process.env.OPENAI_ORGANIZATION;
    }
    // Honor explicit base URL overrides for cloud providers + the local
    // `authType: "none"` family (D182, D188, D189). All four `_HOST` /
    // `_API_BASE_URL` vars are intentionally separate so users can mix
    // remote-box pointing without disturbing the others.
    const envOverride = resolveBaseUrlEnvOverride(profile.name);
    if (envOverride !== undefined) opts.baseUrl = envOverride;
    return new OpenAIClient(opts);
  }
  if (profile.apiMode === "anthropic_messages") {
    // Vertex sub-dispatch (D301): when profile.name === "vertex", route to
    // VertexRouterClient which picks Gemini vs Anthropic at stream time.
    // apiKey is either a real Bearer token (rare — caller passed it
    // explicitly) or the lazy sentinel `__vertex_lazy_token__` — strip
    // the latter so the client falls through to ADC discovery (D288).
    if (profile.name === "vertex") {
      const realKey = apiKey === "__vertex_lazy_token__" ? undefined : apiKey;
      return new VertexRouterClient(realKey !== undefined ? { apiKey: realKey } : {});
    }
    const opts: ConstructorParameters<typeof AnthropicClient>[0] = { apiKey };
    opts.baseUrl = process.env.ANTHROPIC_API_BASE_URL ?? profile.baseUrl;
    return new AnthropicClient(opts);
  }
  if (profile.apiMode === "bedrock_anthropic") {
    // D301: dedicated Bedrock InvokeModel client. apiKey from env when set;
    // strip the lazy sentinel so client triggers @aws/bedrock-token-generator (D287).
    const realKey = apiKey === "__bedrock_lazy_token__" ? undefined : apiKey;
    return new BedrockAnthropicClient(realKey !== undefined ? { apiKey: realKey } : {});
  }
  if (profile.apiMode === "responses_api") {
    // M40 (agent-builder) — the OpenAI Responses-API transport (ChatGPT Codex backend + any responses
    // provider). Consumes `baseUrl` + `extraHeaders` from the profile (their first consumer). Was an
    // unimplemented apiMode that threw below; now a first-class transport.
    return new ResponsesApiClient({
      apiKey,
      ...(profile.baseUrl !== undefined ? { baseUrl: profile.baseUrl } : {}),
      ...(profile.extraHeaders !== undefined ? { extraHeaders: profile.extraHeaders } : {}),
      providerName: profile.name,
    });
  }
  throw new ConfigurationError(
    `Provider "${profile.name}" requires apiMode "${profile.apiMode}" but no transport is registered. ` +
      `Install a third-party transport plugin (@theokit-transport-${profile.apiMode}) ` +
      `or use a provider with apiMode "chat_completions" or "anthropic_messages".`,
    { code: "transport_unavailable" },
  );
}
