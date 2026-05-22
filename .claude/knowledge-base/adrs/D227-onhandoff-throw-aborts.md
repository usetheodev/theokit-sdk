# D227 — `onHandoff` throwing aborts the handoff

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`onHandoff(ctx, parsed)` callback semantics: **throwing aborts the handoff**.
The synthetic tool returns `tool_error: onHandoff_failed: <message>`; the
LLM sees the error and decides the next step (retry differently, give up, etc).

Side-effect-only consumers (logging, metrics) MUST wrap their own try/catch
to swallow exceptions.

## Rationale

- `onHandoff` semantically doubles as validation gate ("can I do this transfer?")
  AND side-effect logger. Making throw → abort gives validation gates the
  cleanest API.
- Mirrors `pre_tool_call` veto pattern (D101) — consistent across SDK.

Alternatives rejected:

- **Throw is silenced** — validation gates become impossible.
- **Separate `validateHandoff` callback** — multiplies extension points
  unnecessarily.

## Consequences

- Enables validation gates with throw.
- Constrains: logger-style consumers MUST wrap try/catch internally;
  documented in `Handoff.create` docstring.
