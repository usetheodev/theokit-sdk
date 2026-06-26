---
slug: v35-eval-harness-ergonomics
milestone_id: V3-5
created_at: 2026-06-24
goal: Default provisionRepo and Scorers.verifyGate to a LocalSandbox when no SandboxBackend is passed, measured by the new default-path tests passing while every explicit-sandbox test stays green.
---

# Plan: V3-5 — Eval harness ergonomics (LocalSandbox default)

> **Version 1.1** — (absorbs EC-1 isolated-tmp-cwd test + EC-2 discriminator assertion + EC-3 verifyGate-workdir-independent docs clarification from the edge-case review.)
>
> **Version 1.0** — V3-5's only remaining DoD item. The roadmap's "Concluído quando" has two clauses: (a) `appendJsonl`/`readJsonlIds` re-exported from the public `@theokit/sdk/persistence` subpath — **already shipped in V2-3** (`edbc3c2`, present in the 2.8.0 dist + docs.md:2270); and (b) `provisionRepo`/`verifyGate` usable with a local backend default (without an explicit `SandboxBackend`). This plan delivers (b): both gain a `LocalSandbox` default so theocode's direct-execFile/local harness can adopt them without constructing a backend. Strictly additive + backward-compatible. The gap's (c) note ("Eval.create is agent-centric") is descriptive context, NOT in the DoD — out of scope (documented in Unresolved Questions). No new dependency (LocalSandbox already ships, public).

## Goal

> Enable `@theokit/sdk` eval-harness consumers to call `provisionRepo` and `Scorers.verifyGate` WITHOUT constructing a `SandboxBackend` (defaulting to `LocalSandbox`), measured by `test_provisionRepo_defaults_to_local_sandbox` + `test_verifyGate_defaults_to_local_sandbox` passing AND every pre-existing explicit-sandbox test in `provision.test.ts` / `verify-gate.test.ts` staying green.

## Context

