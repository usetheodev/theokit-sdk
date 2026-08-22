---
"@theokit/sdk": patch
---

`Cron.create()` now accepts zero-padded fields and refuses malformed ranges, matching the scheduler
that actually runs the job.

The validator parsed each field shape differently. Literals and steps carried a `String(n) === field`
round-trip; ranges did not. So `"5abc * * * *"` was refused while `"1-5abc * * * *"` was accepted —
the same malformed input, two answers, decided by which shape the user happened to write it in. The
accepted ones did not become working jobs: they were refused later by croner at fire time, where the
failure is a scheduling error nobody is watching rather than a rejected call the caller can fix.

The round-trip also refused `"07 * * * *"`, because `String(7) !== "07"`. Measured against croner 9,
the scheduler this SDK fires jobs with: it accepts `"07 * * * *"` and fires it at :07, accepts
`"01-05"` and `"*/05"`, and refuses `"5abc"`, `"1-5abc"`, `"1abc-5"`, `"0x5"`, `"5.9"`, `"+5"` and
`"1e1"` as illegal characters. Validating stricter than the engine rejects schedules that would have
run correctly; validating looser only defers the failure. Both directions were wrong, in different
field shapes, for the same reason.

One digits-only predicate now decides every shape, reproducing croner's answer on each case above.
Zero-padded expressions that were previously rejected are accepted; malformed ranges that were
previously accepted are rejected at `Cron.create()` with `ConfigurationError` / `invalid_cron`, which
is where the caller can still do something about it.

Also removes a defensive branch in the same validator that no caller could reach: its only caller ran
with exactly five fields against a five-entry table, so the "field index out of range" guard stayed at
zero executions through 37 tests written specifically to enter it.
