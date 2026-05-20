# D158 — Backward compat: `.theokit/context/*.md` Zod frontmatter sources

**Date:** 2026-05-20
**Status:** Accepted

## Decision

Existing `.theokit/context/*.md` (Zod frontmatter per D10/D76) sources
keep working unchanged. They are loaded via the existing
`loadContextConfig` path with `parser: "frontmatter-zod"`, then fed
into the aggregator alongside the new multi-format sources. Legacy
`.theokit/context.json` also keeps its one-time deprecation warning AND
loads content (EC-K — verified via regression test).

In the priority order, they sit at **priority 50** (right above
`.theokit/THEO.md` at 60).

## Rationale

We have at least one example in-tree (`telegram-pro/.theokit/context/
bot-readme.md`) and likely third-party SDK users. Breaking them would
be a SemVer major bump for no reason. The frontmatter pattern is still
useful for power users (per-source `enabled: false`, `maxTokens`
override).

## Consequences

- **Enables:** zero migration friction; users adopt new format
  incrementally.
- **Constrains:** two parallel loading code paths in the context manager
  — but cleanly separated by `parser` field on the spec.
