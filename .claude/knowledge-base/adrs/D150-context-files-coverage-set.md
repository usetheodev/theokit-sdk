# D150 — Context files coverage set (2026 standard)

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`FileContextManager` auto-discovers, in priority order: `AGENTS.md`,
`GEMINI.md`, `CLAUDE.md`, `.cursor/rules/*.mdc`, `.theokit/context/*.md`
(legacy), and `.theokit/THEO.md`. **Skips** `SOUL.md`, `.hermes.md`,
`.cursorrules` (deprecated by Cursor), `JULES.md`, `CONVENTIONS.md`.

## Rationale

- **AGENTS.md** is the 2026 anchor: 60k+ repos, Linux-Foundation-stewarded,
  supported by every major coding agent.
- **CLAUDE.md / GEMINI.md** cover major vendor users.
- **`.cursor/rules/*.mdc`** is Cursor's current format; legacy `.cursorrules`
  is silently ignored by Cursor itself in Agent mode.
- **SOUL.md** is wrong axis (identity, not project context). `.hermes.md`
  has zero adoption beyond Hermes. Adding them adds discovery cost
  without interop signal.

## Consequences

- **Enables:** interop with the 2026 standard set; AGENTS.md repos
  "just work" with Theo.
- **Constrains:** Hermes-specific users must manually configure
  `.hermes.md` discovery via `ContextSettings.discoverySpecs` override;
  documented as a non-goal of the default registry.
