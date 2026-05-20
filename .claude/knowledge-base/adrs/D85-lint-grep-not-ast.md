# D85 — Lint gate uses grep-style regex, not AST analysis

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D79, D84, plan `security-block-completion-plan.md`

## Decision

`tests/lint/no-unguarded-path-input.test.ts` walks `src/**.ts` files and
uses a regex `BAD_PATTERN` to detect:

```
join(...".theokit"..., variableName)
```

Files that contain `safePathJoin` or `sanitizeIdentifier` are skipped
(self-attested as guarded). Files explicitly listed in `ALLOWLIST` are
also skipped (audited as filesystem-controlled or literal-only joins).

Mirror of `tests/lint/no-unredacted-sink.test.ts` (T1.5.2
secret-redaction).

## Rationale

- AST-based detection is precise but expensive (parse every TS file,
  walk every node). For this codebase size (~100 source files), grep
  is 100× faster and runs in milliseconds.
- Regex false positives are rare; the few that exist are explicitly
  allowlisted with rationale.
- One CI gate to enforce the convention is cheaper than constant code
  review vigilance.

## Consequences

- **Enables:** CI failure in seconds when a new unguarded `join` is
  added.
- **Constrains:** the lint requires maintenance when refactors rename
  files or introduce legitimate new callsites (allowlist edit).
- **Trade-off accepted:** lint may miss edge cases AST would catch
  (e.g., dynamic SQL-style string concatenation). Audit complements
  lint, not replaces it.
