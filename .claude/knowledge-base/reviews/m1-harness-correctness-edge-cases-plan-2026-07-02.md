# Edge Case Review — m1-harness-correctness (plan)

Date: 2026-07-02 · Tasks analyzed: 5 (T1.1, T1.2, T2.1, T3.1, T4.1) · Two-lens (EDGE + NEGATIVE, testing.md §4.1)
Cases: 6 (MUST FIX: 0, SHOULD TEST: 3, DOCUMENT: 3)

## SHOULD TEST

### EC-1: a tool that IGNORES its abort signal (#58 T1.1)
- **Kind:** NEGATIVE — Suggested test: `tool_ignoring_signal_still_times_out()` — a handler that never checks its signal must still be bounded by the `Promise.race` timeout fallback (not just `AbortSignal.any`), so a non-cooperative tool cannot wedge the loop.

### EC-2: transform hook that THROWS (#65 T2.1)
- **Kind:** NEGATIVE — Suggested test: `transform_hook_error_does_not_corrupt_payload()` — a throwing `transform_tool_result` handler must not corrupt/drop the tool result (fail-safe: on hook error, fall back to the un-transformed payload + stderr, mirroring `runPreUserSendHooks`' per-handler try/catch).

### EC-3: permission arg missing / wrong type (#55 T4.1)
- **Kind:** NEGATIVE — Suggested test: `arg_rule_with_missing_arg_does_not_match()` — a rule declaring `args:{command:/.../}` evaluated against a call with NO `command` arg must NOT match (predicate fails → falls through), never throw on `undefined`.

## DOCUMENT

### EC-4: #57 delimiting must be idempotent / not double-wrap
- **Accepted risk:** if a tool result already contains the delimiter markers, the guard must not nest/duplicate them. Covered by `legitimate_output_preserved()`; note idempotency in the guard.

### EC-5: #55 fail-closed default is a real behavior change for existing callers
- **Accepted risk:** callers relying on default-allow now get `"ask"`. Intentional (D2); migration note in `docs.md` + changeset § Changed. `explicit_allow_default_still_honored()` covers the opt-out.

### EC-6: #58 maxConcurrency=0 or negative (EDGE)
- **Accepted risk:** a `maxConcurrency` of 0/negative is invalid input; the constructor should clamp to ≥1 (or reject). Add a guard; covered by input-validation.

## Verdict: PLAN OK (0 MUST FIX; 3 SHOULD-TEST folded into the relevant task TDD at implement time; 3 DOCUMENT accepted)

The plan's `## Failure scenarios` + `## Drawbacks & Risks` + `## Unresolved Questions` already cover the primary edge/negative surface; EC-1..EC-3 are added as implement-time TDD cases (negative-case discipline), EC-4..EC-6 as guards.
