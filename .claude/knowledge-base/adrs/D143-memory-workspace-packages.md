# D143 — Each adapter is a separate workspace package

**Date:** 2026-05-20
**Status:** Accepted

## Decision

Each third-party memory adapter is a workspace package under
`packages/memory-{name}` published as `@usetheo/memory-{name}` —
NOT a subpath export of `@usetheo/sdk` (NOT `@usetheo/sdk/memory/honcho`).

Shipped:
- `@usetheo/memory-supermemory`
- `@usetheo/memory-honcho`
- `@usetheo/memory-mem0`

(Original plan text said `@theokit-memory-*` but that violates npm
scope syntax — scopes require `@scope/name`. Per locked names in
`CLAUDE.md` the project uses `@usetheo/` as the canonical scope.)

## Rationale

- **Independent versioning per adapter.** A bug in Supermemory ≠
  blocked release for Honcho.
- **Consumers pay for what they use.** `pnpm i @usetheo/memory-honcho`
  adds ~10KB; `mem0ai`'s 18 transitive peers stay out of `@usetheo/sdk`'s
  install graph for consumers who never use Mem0.
- **License isolation.** Honcho's AGPL-3.0 self-host implications stay
  in the adapter's README; the MIT/Apache core SDK is unaffected.

## Consequences

- **Enables:** clean dep boundaries; cancel-friendly (drop adapter →
  drop dep); per-adapter publish lanes; per-adapter changelogs.
- **Constrains:** 3 new workspace members = 3 publish steps; consumers
  must install one peer dep per adapter they use.