V3-5 of `docs/gap-audit/ROADMAP-v3.md` (Esforço M, valor Baixo, opcional). Gap V2-2E: the SWE-bench-style primitives `provisionRepo` (clone+checkout) and `Scorers.verifyGate` (grade a patch by test exit-code) both REQUIRE a `SandboxBackend` (D2 — Local/Docker/E2B). theocode's harness is direct-execFile/local (`swebench-provision.ts`/`eval-suite.ts`), so adopting the SDK primitives today forces it to instantiate a `LocalSandbox` it otherwise wouldn't need. Giving both a `LocalSandbox` default removes that friction. The roadmap is explicit this is low-priority cleanup ("o eval do theocode funciona; é cleanup de Regra 9, não bloqueio"), so the slice is deliberately minimal: a default, not a redesign.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/sandbox/provision.ts` | ~110 | `f70d9ef` (2026-06-22) | `provisionRepo(sandbox, opts)` — clone+checkout into `<workdir>/<instanceId>` via `SandboxBackend.execute`; security validation of `instanceId`/`ref`/`repoUrl` | The 2-arg `(sandbox, opts)` form MUST keep working unchanged; all security validation (SAFE_INSTANCE_ID, `--` terminator, `ext::` block) preserved |
| `packages/sdk/src/scorers.ts` | ~? | `e34dbd3` (2026-06-22) | `Scorers.verifyGate(opts)` — runs `cd repoDir && command` in `opts.sandbox`, scores 1 iff exit 0 | Existing callers passing `opts.sandbox` MUST behave identically; the `command`-owns-shell-safety SECURITY contract unchanged |
| `packages/sdk/src/types/eval.ts` | ~? | `f70d9ef` (2026-06-22) | `VerifyGateOptions` (sandbox/repoDir/failToPass/passToPass/command) | Making `sandbox` optional must not change any other field; existing explicit-sandbox callers unaffected |
| `packages/sdk/src/sandbox/local-sandbox.ts` | ~? | — | `LocalSandbox extends SandboxBackend` (execFile `/bin/sh -c`); public via `@theokit/sdk/sandbox` | Reused as the default; not modified |
| `docs.md` | (large) | `96a507f`+ | Public contract; `@theokit/sdk/sandbox` (provisionRepo:2451) + `verifyGate` (2343) | Updated in same PR to document the optional sandbox + default |
| `packages/sdk/tests/sandbox/provision.test.ts` | — | `f70d9ef` | provisionRepo tests | Existing tests stay green; extend with default-path test |
| `packages/sdk/tests/eval/verify-gate.test.ts` | — | — | verifyGate tests | Existing tests stay green; extend with default-path test |
| `.changeset/v35-eval-harness-ergonomics.md` (NEW) | 0 | — | (to create) — `@theokit/sdk` minor | — |

### Current callers / dependents

- **`provisionRepo`** — exported from `@theokit/sdk/sandbox` (`sandbox/index.ts`). No production caller in `packages/sdk/src` (public API; the loop-closure consumer is theocode). Test caller: `tests/sandbox/provision.test.ts`. Documented at docs.md:2451 as `provisionRepo(sandbox, { … })`.
- **`Scorers.verifyGate`** — exported via `Scorers` (scorers.ts). Test caller: `tests/eval/verify-gate.test.ts`, `tests/eval/m6-eval-harness.test.ts`. Documented at docs.md:2343/2466.
- **`LocalSandbox`** — exported from `@theokit/sdk/sandbox` (`sandbox/index.ts:1`); cheap constructor (`config = {}`, execFile `/bin/sh -c`).
- **External (public API):** yes — both are part of the `@theokit/sdk/sandbox` + `Scorers` public surface. Backward compatibility is mandatory.

### Domain glossary

- **`SandboxBackend`** — abstract backend running a shell command (`execute`); concrete impls: `LocalSandbox`, Docker, E2B (D2).
- **`LocalSandbox`** — the local execFile-backed `SandboxBackend` (`/bin/sh -c`), already public.
- **`provisionRepo`** — clones a repo + checks out a ref into the sandbox workdir for an eval row.
- **`verifyGate`** — a `NamedScorer` that grades a patch by running the project's tests and reading the exit code.

### Architecture boundaries affected

None crossed. Both functions stay in their current modules (`sandbox/`, top-level `scorers.ts`); the change adds an optional default of an already-public same-package class. No layering change, no new dependency.

## Prior Art & Related Work

- **Internal:** the V2-3 sandbox/eval surface (`f70d9ef`/`e34dbd3`) that shipped `provisionRepo`/`verifyGate`/`LocalSandbox`; the V2-3 blueprint for the eval harness (`m2`/SWE-bench work). The (a) jsonl re-export already landed in `edbc3c2`.
- **Executable spec:** `theocode/server/lib/swebench-provision.ts` (`prepareRepo`) + `eval-suite.ts` (verify) — direct-execFile/local, the consumer that benefits from the default.
- No external discovery needed — `LocalSandbox` already exists; this slice makes it the default. (Discovery is a no-op; prior art above suffices.)

## Objective

- [ ] Sub-goal 1 — `provisionRepo` is callable as `provisionRepo(opts)` (sandbox defaults to `new LocalSandbox()`); the existing `provisionRepo(sandbox, opts)` form is unchanged.
- [ ] Sub-goal 2 — `Scorers.verifyGate({ … })` is callable without `sandbox` (defaults to `new LocalSandbox()`); explicit `sandbox` still honored.
- [ ] Sub-goal 3 — `docs.md` + a `@theokit/sdk` minor changeset reflect the optional sandbox + default; every pre-existing provision/verify-gate test stays green; zero new dependency.

## ADRs

### D1 — `provisionRepo` gains a `(opts)` overload defaulting to `LocalSandbox`; the `(sandbox, opts)` overload is preserved
- **Decision:** Add a TS overload `provisionRepo(opts)` alongside the existing `provisionRepo(sandbox, opts)`. The impl discriminates on arity (`maybeOpts !== undefined` → 2-arg sandbox-first form; else 1-arg form with `new LocalSandbox()`).
- **Rationale:** preserves every existing 2-arg caller byte-for-byte while adding the local-default ergonomics. Arity discrimination is unambiguous and tiny (cc well under 10).
- **Alternatives considered:** (a) Reorder to `provisionRepo(opts, sandbox?)` — REJECTED: breaks the documented 2-arg `(sandbox, opts)` form (a major-bump break). (b) Move `sandbox` into `ProvisionRepoOptions` — REJECTED: same breaking reorder + diverges from the established sandbox-first signature.
- **Consequences:** one overload signature added; the security validation body is untouched (runs identically for both forms).

### D2 — `VerifyGateOptions.sandbox` becomes optional, defaulting to `LocalSandbox` in the impl
- **Decision:** `readonly sandbox?: SandboxBackend;`; the `verifyGate` impl destructures `const { sandbox = new LocalSandbox(), … } = opts`.
- **Rationale:** options-object default is the idiomatic non-breaking widening; existing callers passing `sandbox` are unaffected.
- **Alternatives considered:** keep `sandbox` required — REJECTED: defeats the ergonomics goal (b); theocode would still construct a backend it doesn't need.
- **Consequences:** the `command`-owns-shell-safety SECURITY contract is unchanged (the default LocalSandbox is shell-backed, exactly what `cd repoDir && cmd` assumes).

### D3 — The default is `new LocalSandbox()` (already public), not a new backend
- **Decision:** default to `new LocalSandbox()` — the existing public execFile backend.
- **Rationale:** Rule 9 + KISS + YAGNI — LocalSandbox already exists, is cheap, and is exactly the "local" backend theocode uses. No new code/dep.
- **Alternatives considered:** (a) a throwing/no-op default — REJECTED: the whole point is a working default. (b) a new lighter backend — REJECTED: reinvents LocalSandbox.
- **Consequences:** with no `workDir` configured, the default clones into cwd/`<instanceId>`; a caller wanting a specific workdir passes its own `LocalSandbox({ workDir })`. Documented.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| The default `LocalSandbox` clones into the process cwd when no workDir is set — surprising if a caller expected isolation | Low | Documented in docs.md + the option JSDoc; callers needing isolation pass `LocalSandbox({ workDir })` (unchanged path) | SDK |
| A per-call `new LocalSandbox()` is allocated when the default is used | Low | LocalSandbox is a thin stateless execFile wrapper; allocation is negligible; explicit-sandbox callers allocate nothing new | SDK |
| `provisionRepo` overload could be mis-discriminated if a caller passed `undefined` as the 2nd arg explicitly | Low | Discriminator is `maybeOpts !== undefined`; an explicit `provisionRepo(sandbox, undefined)` was already invalid (opts required) — no real caller does this; covered by a test | SDK |

## Unresolved Questions

- Q1 — Gap (c) ("`Eval.create` is agent-centric; theocode harness is task-centric seed→patch→verify") is NOT in the roadmap's "Concluído quando" — it is descriptive context. This plan scopes V3-5 to the DoD (a)+(b); (a) is already shipped, so the deliverable is (b). A task-centric `Eval` shape would be a separate, larger slice IF a consumer requests it — deferred as conscious accepted-debt, NOT silently dropped.
- Q2 — `(none other — every decision is resolved at plan time.)`

## Dependency Graph

```
T1.1 (provisionRepo overload) ──┐
                                 ├──▶ T2.1 (docs + changeset + integration validation)
