# D143 — Each adapter is a separate workspace package

**Date:** 2026-05-20
**Status:** Accepted

## Decision

Each third-party memory adapter is a workspace package under
`packages/memory-{name}` published as `@theokit/memory-{name}` —
NOT a subpath export of `@theokit/sdk` (NOT `@theokit/sdk/memory/honcho`).

Shipped:
- `@theokit/memory-supermemory`
- `@theokit/memory-honcho`
- `@theokit/memory-mem0`

(Original plan text said `@theokit-memory-*` but that violates npm
scope syntax — scopes require `@scope/name`. Per locked names in
`CLAUDE.md` the project uses `@theokit/` as the canonical scope.)

## Rationale

- **Independent versioning per adapter.** A bug in Supermemory ≠
  blocked release for Honcho.
- **Consumers pay for what they use.** `pnpm i @theokit/memory-honcho`
  adds ~10KB; `mem0ai`'s 18 transitive peers stay out of `@theokit/sdk`'s
  install graph for consumers who never use Mem0.
- **License isolation.** Honcho's AGPL-3.0 self-host implications stay
  in the adapter's README; the MIT/Apache core SDK is unaffected.

## Consequences

- **Enables:** clean dep boundaries; cancel-friendly (drop adapter →
  drop dep); per-adapter publish lanes; per-adapter changelogs.
- **Constrains:** 3 new workspace members = 3 publish steps; consumers
  must install one peer dep per adapter they use.
