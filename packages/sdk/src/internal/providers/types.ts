/**
 * ProviderProfile + ApiMode types (T3.1, ADR D105).
 *
 * Profile is **data-only** — no methods. Adding a provider is declaring an
 * object literal; the Transport layer (D106) consumes `apiMode` to pick
 * the HTTP dialect.
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
  bodyOverrides?: Record<string, unknown>;
  /**
   * Opt-in leaked-dialect safe-parse (theokit#58 follow-up). When `true`, a chat_completions finish
   * with ZERO native `tool_calls` has its assistant content scanned for the Hermes
   * `<function=…></tool_call>` dialect and any recovered calls are surfaced as real `tool_calls`.
   * Default off — only enable for routes/models known to leak (e.g. a qwen3-coder profile variant).
   */
  extractToolCallsFromContent?: boolean;
}
