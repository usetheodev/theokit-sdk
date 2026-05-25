# D311 — `AgentRunErrorCode` is a discriminated union with `(string & {})` escape hatch

**Status:** Accepted
**Date:** 2026-05-25
**Related:** Production-Readiness plan Phase 3, T3.1

## Decision

`AgentRunError.code` is typed as `AgentRunErrorCode`, a superset of `ErrorCode` plus 6 codes that do NOT originate from a provider HTTP response:

- `quota_exceeded` — billing limit
- `tool_runtime_error` — custom tool handler threw
- `aborted` — `AbortSignal` fired
- `invalid_model` — model id rejected
- `safety_blocked` — provider safety filter
- `provider_unreachable` — DNS/TCP/timeout/5xx

The union ends with `(string & {})` — TypeScript trick that keeps literal-union autocomplete while accepting any string. Legacy callers passing `code: "anthropic_auth_failed"` (provider-prefixed) keep working.

## Rationale

**Discrimination is the point.** Without finite codes, every consumer falls back to string match against `.message` — fragile, locale-dependent, brittle to provider copy changes.

**Why not just expand `ErrorCode`?** `ErrorCode` is the mapping target for provider HTTP statuses (D66). Mixing in `aborted`, `tool_runtime_error` (non-HTTP origins) would confuse the mappers' semantics. Keep `ErrorCode` HTTP-pure; `AgentRunErrorCode` is the surface consumer code branches on.

**The `& {}` escape hatch.** Forward-compatible: future codes added to `AgentRunErrorCode` don't break callers passing arbitrary strings. Removes brittle `code as string` casts.

## Alternatives considered

- **Drop the escape hatch (strict union only)** — rejected. Breaks legacy `code: "openai_rate_limit"` (provider-prefixed convention).
- **Replace `ErrorCode` entirely with `AgentRunErrorCode`** — rejected. Mappers use ErrorCode as the HTTP→canonical step; widening would force HTTP mappers to handle abort/tool codes (nonsensical).

## Consequences

- Consumers writing exhaustive `switch (err.code)` get autocomplete coverage for the 16 known codes.
- The `default` case in `switch` is unavoidable because of `(string & {})` — TypeScript can't narrow.
- Documentation calls this out: "always include `default:`".
