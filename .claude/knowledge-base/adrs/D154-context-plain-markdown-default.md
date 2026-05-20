# D154 — Plain markdown default; MDC frontmatter only for .cursor/rules

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`AGENTS.md` / `CLAUDE.md` / `GEMINI.md` / `.theokit/THEO.md` are parsed
as plain markdown (no frontmatter). `.cursor/rules/*.mdc` is the only
spec parsed with YAML frontmatter (`globs` / `description` /
`alwaysApply`). Existing `.theokit/context/*.md` keeps its Zod
frontmatter (D10/D76) for backward compat. EC-R: MDC nested directories
(`.cursor/rules/sub/*.mdc`) are NOT scanned in v1 — flat-only.

## Rationale

"Radical simplicity" is part of why AGENTS.md won (60k+ adoption). MDC's
`globs`/`description`/`alwaysApply` is the ONLY value MDC adds over plain
markdown, so we parse it where it lives. Anthropic's CLAUDE.md spec is
explicitly plain markdown + `@import`; matching that contract = no
surprises for Claude Code users.

## Consequences

- **Enables:** copy-paste portability across agents.
- **Constrains:** per-source tuning (e.g., per-AGENTS.md size cap)
  requires SDK config, not in-file metadata.
