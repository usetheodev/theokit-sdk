# Implementation — v35-eval-harness-ergonomics (V3-5)

**Date:** 2026-06-24 · **Branch:** develop · **Plan:** `knowledge-base/plans/v35-eval-harness-ergonomics-plan.md` (v1.1, SHIPPABLE 96.4)

## What shipped

V3-5 DoD clause (b): `provisionRepo` + `Scorers.verifyGate` default to `LocalSandbox` when no backend is passed. Strictly additive + backward-compatible. (Clause (a) — jsonl re-export — was already shipped in V2-3; verified, no work.)

| Task | Delta | Tests | Status |
|---|---|---|---|
| T1.1 | `provisionRepo` gains a `(opts)` overload (arity-discriminated; defaults `sandbox` to `new LocalSandbox()`); 2-arg `(sandbox, opts)` form preserved | `test_provisionRepo_defaults_to_local_sandbox` (isolated tmp cwd, EC-1), `test_provisionRepo_single_arg_invalid_instanceId_throws` (EC-2) | committed |
| T1.2 | `VerifyGateOptions.sandbox` → optional; `verifyGate` destructures `sandbox = new LocalSandbox()` | `test_verifyGate_defaults_to_local_sandbox` (EC-3), `test_verifyGate_explicit_sandbox_unchanged` | committed |
| T2.1 | docs.md (provisionRepo + verifyGate sections + summary table) + changeset (`@theokit/sdk` minor) | n/a (docs) | committed |

## TDD (RED → GREEN)

- RED: `tsc` failed — `verify-gate.test.ts` "Property 'sandbox' is missing" + `provision.test.ts` "Expected 2 arguments, but got 1". GREEN: overload + optional field → 15 tests pass (provision + verify-gate + m6-eval), `tsc --noEmit` exit 0.

## Wiring triad (API-ergonomics adapted)

- **(a) Caller:** `provisionRepo`/`verifyGate`/`LocalSandbox` already exported from `@theokit/sdk/sandbox` + `Scorers`; exercised by the extended test suites + documented in docs.md. Loop-closure caller: theocode's local harness.
- **(b) Integration test:** the default-path tests drive the REAL `LocalSandbox` (no mocks) against a real temp git repo / local command — exactly the integration boundary.
- **(c) Observability:** n/a — pure API ergonomics (no new metric); behavior is observable via the scorer/provision result.

## Backward compatibility

- `provisionRepo(sandbox, opts)` 2-arg form: byte-identical (the existing "clones and checks out" + security regression tests stay green).
- `verifyGate({ sandbox, … })` explicit form: unchanged (existing exit-0/exit-1 tests green).
- The `command`-owns-shell-safety SECURITY contract of `verifyGate` is untouched.

## Honest notes

- (a) jsonl re-export already in 2.8.0 dist + docs.md:2270 (shipped V2-3 `edbc3c2`) — verified, no re-work.
- (c) "Eval.create task-centric" is NOT in the roadmap DoD — deferred as conscious accepted-debt (plan Q1), not silently dropped.
- The default `LocalSandbox` for `provisionRepo` clones into the process cwd (documented caveat); `verifyGate`'s default is workdir-independent (cd's to explicit repoDir).

## Validation

- `npx vitest run` provision + verify-gate + m6-eval: 15 passed.
- `tsc --noEmit` exit 0; biome clean (cc ≤ 10).
- Full `pnpm validate`: (running) — jscpd 0 clones / knip / publint / attw / bundle.
