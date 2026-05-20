# D157 — Lazy-nested CLAUDE.md loading deferred to v2

**Date:** 2026-05-20
**Status:** Accepted (defer)

## Decision

Anthropic's CLAUDE.md spec also supports lazy-nested loading: when the
agent touches files in a subdir, any `CLAUDE.md` in that subdir is
also loaded into the prompt. This SDK v1 covers only the upward walk
from `cwd` to git-root. Lazy-nested per-subdir loading on file-read is
**deferred to v2**.

## Rationale

Lazy-nested requires hooking the file-read pipeline + invalidation
logic — high implementation cost. Anthropic itself recommends keeping
CLAUDE.md tiny (<200 lines), which de-incentivizes deep nesting.
Telemetry from v1 will tell us whether real users have nested CLAUDE.md
that v1's upward-walk misses.

## Consequences

- **Enables:** ship v1 in scoped time; cover the 95% case (single root
  CLAUDE.md).
- **Constrains:** monorepos with per-service CLAUDE.md get only the
  nearest one in the cwd-to-root walk, not dynamic per-task subdir
  loading. Documented as v2 followup.
