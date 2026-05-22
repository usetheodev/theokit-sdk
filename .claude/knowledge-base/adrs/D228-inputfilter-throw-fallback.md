# D228 — `inputFilter` throw falls back to FULL history with stderr warning

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`safeFilter(fn)` wraps user-supplied `inputFilter`. On exception:

1. Log once to stderr: `[handoff] inputFilter threw, falling back to full history`.
2. Use the un-filtered history (D216 default).
3. Handoff continues normally.

## Rationale

- Bug in user filter code (network call, bad logic) should NOT kill the run.
- Consistent with `safeHook` pattern (Eval D204 / EC-4) and `safe()` wrapper
  in D34 telemetry — same defensive coding ethos.

Alternatives rejected:

- **Throw propagates** — bug in user code derails the whole conversation.
- **Throw aborts the handoff** — different from filter "succeeded but
  returned full history"; user can't distinguish from stack trace.

## Consequences

- Enables resilient handoff flow under user code bugs.
- Constrains: broken filter silently degrades to full-history privacy
  posture — callers MUST verify filter logs to catch this.
