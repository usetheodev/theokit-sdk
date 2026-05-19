# D105 — `ProviderProfile` is a data-only interface, not an ABC

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D106, D107

## Decision

`ProviderProfile` is a TypeScript interface containing data fields only
(no methods). Provider plugins declare profiles as object literals,
not class instances.

```typescript
export const MISTRAL_PROFILE: ProviderProfile = {
  name: "mistral",
  apiMode: "chat_completions",
  envVars: ["MISTRAL_API_KEY"],
  authType: "api_key",
  baseUrl: "https://api.mistral.ai",
  fallbackModels: ["mistral-large"],
};
```

## Rationale

Hermes V1.3 originally tried "ProviderPlugin is ABC" (PR #14424). The
salvage (PR #20324) replaced it with data-only because 90% of providers
differ only in URL + env_vars + fallback_models. ABC forces a new class
per provider — overkill.

## Consequences

- **Enables:** declaring a provider is ~10 lines of object literal.
- **Constrains:** providers with complex auth (OAuth device flow) need
  the `authType` field PLUS a handler resolver in the transport layer
  (not a method on the profile).
