# D148 — `@usetheo/memory-mem0` ships cloud client only

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`@usetheo/memory-mem0` wraps `mem0ai` `MemoryClient` (cloud) only.
The OSS local mode (Qdrant / pgvector / Pinecone / Chroma / etc. with
local LLM) is NOT supported. Users wanting local memory use
`@usetheo/sdk`'s built-in Memory + Active Memory subsystems instead.

## Rationale

1. The OSS local mode duplicates work already shipped in `@usetheo/sdk`
   (Active Memory subagent D13, Lance backend D43).
2. Mem0 OSS pulls 18 peer deps (Qdrant, Pinecone, pgvector, better-
   sqlite3, etc.) — fights the SDK's "no surprise deps" posture.
3. **Security:** CVSS 8.1 SQL/Cypher injection (2026-04-17) affects
   OSS PGVector/MySQL/Neptune backends. Not shipping the OSS path
   keeps users away from this surface and lets the README disclose
   the issue without offering a vulnerable path.
4. Cloud-only keeps the adapter ~250 LoC (no backend config parsing,
   no embedding adapter selection, no LLM config plumbing).

## Consequences

- **Enables:** Mem0 adapter as a thin HTTP wrapper; cleaner type
  story; lighter peer-dep graph.
- **Constrains:** local-only / air-gapped consumers cannot use this
  adapter. They use `@usetheo/sdk`'s built-in memory — which is the
  recommended path regardless.
