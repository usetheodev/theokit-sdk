# D152 — `concat-by-priority` merge (NOT first-match-wins)

**Date:** 2026-05-20
**Status:** Accepted

## Decision

When multiple context files exist, the loader concatenates them in
priority-ascending order (lower = earlier in prompt; last-writer-wins
on conflict). Order:

```
AGENTS.md (10) → GEMINI.md (20) → CLAUDE.md (30) →
.cursor/rules/*.mdc (40) → .theokit/context/*.md (50) →
.theokit/THEO.md (60)
```

Same-priority sources tie-break by source path lex-ascending for
deterministic ordering (EC-J — prompt-cache stability).

## Rationale

Hermes's first-match-wins **discards signal**. Real users have AGENTS.md
(shared) + CLAUDE.md (Claude-specific) coexisting precisely because each
is for a different reader. Concat lets users layer specificity:

- AGENTS.md = shared baseline for all agents
- CLAUDE.md / GEMINI.md = vendor-specific
- `.theokit/THEO.md` = Theo-only overrides (last word)

## Consequences

- **Enables:** layered overrides; same repo works for multiple agents
  without conflict; predictable cache hit rate.
- **Constrains:** total token cost is sum-of-files, not min-of-files.
  Per-file (40k) + aggregate (120k) caps mitigate.
