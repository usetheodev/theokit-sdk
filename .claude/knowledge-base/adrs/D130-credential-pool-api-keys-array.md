# D130 — Public API: `ProviderRoutingSettings.apiKeys: Record<string, string[]>`

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`ProviderRoutingSettings` (already on `AgentOptions.providers`) gains:
- `apiKeys?: Record<string, string[]>` — per-provider list of keys
- `credentialPoolStrategy?: Record<string, CredentialPoolStrategy>` — per-provider rotation strategy

Single-key shape `AgentOptions.apiKey: string` continues to work unchanged; the two cannot coexist (D132 ambiguity check).

## Rationale

`ProviderRoutingSettings` already holds `routes` and `fallback` — pool config lives alongside the existing routing concerns. Single source of truth keeps the consumer mental model coherent. Map keyed by provider name allows incremental adoption (only pool the providers you have multiple keys for).

## Consequences

- **Enables:** Type-safe `{ apiKeys: { openrouter: ["k1", "k2"] } }`; existing v1.x callers see no breaking change.
- **Constrains:** `apiKey` + `apiKeys[provider]` together throws `ConfigurationError(code: "credential_pool_ambiguous")` — caller picks one shape.
