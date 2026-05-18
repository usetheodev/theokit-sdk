# ADR D66 — `ErrorCode` is a finite TypeScript literal union, not a free-form string

Date: 2026-05-18
Status: Accepted
Plan: [error-context-surfacing](../plans/error-context-surfacing-plan.md)

## Decision

`ErrorCode` is a literal union exposing exactly ten variants:

```typescript
export type ErrorCode =
  | "rate_limit"
  | "auth_failed"
  | "invalid_request"
  | "timeout"
  | "server_error"
  | "context_too_long"
  | "content_filtered"
  | "model_unavailable"
  | "network"
  | "unknown";
```

The `metadata.code` field on `ErrorMetadata` (from D65) is typed as
`ErrorCode`. Free-form codes still exist on `TheokitAgentError.code`
(the older string field used by legacy callers — e.g.,
`"anthropic_http_error"`, `"openai_rate_limit"`) for backward compat,
but the canonical machine-readable category is `metadata.code`.

## Rationale

- A literal union enables exhaustive `switch` checks at consumer code.
  TypeScript's `case _: never` pattern catches missing branches at
  compile time. Free-form strings drift between releases — every call
  site invents its own convention, and consumers ship `if
  (message.includes("rate"))` checks that rot the moment the message
  rephrases.
- Hermes ships ~10 distinct provider-error semantic categories (rate
  limit, auth, context length, content policy, server, etc.). The ten
  variants here cover those plus the SDK-side concerns (timeout,
  network, unknown).
- Adding a new variant is an explicit choice: expand the union, add
  test coverage for the new branch, document in the public type. This
  is the right friction.

## Alternatives considered

- **Free-form `code: string`** (status quo, rejected for canonical
  field): we keep it on the legacy `code` field for backward compat,
  but the canonical machine-readable code lives in `metadata.code` as
  the literal union.
- **HTTP status code alone** (`statusCode: 429`): not enough — 400
  covers context_too_long, content_filtered, and invalid_request which
  callers want to handle differently.
- **Larger enum (~30+ codes)**: rejected — too many to ship correctly
  on day one. Start with 10 high-frequency variants, expand when usage
  justifies.

## Consequences

- Consumers do `switch (err.metadata?.code) { case "rate_limit": ... }`
  with full exhaustiveness checking.
- Each new provider that surfaces a novel error category requires
  expanding the union (explicit, traceable).
- `metadata.code` is intentionally categorical, not provider-specific
  (e.g., both Anthropic 429 and OpenAI 429 map to `"rate_limit"`). The
  provider name lives separately in `metadata.provider`.
