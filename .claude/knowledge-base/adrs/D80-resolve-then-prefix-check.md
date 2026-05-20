# D80 — `safePathJoin` resolves THEN prefix-checks

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D79, plan `security-block-completion-plan.md`

## Decision

`safePathJoin(base, ...parts)` ALWAYS performs the operations in this
order:

1. `resolve(base, ...parts)` (normalizes the path).
2. Compare resolved target against `resolve(base)` + `sep` prefix.
3. Throw `PathTraversalError` if not under base.

Never check-then-resolve. Never `parts.includes("..")` as the primary
defense.

## Rationale

Vector 6 of `path-traversal-vectors.md`: `if (name.includes(".."))`
followed by `resolve(...)` is bypassable via `foo/.\\./bar` or
`subdir/..//../etc/passwd` and similar normalization tricks. Resolving
first turns every escape vector into an explicit absolute path that the
prefix check catches.

## Consequences

- **Enables:** defense against symlink escape (combined with
  `assertNoSymlinkEscape`), normalized escape, mixed-separator escape.
- **Constrains:** uses `node:path.resolve` (not `path.posix.resolve`) so
  the comparison matches the actual filesystem the FS will see on this
  platform.