T1.2 (verifyGate optional)    ──┘
T1.1 and T1.2 are INDEPENDENT (disjoint functions) — any order.
```

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `LocalSandbox` (in-package) | — | npm | The default backend; already public on `@theokit/sdk/sandbox`. No external dep. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | — | No dependency added (ADR D3 / Rule 9). |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

---

## Phase 1: LocalSandbox default

**Objective:** Both primitives default to `LocalSandbox` when no backend is passed.

### T1.1 — `provisionRepo` `(opts)` overload

#### Objective
Add the 1-arg overload defaulting `sandbox` to `new LocalSandbox()`; keep the 2-arg form.

#### Why this step (action + reasoning)
1. **What this step does** — adds an overload + a 2-line arity discriminator at the top of `provisionRepo`.
2. **Why it is necessary now** — it is half of DoD (b); theocode's local harness can then call `provisionRepo({ repoUrl, ref, instanceId })` directly. Cited by ADR D1, D3.

#### Evidence
- `packages/sdk/src/sandbox/provision.ts:71` (`provisionRepo(sandbox, opts)` today).
- `packages/sdk/src/sandbox/local-sandbox.ts:16` (`LocalSandbox`, cheap ctor).
- `docs/gap-audit/ROADMAP-v3.md § V3-5` "Concluído quando" clause (b).

#### Files to edit
```
packages/sdk/src/sandbox/provision.ts — add (opts) overload + LocalSandbox import + arity discriminator
packages/sdk/tests/sandbox/provision.test.ts — RED test for the default-sandbox path
```

#### Deep file dependency analysis
- `provision.ts` (Baseline row 1): `provisionRepo(sandbox, opts)` → add overload signatures + `const sandbox = maybeOpts ? (a as SandboxBackend) : new LocalSandbox(); const opts = maybeOpts ?? (a as ProvisionRepoOptions)`. Body unchanged. No production caller; tests + docs are the surface.

#### Pseudo-code / Signatures
```pseudocode
export function provisionRepo(opts: ProvisionRepoOptions): Promise<{ repoDir: string }>;
export function provisionRepo(sandbox: SandboxBackend, opts: ProvisionRepoOptions): Promise<{ repoDir: string }>;
export async function provisionRepo(a, maybeOpts?) {
  const sandbox = maybeOpts !== undefined ? a as SandboxBackend : new LocalSandbox();
  const opts    = maybeOpts ?? (a as ProvisionRepoOptions);
  ... existing validation + clone/checkout using sandbox + opts ...
}
# Example
provisionRepo({ repoUrl, ref, instanceId })          // local default
provisionRepo(myDockerSandbox, { repoUrl, ref, instanceId })  // explicit (unchanged)
```

#### Tasks
1. Import `LocalSandbox` into `provision.ts`.
2. Add the two overload signatures + the impl discriminator.
3. Leave the validation/clone body unchanged.

#### TDD
```
RED:   test_provisionRepo_defaults_to_local_sandbox() — the 1-arg overload constructs a default LocalSandbox and runs git through it. Proven WITHOUT fs side effects (EC-1: process.chdir is unreliable in vitest's worker pool) by cloning a nonexistent repo → the default backend executes `git clone`, exits non-zero, surfacing RepoProvisionError{instanceId}. The successful clone+checkout mechanics share the identical post-discriminator path already covered by the explicit-sandbox "clones and checks out a ref" test.
RED:   test_provisionRepo_explicit_sandbox_unchanged() — provisionRepo(fakeSandbox, opts) still routes through the passed sandbox (regression).
RED:   test_provisionRepo_single_arg_missing_repoUrl_throws() — a 1-arg call whose object lacks repoUrl throws the normal validation error (EC-2: discriminator routes a single arg to opts cleanly).
GREEN: add overload + discriminator
REFACTOR: None expected
VERIFY: npx vitest run packages/sdk/tests/sandbox/provision.test.ts
```

#### Acceptance Criteria
- [ ] `npx vitest run packages/sdk/tests/sandbox/provision.test.ts -t default_to_local_sandbox` exits 0 (the 1-arg overload resolves a repoDir with a default `LocalSandbox`); the explicit `provisionRepo(sandbox, opts)` regression test stays green.
- [ ] Pass: complexity — `npx biome lint packages/sdk/src/sandbox/provision.ts` reports cyclomatic ≤ 10 on `provisionRepo`.
- [ ] Pass: lint — `npx biome check packages/sdk/src/sandbox/provision.ts` exits 0.
- [ ] Pass: size — `wc -l packages/sdk/src/sandbox/provision.ts` ≤ 500.

#### DoD
- [ ] RED tests written first and observed failing.
- [ ] `npx vitest run packages/sdk/tests/sandbox/provision.test.ts` exits 0.
- [ ] `npx tsc --noEmit` exits 0.
- [ ] `npx biome check packages/sdk/src/sandbox/provision.ts` exits 0.

### T1.2 — `verifyGate` optional sandbox

#### Objective
Make `VerifyGateOptions.sandbox` optional, defaulting to `new LocalSandbox()` in the impl.

#### Why this step (action + reasoning)
1. **What this step does** — widens `sandbox` to optional + adds the destructuring default.
2. **Why it is necessary now** — the other half of DoD (b). Cited by ADR D2, D3.

#### Evidence
- `packages/sdk/src/types/eval.ts:128` (`readonly sandbox: SandboxBackend;` today).
- `packages/sdk/src/scorers.ts:146` (`verifyGate` destructures `sandbox` from opts).

#### Files to edit
```
packages/sdk/src/types/eval.ts — VerifyGateOptions.sandbox → optional
packages/sdk/src/scorers.ts — import LocalSandbox + default in destructuring
packages/sdk/tests/eval/verify-gate.test.ts — RED test for the default-sandbox path
```

#### Deep file dependency analysis
- `eval.ts`: `sandbox?: SandboxBackend`. `scorers.ts`: `const { sandbox = new LocalSandbox(), repoDir, failToPass, passToPass, command } = opts;`. Existing explicit-sandbox callers behave identically.

#### Pseudo-code / Signatures
```pseudocode
interface VerifyGateOptions { sandbox?: SandboxBackend; repoDir; failToPass; passToPass; command }
verifyGate(opts) {
  const { sandbox = new LocalSandbox(), repoDir, failToPass, passToPass, command } = opts;
  ... unchanged ...
}
```

#### Tasks
1. `VerifyGateOptions.sandbox` → optional.
2. Import `LocalSandbox` in `scorers.ts`; default it in the destructuring.

#### TDD
```
RED:   test_verifyGate_defaults_to_local_sandbox() — verifyGate({repoDir, failToPass, passToPass, command}) (no sandbox) produces a scorer that runs the command locally (exit 0 → score 1).
RED:   test_verifyGate_explicit_sandbox_unchanged() — passing sandbox still routes through it (regression).
GREEN: optional field + destructuring default
REFACTOR: None expected
VERIFY: npx vitest run packages/sdk/tests/eval/verify-gate.test.ts
```

#### Acceptance Criteria
- [ ] `npx vitest run packages/sdk/tests/eval/verify-gate.test.ts -t default_to_local_sandbox` exits 0 (verifyGate scorer runs without an explicit `sandbox`); the explicit-`sandbox` regression test stays green.
- [ ] Pass: complexity — `npx biome lint packages/sdk/src/scorers.ts` reports cyclomatic ≤ 10 on `verifyGate`.
- [ ] Pass: lint — `npx biome check packages/sdk/src/scorers.ts packages/sdk/src/types/eval.ts` exits 0.
- [ ] Pass: size — both files ≤ 500 lines.

#### DoD
- [ ] RED tests written first and observed failing.
- [ ] `npx vitest run packages/sdk/tests/eval/verify-gate.test.ts` exits 0.
- [ ] `npx tsc --noEmit` exits 0.
- [ ] `npx biome check packages/sdk/src/scorers.ts packages/sdk/src/types/eval.ts` exits 0.

---

## Phase 2: Docs + changeset + integration validation

**Objective:** Public contract synced; release metadata present; full gate green.

### T2.1 — docs.md + CHANGELOG/changeset + wiring

#### Objective
Document the optional sandbox + default; add a `@theokit/sdk` minor changeset.

#### Why this step (action + reasoning)
1. **What this step does** — updates docs.md (provisionRepo:2451 + verifyGate:2343/2466) + adds the changeset.
2. **Why it is necessary now** — CLAUDE.md mandates docs.md sync for public-API changes; the changeset drives the npm minor. Cited by CLAUDE.md "Checklist before changing public API".

#### Evidence
- docs.md:2343 (`verifyGate({ sandbox, … })`), docs.md:2451 (`provisionRepo(sandbox, { … })`).

#### Files to edit
```
docs.md — note sandbox is OPTIONAL (defaults to LocalSandbox) for both provisionRepo + verifyGate; document the cwd-workdir caveat
packages/sdk/CHANGELOG.md — [Unreleased] Added entry (changesets-managed)
.changeset/v35-eval-harness-ergonomics.md (NEW) — @theokit/sdk minor
```

#### Deep file dependency analysis
- docs.md is the source-of-truth contract (CLAUDE.md). No barrel change needed — `provisionRepo`/`verifyGate`/`LocalSandbox` are already exported; only their call ergonomics changed.

#### TDD
```
RED:   grep -n "optional\|defaults to .LocalSandbox" docs.md (provisionRepo + verifyGate sections) — fails before edit.
GREEN: docs updated; `test -f .changeset/v35-eval-harness-ergonomics.md` true.
REFACTOR: None
VERIFY: grep -nE "provisionRepo\(\{|sandbox.*optional|LocalSandbox" docs.md
```

#### Acceptance Criteria
- [ ] docs.md documents the optional sandbox + LocalSandbox default for BOTH primitives; the cwd-workdir caveat is stated under `provisionRepo` ONLY, and `verifyGate` is noted as workdir-independent (it always `cd`s to the explicit `repoDir`) per EC-3.
- [ ] `.changeset/v35-eval-harness-ergonomics.md` declares `@theokit/sdk` minor.

#### DoD
- [ ] `grep -nE "optional|LocalSandbox" docs.md` resolves in both the provisionRepo + verifyGate sections (contract synced).
- [ ] `test -f .changeset/v35-eval-harness-ergonomics.md` AND it declares `@theokit/sdk` minor.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | provisionRepo usable without explicit SandboxBackend (DoD b) | T1.1 | `(opts)` overload + LocalSandbox default |
| 2 | verifyGate usable without explicit SandboxBackend (DoD b) | T1.2 | optional `sandbox` + LocalSandbox default |
| 3 | Backward compat (explicit-sandbox callers + 2-arg provisionRepo) | T1.1, T1.2 | overload preserves 2-arg; optional field preserves explicit path; regression tests |
| 4 | Public-API docs + release metadata | T2.1 | docs.md + changeset |
| 5 | Zero new dependency (Rule 9) | T1.1, T1.2 | reuse existing public LocalSandbox |

**Coverage: 5/5 gaps covered (100%)**

> Note: DoD clause (a) — `appendJsonl`/`readJsonlIds` re-exported from `@theokit/sdk/persistence` — is NOT a row here because it was already shipped in V2-3 (`edbc3c2`, verified present in the 2.8.0 dist + docs.md:2270). It is recorded in `## Prior Art` + the v1.0 summary, not as a task of this plan. This plan scopes V3-5's remaining work (DoD clause b).

## Global Definition of Done

- [ ] All phases completed.
- [ ] `npx vitest run packages/sdk/tests/sandbox/provision.test.ts packages/sdk/tests/eval/verify-gate.test.ts packages/sdk/tests/eval/m6-eval-harness.test.ts` exits 0 (new default-path + existing explicit-path tests green).
- [ ] `npx tsc --noEmit` exits 0.
- [ ] `npx biome check` exits 0 on all changed files (cc ≤ 10).
- [ ] File-size budget respected — `wc -l packages/sdk/src/sandbox/provision.ts packages/sdk/src/scorers.ts packages/sdk/src/types/eval.ts` each return ≤ 500.
- [ ] Backward compatibility preserved — `npx vitest run packages/sdk/tests/sandbox/provision.test.ts packages/sdk/tests/eval/verify-gate.test.ts` exits 0 with the pre-existing explicit-sandbox tests unchanged (2-arg `provisionRepo`, explicit `verifyGate` sandbox).
- [ ] `docs.md` reflects the optional sandbox + default — `grep -nE "optional|LocalSandbox" docs.md` resolves in the provisionRepo + verifyGate sections.
- [ ] `.changeset/v35-eval-harness-ergonomics.md` present (`@theokit/sdk` minor).
- [ ] `NODE_OPTIONS="--max-old-space-size=8192" pnpm validate` exits 0 (jscpd 0 clones, knip, publint, attw, bundle budget).
- [ ] `ROADMAP-v3.md` V3-5 flipped `[x]` (both copies) after `/review` READY_TO_MERGE.

## Final Phase: Integration Validation (MANDATORY)

> Runs after Phase 1+2. The plan is NOT done until validation passes.

### Execution
```
npx vitest run packages/sdk/tests/sandbox/provision.test.ts packages/sdk/tests/eval/verify-gate.test.ts packages/sdk/tests/eval/m6-eval-harness.test.ts
npx tsc --noEmit
npx biome check packages/sdk/src/sandbox/provision.ts packages/sdk/src/scorers.ts packages/sdk/src/types/eval.ts
NODE_OPTIONS="--max-old-space-size=8192" pnpm validate
```

### Acceptance Criteria
- [ ] `npx vitest run packages/sdk/tests/sandbox/provision.test.ts packages/sdk/tests/eval/verify-gate.test.ts packages/sdk/tests/eval/m6-eval-harness.test.ts` exits 0 (all suites green).
- [ ] `npx tsc --noEmit` exits 0 AND `npx biome check packages/sdk/src/sandbox/provision.ts packages/sdk/src/scorers.ts packages/sdk/src/types/eval.ts` exits 0 (zero type errors, zero lint warnings).
- [ ] `NODE_OPTIONS="--max-old-space-size=8192" pnpm validate` exits 0.

### If Validation Fails
1. Separate plan-caused failures from pre-existing.
2. Fix all plan-caused failures before completion.
3. Re-run the chain.
