# D104 — `Toolset` is a flat list; no `extends` field

**Date:** 2026-05-19
**Status:** Accepted

## Decision

`Toolset` declares its tools as an explicit flat list. No
`extends: "other-toolset"` composition.

EC-7: duplicates in `tools` are preserved (caller dedup responsibility).
The same `ToolEntry` ref appearing twice is idempotent in downstream
filters.

## Rationale

Toolset inheritance causes ambiguity ("A extends B; B extends C; what
is A's effective set?") and override semantics that hide intent. Hermes
explicitly uses flat lists (`_HERMES_CORE_TOOLS = [...]`). Each toolset
declaring its complete catalog is clearer than chasing extension chains.

## Consequences

- **Enables:** read `Toolset.tools` → know exactly what's exposed.
- **Constrains:** duplication when 2 toolsets share 5 tools — accepted
  trade-off (clarity > DRY for ≤8-tool sets).
