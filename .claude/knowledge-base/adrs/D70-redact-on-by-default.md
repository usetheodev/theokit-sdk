# D70 — Redaction ON by default, opt-out emits stderr warning

**Date:** 2026-05-18
**Status:** Accepted
**Related:** D68, D69, plan `secret-redaction-discipline-plan.md`

## Decision

- `THEOKIT_REDACT_SECRETS` absent → ON.
- `"1" | "true" | "yes" | "on"` → ON (case-insensitive).
- Any other value (`"false" | "0" | "no" | "off"`, garbage) → OFF +
  one-time stderr warning:

  ```
  [theokit-sdk] Secret redaction is DISABLED via THEOKIT_REDACT_SECRETS.
  Credentials may leak into errors, telemetry, logs, transcripts.
  ```

## Rationale

Hermes v0.12 shipped redaction OFF by default, citing false positives in
file edits. Production incident followed (`hermes debug share`
uploaded credentials in agent logs). v0.13 reversed: ON by default,
plus a `codeFile` escape hatch (see D72) for the FP that motivated
v0.12.

Lesson learned externally — apply ON-default from the start. The
warning makes opt-out visible: if an operator deliberately disables
redaction for auditing, they see the warning every time they boot the
SDK and remember the trade-off.

Alternatives rejected:

- *OFF by default, opt-in* — what Hermes shipped first; same incident
  category waits to happen.
- *Silent opt-out* — turning off security without telling the operator
  is hostile.

## Consequences

- Enables safe-by-default behavior.
- Constrains: legitimate use cases (`THEOKIT_REDACT_SECRETS=false` for
  local debugging, audit, replay) get an unavoidable stderr line. Cost
  is one log line on each boot; acceptable.
- Constrains: tests that exercise the OFF path must use `_resetForTests`
  (see D69) — they can't just set the env in `beforeEach`.
