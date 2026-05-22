# D262 — Telemetry via existing OTel seam: spans `cache.lookup`, `cache.hit`, `cache.miss`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Lazy load `@opentelemetry/api` via `createRequire` (pattern D34/D206/D220/D241). Spans:
- `cache.lookup` (root per `pre_user_send`) — attributes: `cache.namespace`, `cache.embedder_id`, `cache.kv_matched`, `cache.semantic_matched`, `cache.distance`, `cache.ttl_remaining_s`.
- Events `cache.hit.kv`, `cache.hit.semantic`, `cache.miss` on the lookup span.

## Rationale

Users without OTel pay zero cost (no-op). Pattern validated in 4 prior features. Downstream metrics dashboards can plot hit rate without parsing.

## Consequences

- Tests use noop tracer.
- Attributes JSON-primitive only.
- Spans always end in `finally` (EC-5).
