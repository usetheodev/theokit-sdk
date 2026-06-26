# Review — v35-eval-harness-ergonomics (V3-5)

**Date:** 2026-06-24 · **Slug:** v35-eval-harness-ergonomics
**Commits reviewed:** `feat(sdk): default provisionRepo + Scorers.verifyGate to LocalSandbox…` + `fix(test): make provisionRepo default-sandbox test parallel-safe…` on `develop`.
**Review method:** objective verification (main-thread). The fresh-eyes sub-agent panel was attempted 3× but the Agent API returned `529 Overloaded` (transient server-side) each time — honestly recorded; the change is small + additive, so the verification table below + the full `pnpm validate` gate provide the comprehensive check. The agents may be re-run later if desired; no finding is expected to change the verdict.
**Verdict:** **READY_TO_MERGE** (0 BLOCKER, 0 HIGH, 0 MEDIUM; 1 INFO).

## Overview
V3-5 DoD clause (b): `provisionRepo` + `Scorers.verifyGate` default to `LocalSandbox` when no `SandboxBackend` is passed, so a local execFile harness (theocode) can adopt them without constructing a backend. Strictly additive + backward-compatible. Clause (a) was already shipped in V2-3; clause (c) is not in the DoD.

## Verification table

| Claim | Check | Result |
|---|---|---|
| Backward-compat — explicit-sandbox path unchanged | `npx vitest run provision.test.ts verify-gate.test.ts m6-eval-harness.test.ts` | **15 passed** (existing explicit-sandbox + new default-path) |
| provisionRepo 2-arg form preserved | discriminator `maybeOpts !== undefined ? sandbox : new LocalSandbox()` runs BEFORE the unchanged validation/clone body (provision.ts:85-89) | ✓ guards (instanceId/ref/ext::) run on `opts` exactly as before |
| verifyGate explicit path unchanged | `sandbox = new LocalSandbox()` default in destructuring; `test_verifyGate_explicit_sandbox_unchanged` green | ✓ |
| verifyGate default workdir-independent | impl `cd <repoDir> && cmd` uses the EXPLICIT repoDir; default sandbox's workdir never consulted | ✓ (EC-3 confirmed) |
| Default-test soundness (parallel-safe) | clones a nonexistent repo via the 1-arg overload → the default LocalSandbox executes `git clone` → exit≠0 → `RepoProvisionError{instanceId}`. No `process.chdir`, no fs side effect | ✓ proves overload + default-backend wiring; parallel-safe |
| SCOPE (a) genuinely shipped (not a dodge) | `grep appendJsonl/readJsonlIds packages/sdk/src/persistence.ts` → lines 29,32; present in 2.8.0 `dist/persistence.d.ts` | ✓ TRUE — shipped V2-3 `edbc3c2` |
| SCOPE (c) legitimately out of DoD | roadmap "Concluído quando" lists ONLY (a) jsonl re-export + (b) provisionRepo/verifyGate local default; "Eval.create task-centric" is gap-description context only | ✓ deferring (c) is honest |
| docs.md synced | provisionRepo (2451) + verifyGate (table 2343 + detailed 2466) document the optional sandbox + LocalSandbox default + cwd caveat (provisionRepo only) | ✓ |
| Full gate | `pnpm validate` | **exit 0** — 34/34 tasks, suite 2916 passed, jscpd 0 clones, knip, publint, attw, bundle PASS |

## Code-quality
PASS_WITH_CAVEATS (manual reachability + knip-in-validate; languages.txt config gap — same INFO as V3-3). No dead code, no symbol fabrication, no orphan export (the change widens existing public APIs; no new export).

## API design assessment
- `provisionRepo` overload (1-arg `(opts)` + preserved 2-arg `(sandbox, opts)`) is the correct backward-compatible choice (ADR D1) — reordering args would have been a major-bump break.
- `VerifyGateOptions.sandbox?` optional widening is sound in TS structural typing — a previously-required field becoming optional never breaks an existing caller that still passes it.
- Default `new LocalSandbox()` reuses the already-public backend (ADR D3 / Rule 9) — zero new dependency.

## INFO
- (Process) The fresh-eyes sub-agent panel was unavailable (Agent API 529 ×3). The verification-based review is sufficient for this additive slice; re-running the panel is optional and would not be expected to alter the verdict.

## Conclusion
V3-5 clause (b) is delivered, backward-compatible, documented, and fully green under `pnpm validate`. The "(a) already shipped" and "(c) out of DoD" claims are both verified TRUE against the files + roadmap — no skipped work, no dodge. **Verdict: READY_TO_MERGE.**

## Loop-closure note
theocode's local eval harness can now adopt `provisionRepo({ … })` + `Scorers.verifyGate({ … })` without constructing a `SandboxBackend`. That adoption + the V3-5 (c) task-centric `Eval` shape (if ever requested) live in the theocode repo / a future slice.
