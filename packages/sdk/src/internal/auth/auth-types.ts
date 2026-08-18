/**
 * M42 — shared auth contract types. A LEAF module: pure type declarations, NO runtime imports (no zod, no
 * node:fs). Every auth module (`credential-store`, `oauth-engine`, `oauth-device`, `resolve-credential`)
 * imports its cross-module types from here so the barrel's rollup-plugin-dts bundle sees a single canonical
 * origin — the codebase's established "leaf-type-only deps" pattern (see tsup.config.ts), which sidesteps
 * the rollup-dts cross-module resolution limitation that a value-module type export trips.
 *
 * @internal (re-exported from the package barrel as public)
 */

/**
 * Where the credential store lives. `homeEnvVar`, when set and present in `env`, overrides the whole
 * directory (mirroring Codex's `CODEX_HOME`). `env` is always a PARAMETER — no ambient reads.
 */
export interface CredentialStoreConfig {
  /** Base home directory (e.g. `os.homedir()`). */
  home: string;
  /** The store subdirectory under `home` (e.g. `.agent-builder`, `.codex`). */
  dirName: string;
  /** The credential file name inside the store dir (e.g. `auth.json`). */
  fileName: string;
  /** Optional env var name that, when set + non-blank, overrides the full store dir. */
  homeEnvVar?: string;
}

/**
 * The flat bearer surface every consumer holds. `kind:'api'` is the classic API-key path; `kind:'oauth'` is
 * an OAuth session whose `apiKey` is the CURRENT access token, so consumers keep passing a flat bearer
 * string unchanged. `provider` is an open string (any registered provider name).
 */
export interface ResolvedCredential {
  kind: "api" | "oauth";
  provider: string;
  /** The effective BEARER the transport sends — an API key, or (oauth) the current access token. */
  apiKey: string;
  /** Where it came from — an env var NAME or a file path. Never the value. */
  source: string;
  /** True when the provider was derived rather than declared. */
  inferred: boolean;
  /** oauth only: epoch ms the access token expires. Drives the refresh in the oauth engine. */
  expiresAt?: number;
}

export interface StoredApiCredential {
  type?: "api";
  provider?: string;
  api_key: string;
}

export interface StoredOAuthCredential {
  type: "oauth";
  provider: string;
  access: string;
  refresh: string;
  /** Epoch ms the access token expires. */
  expires: number;
  account_id?: string;
}

export type StoredCredential = StoredApiCredential | StoredOAuthCredential;

/** A provider's OAuth endpoints + client identity. Passed in (provider-agnostic). */
export interface OAuthProviderConfig {
  provider: string;
  authorizeEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  scopes: readonly string[];
  redirectUri: string;
}

/** The token triple persisted to the store's oauth variant. */
export interface OAuthTokens {
  access: string;
  refresh: string;
  /** Epoch ms the access token expires. */
  expires: number;
  accountId?: string;
}

/** Injected HTTP + clock effects — deterministic in tests, real in production. */
export interface HttpDeps {
  fetch: typeof fetch;
  now: () => number;
}

/** A device-grant config: the OAuth config plus the RFC 8628 device authorization endpoint. */
export interface DeviceOAuthConfig extends OAuthProviderConfig {
  /** RFC 8628 device authorization endpoint — returns device_code + user_code + verification_uri. */
  deviceCodeEndpoint: string;
}

/** The device authorization the user acts on. Times/interval are SECONDS (RFC 8628). */
export interface DeviceCodeGrant {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Seconds between token polls (server-mandated minimum). */
  interval: number;
  /** Seconds until the device_code expires. */
  expiresIn: number;
}

/** Injected effects for the device flow — deterministic in tests, real in production. */
export interface DeviceDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/** The OpenAI two-step device config: usercode + poll endpoints return an authorization_code (not tokens). */
export interface OpenAIDeviceConfig extends OAuthProviderConfig {
  /** POST `{client_id}` here → `{device_auth_id, user_code, interval}`. */
  deviceUsercodeEndpoint: string;
  /** Poll `{device_auth_id, user_code}` here → 200 `{authorization_code, code_verifier}`; 403/404 = pending. */
  devicePollEndpoint: string;
  /** Verification URL the user opens to enter the code. */
  verificationUri: string;
}
