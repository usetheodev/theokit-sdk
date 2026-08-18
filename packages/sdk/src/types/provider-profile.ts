/**
 * ProviderProfile + ApiMode + AuthType contract types (T3.1, ADR D105).
 *
 * Profile is **data-only** — no methods. Adding a provider is declaring an
 * object literal; the Transport layer (D106) consumes `apiMode` to pick
 * the HTTP dialect.
 *
 * SE45/SE46 — relocated from `internal/providers/types.ts` into `types/` so the
 * public contract (embedded in the `Plugin` type) lives above the DIP boundary;
 * `internal/providers/types.ts` re-exports these names for back-compat.
 *
 * @public
 */

export type ApiMode =
  | "chat_completions"
  | "anthropic_messages"
  | "responses_api"
  | "bedrock"
  | "bedrock_anthropic";

export type AuthType =
  | "api_key"
  | "oauth_device_code"
  | "oauth_external"
  | "aws_sdk"
  | "aws_bearer"
  | "gcp_oauth"
  | "none";

/**
 * M41 (agent-builder provider framework) — the context a provider's `transform` receives per request. An
 * object from day one so it can grow without breaking (M42 adds the resolved `credential`).
 *
 * @public
 */
export interface ProviderTransformContext {
  /** The bearer the router resolved for this request (env var, injected key, or an oauth access token). */
  apiKey: string;
}

/**
 * M41 — the one OPTIONAL behavior seam on a provider profile. It lets a provider own its per-request auth:
 * `fetch` is the universal seam (a provider that returns its own fetch fully controls headers + refresh, for
 * every transport that accepts a fetch); `headers` is a convenience merged over `extraHeaders` on transports
 * that carry them (responses_api). A provider owns its per-request auth material plus transparent token
 * refresh, expressed against theokit's transport model.
 * Closes the gap where a `ProviderProfile` could only declare STATIC headers.
 *
 * @public
 */
export interface ProviderTransform {
  /**
   * Dynamic per-request headers, merged OVER the profile's static `extraHeaders`, and spread AFTER the
   * transport's base `authorization`/`content-type`. A provider that owns its auth MAY intentionally set
   * `authorization` here to override the resolved bearer — but a stray `authorization`/`content-type` key
   * will silently replace the base header, so return only the headers you mean to add.
   */
  headers?(ctx: ProviderTransformContext): Record<string, string>;
  /** A fetch to use for this provider's requests (refresh-aware / fully provider-controlled). */
  fetch?(ctx: ProviderTransformContext): typeof fetch;
}

export interface ProviderProfile {
  name: string;
  apiMode: ApiMode;
  aliases?: ReadonlyArray<string>;
  displayName?: string;
  description?: string;
  signupUrl?: string;
  envVars: ReadonlyArray<string>;
  authType: AuthType;
  baseUrl: string;
  modelsUrl?: string;
  hostname?: string;
  fallbackModels: ReadonlyArray<string>;
  extraHeaders?: Record<string, string>;
  /**
   * M45 — explicit chat-completions path override (data-only). Absent, the transport derives it: a baseUrl
   * whose path already carries a version segment (`/v1`, `/v2beta`, …) gets `/chat/completions` appended;
   * a host-only baseUrl keeps the legacy `/v1/chat/completions`. Set this for shapes neither rule expresses
   * (e.g. Perplexity's unversioned `/chat/completions`).
   */
  chatCompletionsPath?: string;
  bodyOverrides?: Record<string, unknown>;
  /**
   * M41 — the optional per-request behavior seam (dynamic headers + refresh-aware fetch). Absent ⇒ the profile
   * is pure data and takes the static path byte-for-byte. See {@link ProviderTransform}.
   */
  transform?: ProviderTransform;
  /**
   * Opt-in leaked-dialect safe-parse (theokit#58 follow-up). When `true`, a chat_completions finish
   * with ZERO native `tool_calls` has its assistant content scanned for the Hermes
   * `<function=…></tool_call>` dialect and any recovered calls are surfaced as real `tool_calls`.
   * Default off — only enable for routes/models known to leak (e.g. a qwen3-coder profile variant).
   */
  extractToolCallsFromContent?: boolean;
}
