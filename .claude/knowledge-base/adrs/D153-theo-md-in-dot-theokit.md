# D153 — `THEO.md` lives at `.theokit/THEO.md`, NOT repo root

**Date:** 2026-05-20
**Status:** Accepted

## Decision

The SDK-specific override file lives at `.theokit/THEO.md`. NOT at
repo root.

## Rationale

Root pollution is a real complaint (Cursor's `.cursorrules` deprecation
was partly motivated by this). `.theokit/` is already the canonical
SDK config dir (`.theokit/mcp.json`, `.theokit/plugins/`,
`.theokit/context/`, `.theokit/skills/`). Putting THEO.md inside it
costs zero visual budget. Namespace `THEO.md` is unclaimed in the
ecosystem (verified — no npm packages, no GitHub convention).

## Consequences

- **Enables:** Theo-specific overrides without root pollution.
- **Constrains:** users who want root-level discovery must symlink
  themselves; documented.
