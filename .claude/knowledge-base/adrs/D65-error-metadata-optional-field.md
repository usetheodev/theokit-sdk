# ADR D65 — `ErrorMetadata` is an optional field on the existing base class

Date: 2026-05-18
Status: Accepted
Plan: [error-context-surfacing](../plans/error-context-surfacing-plan.md)

## Decision

Add `metadata?: ErrorMetadata` as an optional field on `TheokitAgentError`'s
constructor options. Subclasses (`AuthenticationError`, `RateLimitError`,
`ConfigurationError`, `IntegrationNotConnectedError`, `NetworkError`,
`UnknownAgentError`, `UnsupportedRunOperationError`) inherit the field via
the base class — no separate `ProviderError` hierarchy is introduced.

The `ErrorMetadata` interface carries `{ provider, endpoint, code,
statusCode?, retryAfter?, raw? }`. It is populated only when the error
originates from a provider HTTP call (via the mappers from D67); errors
that don't have an HTTP origin (e.g., `UnsupportedRunOperationError`,
config-time validation) leave `metadata` undefined.

## Rationale

- The SDK already has 7 typed error classes with semantics callers depend
  on (`AuthenticationError`, `RateLimitError`, etc.). Introducing a parallel
  `ProviderError` hierarchy would force consumers to learn two parallel
  taxonomies and break `instanceof` checks they already have.
- Extending the existing classes with optional metadata preserves backward
  compatibility (existing callers continue to work; new callers opt into
  reading `err.metadata`).
- The pick `sdk-references/error-context-surfacing.md` suggests `ProviderError`
  but that pattern is shaped by Hermes' Python design. In TypeScript, where
  the existing hierarchy is already discriminated by subclass, additive
  metadata is the cleaner translation.

## Alternatives considered

- **New `ProviderError` class hierarchy** (rejected): doubles the surface,
  breaks `instanceof` checks, makes consumers handle "is it the network
  variant or the provider variant?" for the same semantic case.
- **Metadata as a separate sidecar map keyed by error instance** (rejected):
  pollutes module state, breaks across realms / structured clone.

## Consequences

- Callers that already do `if (err instanceof RateLimitError)` continue to
  work; they gain the ability to also read `err.metadata?.retryAfter`.
- Callers using `instanceof TheokitAgentError` (the base class) are
  fully forward-compatible.
- `metadata` is `undefined` for errors not from HTTP origin — callers must
  null-check before reading (TS narrowing helps).
- Adding new fields to `ErrorMetadata` over time is non-breaking as long
  as they remain optional.
