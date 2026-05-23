# D300 — Error mapping per dialect (D67 pattern)

**Date:** 2026-05-23
**Status:** Accepted

## Decision

New files `internal/errors/mappers/bedrock.ts` and `internal/errors/mappers/vertex.ts`. They map HTTP status + response body → canonical `TheokitAgentError` subclasses with `provider` field and error codes (`bedrock_throttle`, `bedrock_validation`, `vertex_quota`, `vertex_permission`, etc).

## Rationale

Bedrock returns `{ message: string, __type: "ThrottlingException" }`; Vertex returns `{ error: { code, status, message } }`. Generic error handling loses the context downstream services need for retry decisions.

## Consequences

- Tests cover 5-7 canonical codes per dialect.
- `DeliveryRouter` / credential pool can react to `rate_limit` / `auth_error` codes uniformly.
