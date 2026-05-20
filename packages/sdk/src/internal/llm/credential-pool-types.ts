/**
 * Types for the credential pool subsystem (ADRs D123-D133).
 *
 * Pool a developer's multiple API keys for the SAME provider so the SDK
 * can rotate transparently on HTTP 429/402/401 instead of jumping
 * straight to a different provider via `FallbackLlmClient`.
 *
 * @internal
 */

/**
 * Rotation strategy when picking the next credential from a pool.
 *
 * - `fill_first` (default): use entries[0] until exhausted, then [1]…
 * - `round_robin`: rotate after each `select()`
 * - `least_used`: pick the entry with the lowest `requestCount`
 * - `random`: random pick among healthy entries
 *
 * Closed enum per ADR D124 — adding a strategy is an explicit semver
 * minor that updates `selectByStrategy` exhaustively.
 *
 * @internal
 */
export type CredentialPoolStrategy = "fill_first" | "round_robin" | "least_used" | "random";

/** Health flag tracked per credential. */
export type CredentialStatus = "ok" | "exhausted";

/**
 * Provenance of a credential — where it came from when seeded.
 * Free-form string; conventional prefixes:
 *
 * - `env:<VAR_NAME>` — auto-discovered from environment variable
 * - `manual` — added via explicit `apiKeys` config
 * - `explicit-apikey` — wrapped from `AgentOptions.apiKey` single-key path (D132)
 */
export type CredentialSource = string;

/**
 * Single credential entry inside a {@link CredentialPool}.
 *
 * `accessToken` is the sensitive field — must never be logged unredacted.
 * The lint gate `tests/lint/no-unredacted-pool-token.test.ts` enforces this.
 *
 * @internal
 */
export interface PooledCredential {
  /** Stable identifier (uuid v4) for log lines + telemetry. */
  id: string;
  /** Human-readable label for `Theokit.credentialPool.list()`. */
  label: string;
  /** Provider name (matches `ProviderProfile.name`). */
  provider: string;
  /** Sort key; lower = earlier in fill_first. Unique within a pool. */
  priority: number;
  /** Provenance string. */
  source: CredentialSource;
  /** Sensitive API key. NEVER LOG UNREDACTED. */
  accessToken: string;
  /** Current health. */
  lastStatus: CredentialStatus;
  /** Epoch ms of the last status change. */
  lastStatusAt: number | undefined;
  /** HTTP code that caused exhaustion (401/402/429). */
  lastErrorCode: number | undefined;
  /** Provider-supplied "retry after this epoch ms" hint. Overrides cooldown defaults. */
  lastErrorResetAt: number | undefined;
  /** Bumped per successful `select()` for `least_used` strategy. Lazy-persisted. */
  requestCount: number;
}

/**
 * Serializable snapshot of a single provider's pool. Used by the
 * persistence layer (T2.1) to read/write `~/.theokit/credential-pool.json`.
 *
 * @internal
 */
export interface CredentialPoolSnapshot {
  provider: string;
  strategy: CredentialPoolStrategy;
  entries: PooledCredential[];
}

/**
 * Cooldown ladder by HTTP error code (ADR D125). Provider-supplied
 * `lastErrorResetAt` overrides these defaults when present.
 *
 * @internal
 */
export const COOLDOWN_MS: Readonly<Record<number, number>> = {
  401: 5 * 60 * 1000, // 5 minutes — OAuth refresh can recover quickly
  402: 60 * 60 * 1000, // 1 hour — billing quota typically hourly+
  429: 60 * 60 * 1000, // 1 hour — daily-rate-limit windows
};

/** Default cooldown when no specific code matches. */
export const DEFAULT_COOLDOWN_MS = 60 * 60 * 1000;
