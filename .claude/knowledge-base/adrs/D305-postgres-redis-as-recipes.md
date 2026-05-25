# D305 — Postgres + Redis adapters as `docs/recipes/`, NOT in `@usetheo/sdk`

**Status:** Accepted
**Date:** 2026-05-25
**Related:** Production-Readiness plan Phase 1, T1.6

## Decision

`PostgresConversationStorage` and `RedisConversationStorage` are documented as copy-paste templates in `docs/recipes/`, not shipped as classes in `@usetheo/sdk` or as separate `@usetheo/storage-*` packages.

## Rationale

- **SDK bundle stays light.** `pg` (~500KB Node prepared statement infra) and `ioredis` (~300KB) are non-trivial peer-dep weight for a feature only ~30% of consumers need (self-hosted Node single-VPS continues with default FS).
- **Adapters are 30-50 lines.** Trivial enough that copy-paste is cheaper than maintaining 2 more workspace packages.
- **Cross-platform variants.** Each backend has 2 flavors (Node + Edge: `pg`/`@neondatabase/serverless`, `ioredis`/`@upstash/redis`). Maintaining 4 workspace packages for the same conceptual feature would be paperwork.
- **Pattern matches industry.** Vercel AI SDK ships storage adapters in `examples/`, not in core. LangChain has the same split (langchain-pg-checkpoint as separate package, but they need it for LangSmith integration; SDK doesn't).

## Alternatives considered

- **In-core classes** — rejected. Bundle weight + dep surface unjustified for 30% of users.
- **Separate `@usetheo/storage-postgres` + `@usetheo/storage-redis` workspace packages** — rejected. Same number of packages would need to ship for Edge variants (4 total). Maintenance overhead disproportionate to value. Recipe pattern is simpler.

## Consequences

- TheoKit and consumers needing typed Postgres/Redis adapter copy the template into their codebase.
- SDK CI does NOT integration-test Postgres/Redis paths (deferred to consumer integration tests).
- Trade-off: typed adapter copy can drift from interface changes. Mitigation: interface is stable (5 methods); changes require major bump anyway.
