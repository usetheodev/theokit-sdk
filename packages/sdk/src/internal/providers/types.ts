/**
 * ProviderProfile + ApiMode types (T3.1, ADR D105).
 *
 * Profile is **data-only** — no methods. Adding a provider is declaring an
 * object literal; the Transport layer (D106) consumes `apiMode` to pick
 * the HTTP dialect.
 *
 * @public
 */

export type ApiMode = "chat_completions" | "anthropic_messages" | "responses_api" | "bedrock";

export type AuthType = "api_key" | "oauth_device_code" | "oauth_external" | "aws_sdk";

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
}
