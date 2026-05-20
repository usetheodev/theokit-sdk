# ADR D59 — `internal/persistence/` is the home for cross-cutting state primitives

Date: 2026-05-18
Status: Accepted
Plan: [persistence-state-hardening](../plans/persistence-state-hardening-plan.md)

## Decision

Create `packages/sdk/src/internal/persistence/` as the single directory hosting
helpers that serve more than one subsystem (memory, runtime, cron, mcp).
Existing helpers in `internal/memory/` that are cross-cutting (`atomic-write.ts`,
`cwd-mutex.ts`) move into `persistence/`; the old `memory/` paths stay as
1-line re-export shims for backward compatibility.

## Rationale

- `atomic-write.ts` was being imported by `runtime/agent-registry-store.ts` and
  `mcp/token-storage.ts` — neither of which is a memory concern. Naming
  suggested the wrong scope.
- New persistence primitives (`paths.ts`, `file-lock.ts`, `schema-version.ts`,
  `sqlite-wal.ts`, `fts5-sanitize.ts`) need a predictable location that isn't
  confined to `memory/`.
- Re-export shims preserve every existing import path; zero breaking change.

## Consequences

- New cross-cutting helpers land in `internal/persistence/` by default.
- `internal/memory/atomic-write.ts` and `internal/memory/cwd-mutex.ts` are
  marked `@deprecated` (re-exports only) — callers should migrate to the new
  paths over time, but old paths keep working.
- Slight duplication during the migration window: two import paths point at
  the same code. Acceptable cost.
