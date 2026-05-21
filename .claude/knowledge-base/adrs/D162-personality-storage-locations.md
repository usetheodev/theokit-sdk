# D162 — Personality presets live in `.theokit/personalities/` (project + user)

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`PersonalityRegistry.load(cwd)` reads from two directories:
- **Project:** `<cwd>/.theokit/personalities/*.md`
- **User:** `~/.theokit/personalities/*.md`

On slug collision the project entry wins; a one-shot stderr warning
(`personality "X" overridden by project preset`) is emitted via
`warnOnce`. Filenames are independent of the frontmatter `name` field.

## Rationale

Matches the `.theokit/` family convention already used by hooks, agents,
mcp, skills. Project-overrides-user mirrors the merge behavior for those
other surfaces (project context has stronger authority on the local
codebase). The warning ensures the override is observable instead of
silent.

## Consequences

- **Enables:** users define personal favorites in `~/.theokit` once and
  per-project overrides as needed.
- **Constrains:** no support for arbitrary roots — those two locations
  are the only ones the registry consults at load time.
