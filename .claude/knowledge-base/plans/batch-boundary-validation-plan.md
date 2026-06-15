---
slug: batch-boundary-validation
created_at: 2026-06-15
goal: Add a fail-fast pre-flight boundary validator to Agent.batch so invalid concurrency and malformed prompt items throw a clear ConfigurationError before any side effect.
---

# Plan: Agent.batch boundary validation (cross-val Gap 3, narrowed)

> **Version 1.0** — Closes the genuine, narrow slice of cross-validation Gap 3 ("runtime validation at public boundaries"): `Agent.batch` is the one public entry point lacking a dedicated pre-flight validator. Aligns batch with the in-repo `validateAgentOptions`/`validateCronExpression` pattern; does NOT adopt zod (optional peer per ADR D24).

## Goal

> "Invalid `Agent.batch` inputs fail fast at the boundary with a clear `ConfigurationError`, measured by: (a) `concurrency` that is not a positive integer throws `ConfigurationError(code: "invalid_concurrency")` with a user-facing message BEFORE any pool build or task registration; (b) a prompt item whose `prompt` is empty/non-string throws `ConfigurationError(code: "invalid_batch_item")`; (c) all existing batch tests stay green and no dangling Task is registered on invalid input."

## Context / Baseline (current state)

| File | LoC | Role | Invariant to preserve |
|---|---|---|---|
| `packages/sdk/src/batch.ts` | ~265 | `batchImpl` (Agent.batch core) | empty-array early return; credential-pool sharing; task wrapping; per-prompt failure isolation; input order |
| `packages/sdk/src/types/batch.ts` | ~85 | `BatchOptions`/`BatchItem` types | `concurrency` JSDoc already says "Must be a positive integer" (contract to enforce) |
| `packages/sdk/src/internal/runtime/async-semaphore.ts` | ~60 | `createSemaphore` | already throws `ConfigurationError` on permits<1 (keep as defense-in-depth) |
| `packages/sdk/src/errors.ts` | 692 | `ConfigurationError` taxonomy | reuse; no new error class needed |

Current behavior (the gap):
- `concurrency` validated only incidentally via `createSemaphore` deep in `runBatch` — leaky internal message, and it fires AFTER `wrapBatchAsTask` (ordering bug: dangling task on invalid input).
- prompt items never validated — `normalizeItem` passes `prompt: ""`/non-string straight to `agent.send`.

## Drawbacks & Risks

- **Behavior change (intentional):** previously a `prompt: ""` item would run an agent on an empty prompt; now it throws. This is the desired fail-fast, but is technically stricter. Mitigation: document in CHANGELOG; empty prompt is never a legitimate batch input.
- **Risk:** the new validator must run BEFORE `wrapBatchAsTask` and pool building. Mitigation: place it as the first statement in `batchImpl`; integration test asserts no task registered on invalid input.
- **Risk:** over-validation breaking valid inputs (e.g., concurrency omitted). Mitigation: only validate when `concurrency !== undefined`; default path untouched.

## Tasks

### Task 1 — `validateBatchInput(prompts, options)` pure validator (TDD)
- #### Why this step: a pure, unit-testable validator mirrors `validateAgentOptions`; isolates the rules from the async batch machinery.
- #### TDD: `test_validateBatchInput_rejects_zero_concurrency` (throws ConfigurationError code `invalid_concurrency`); `test_rejects_negative_and_noninteger_and_NaN`; `test_rejects_empty_string_prompt` (code `invalid_batch_item`); `test_rejects_batchitem_with_blank_prompt`; `test_accepts_valid_string_and_BatchItem`; `test_accepts_omitted_concurrency`.
- #### Acceptance: validator throws `ConfigurationError` with the two stable codes + user-facing messages; returns void on valid input; pure (no I/O).

### Task 2 — Wire validator into `batchImpl` before side effects (TDD)
- #### Why this step: validation must be a true pre-flight (Rule 8 fail-fast) — before pool build + task registration — to avoid dangling tasks.
- #### TDD: `test_batch_invalid_concurrency_registers_no_task` (call batchImpl with `{concurrency:0, task:true}`, assert throw + task registry unchanged); `test_batch_empty_prompt_throws_before_create` (deps.create spy never called).
- #### Acceptance: `validateBatchInput` is the first statement in `batchImpl` (after the empty-array early return); on invalid input no `deps.create`, no pool, no task registration occurs.

### Task 3 — Docs + CHANGELOG
- #### Why this step: public-boundary behavior change must be in docs.md + CHANGELOG (Rule 6 + docs source-of-truth).
- #### Acceptance: `docs.md` Agent.batch section notes the validation contract; `packages/sdk/CHANGELOG.md` `[Unreleased] § Fixed`/`Changed` entry; root CHANGELOG entry.

## Coverage Matrix

| Goal claim | Task |
|---|---|
| concurrency not positive-integer → ConfigurationError(invalid_concurrency) before side effects | T1, T2 |
| empty/non-string prompt → ConfigurationError(invalid_batch_item) | T1, T2 |
| no dangling Task on invalid input | T2 |
| existing batch tests green | T2 (regression) |
| docs + changelog | T3 |

## Test Plan
- Unit: `validateBatchInput` rules (Task 1) — pure, fast.
- Integration: `batchImpl` pre-flight ordering (Task 2) — spy on deps.create + task registry.
- Regression: full `batch.test.ts` + `batch.property.test.ts` + `agent-batch-wiring.test.ts` green.

## Unresolved Questions
- (none) — scope is deliberately narrow; concurrency upper-bound capping already handled by `Math.min(requested, prompts.length)`.

## Prior Art
- In-repo: `validateAgentOptions`, `validateCronExpression`, `createSemaphore` (ConfigurationError pattern).
- Reference: crewAI pydantic boundary validation (`agent/core.py`) — inspiration; rejected zod-adoption per ADR D24.

## Rationale & Alternatives
- **Chosen:** hand-rolled pre-flight validator throwing `ConfigurationError`. Consistent with repo, no new dep, respects zod-optional contract.
- **Rejected:** zod schema for BatchOptions — would force zod into the hot path (ADR D24 violation) for marginal gain.
- **Rejected:** rely on `createSemaphore` only — leaky message + ordering bug (dangling task) remain.
