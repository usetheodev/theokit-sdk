# D151 — Walk-up-to-git-root discovery; no gitignore parsing

**Date:** 2026-05-20
**Status:** Accepted

## Decision

For `git-root-walk` scope specs (AGENTS.md / CLAUDE.md / GEMINI.md),
discovery walks from `cwd` upward stopping at the directory containing
`.git`. Pure `existsSync` checks — **no `.gitignore` parsing** (EC-A) and
**no invented `.theokitignore`** (EC-B). Symlink chains pointing to the
same physical file dedup via `realpathSync` (EC-F). Git worktrees work
transparently because `.git` exists as a file there too (EC-N).

## Rationale

Hermes/Gemini-CLI/Claude-Code all walk upward — established mental model.
`.git/` is the canonical project boundary.

**Drop `.gitignore` respect:** context files (AGENTS.md, CLAUDE.md, etc.)
are virtually always tracked. Parsing `.gitignore` adds ~100 LoC + negation
(`!pattern`) + ordering edge cases for ~0% real-world benefit. KISS.

**Drop `.theokitignore`:** zero precedent in the ecosystem; brand
pollution. Revisit in v2 if signal emerges.

Expected overhead <50ms for 20-level deep cwd × 6 specs = 120 stat calls
(EC-O).

## Consequences

- **Enables:** monorepo support (nested `AGENTS.md` per service); simple
  implementation; git worktrees work transparently.
- **Constrains:** non-git workspaces use cwd-only fallback. Users who
  want a file ignored simply place it in a non-walked location.
