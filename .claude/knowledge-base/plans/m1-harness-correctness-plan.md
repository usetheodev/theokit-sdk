---
slug: m1-harness-correctness
milestone_id: M1
created_at: 2026-07-02
goal: Close the 4 M1 Harness correctness defects (#55/#57/#58/#65) TDD-first
---

# Plan: M1 Harness Correctness Core — close #55/#57/#58/#65

> **Version 1.0** — Close the four M1 correctness defects (silent no-ops) blueprinted in
> `knowledge-base/discoveries/blueprints/m1-harness-correctness-blueprint.md`: cancellation that does not interrupt in-flight tools + no
> per-tool timeout + JobQueue cancel/concurrency gaps (#58), name-only + fail-open permission (#55),
> 7 of 10 declared plugin hooks that are silent no-ops + no ToolContext (#65), and no content-level
> tool-result defense (#57). Each fix is TDD-first with a RED regression that fails against today's
> code, using Node stdlib only (no new deps).

## Goal

> "Enable the Theo Harness to eliminate its silent no-ops so defects #55, #57, #58, #65 are closed,
> measured by new RED-first regression tests passing (a cancelled run interrupts an in-flight tool
> handler; a per-tool timeout rejects a typed error; a permission rule denies `shell`+`rm -rf` while
> `shell`+`ls` passes; each of the 7 newly-wired hooks invokes its handler; an injected marker in a
> tool result is delimited, not executed) with the full `@theokit/sdk` suite green."

## Context

M1 of `theokit-sdk/ROADMAP.md` (milestone #55/#57/#58/#65) is the Harness **correctness core**:
eliminate surfaces that exist but silently do nothing. The four defects were located with `file:line`
evidence by the 2026-06/07 cross-validation sweep and their fix approaches blueprinted (SHIPPABLE 99.2)
at `knowledge-base/discoveries/blueprints/m1-harness-correctness-blueprint.md`. Grounding reads on
2026-07-02 (post-M0) confirmed every defect. All fixes are Node stdlib (Node ≥22.12) — zero new deps.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/internal/agent-loop/tool-dispatch.ts` | 408 | `607da9a` (2026-06-19) | Dispatches tool calls; veto + lifecycle | ≤500 LoC (near budget — extract if needed); existing veto/lifecycle behavior; `dispatchTools` signature additive |
| `packages/sdk/src/internal/agent-loop/loop.ts` | 400 | `b42f4b5` (2026-07-01) | Agent loop orchestration | ≤500 LoC; existing terminate/continue logic; hook insertion is additive |
| `packages/sdk/src/internal/agent-loop/loop-llm-stream.ts` | 243 | `8b411c5` (2026-06-29) | LLM stream turn | pre/post_llm_call hooks additive around the stream |
| `packages/sdk/src/job-queue.ts` | 68 | `5e780ac` (2026-06-11) | Public bounded job runner | additive-only public API (`maxConcurrency` opt, abort-on-cancel); existing `enqueue`/`cancel` return types unchanged for existing callers |
| `packages/sdk/src/permission-engine.ts` | 46 | `dd0a334` (2026-06-22) | Public first-match permission rules | `evaluate(toolName)` stays callable (additive 2nd arg); `PermissionRule` additive `args?`; default-posture change is a documented public change |
| `packages/sdk/src/internal/plugins/manager.ts` | 253 | `98ac0d0` (2026-07-02) | Plugin hook aggregation + runners | existing 3 run*Hooks + register (M0) unchanged; add 7 new run*Hooks |
| `packages/sdk/src/internal/plugins/types.ts` | 145 | `2761a55` (2026-05-20) | Plugin/hook contracts (`HookName`, contexts) | `HookName` unchanged (all 10 stay — they get wired, not removed); add hook context types + `ToolContext` |
| `packages/sdk/src/define-tool.ts` | (exists) | — | Tool factory | `ToolContext` 2nd handler arg is additive/optional (backward-compat) |
| tests (NEW): `tests/agent-loop/tool-abort-timeout.test.ts`, `tests/job-queue-cancel-concurrency.test.ts`, `tests/permission-engine-args.test.ts`, `tests/internal/plugins/dead-hooks-wired.test.ts`, `tests/agent-loop/tool-result-transform.test.ts` | 0 | — | RED regression per defect | — |

### Current callers / dependents

- **`PermissionEngine.evaluate`** (`permission-engine.ts:38`) — **PUBLIC** (exported from `index.ts` + `types/agent.ts`). Callers: `permission-plugin.ts`, `subagents.ts`, `internal/runtime/skills/subagent-tool-scope.ts`. Signature change MUST be additive (2nd arg optional); default-posture change is a public behavior change → `docs.md` + migration note.
- **`JobQueue`** (`job-queue.ts`) — **PUBLIC**, widely consumed: `internal/llm/{ollama-native,sse}.ts`, `types/batch.ts`, `subscription/internal/subscription-runtime.ts`, `internal/runtime/cloud/real-cloud-run.ts`, `internal/runtime/local-agent/local-agent-task-wrap.ts`, `cron.ts`. Changes MUST be additive (new opts default to current behavior).
- **`runToolWithLifecycle`** (`tool-dispatch.ts:250`) — internal; called by `dispatchSingleCall`. `inputs` already flows through — thread `signal` from there.
- **`HookName`** (`types.ts:20`) — 10 hooks declared; 3 wired (`pre_tool_call`, `pre_user_send`, `post_assistant_reply`). 7 to wire.

### Domain glossary

- **silent no-op** — a declared surface (hook, config option) that exists in the type/API but is never invoked at runtime (`no-stubs-no-mocks-no-wired §3`).
- **transform hook** — a hook that returns a possibly-modified payload (`transform_tool_result`, `transform_llm_output`), folded over plugins.
- **ToolContext** — a 2nd argument to a tool handler carrying `signal` (+ optional `requestConfirmation`/`requestCredential`, adk-grounded).
- **fail-closed** — when a permission engine cannot positively allow, it denies/asks (not allows).
- **per-tool timeout** — an `AbortSignal.timeout` bounding a single tool call, merged with the run signal.

### Architecture boundaries affected

- `agent-loop/` (internal) — #58 + #65 hook insertion; intra-layer.
- `permission-engine.ts` (public) — #55 signature + default; public-API boundary → `docs.md`.
- `job-queue.ts` (public) — #58 additive API; public-API boundary.
- `plugins/` (internal) — #65 new run*Hooks; `define-tool.ts` (public) ToolContext arg additive.

## Prior Art & Related Work

- **Internal blueprint:** `knowledge-base/discoveries/blueprints/m1-harness-correctness-blueprint.md` (SHIPPABLE 99.2) — Techniques T1–T4, ADRs D1–D4, per-hook wiring table.
- **Reference projects (read-only):** opencode `reference/opencode/packages/opencode/src/{util/queue.ts:21,session/tools.ts:40}` (queue bound + signal-on-tool); codex `reference/codex/codex-rs/execpolicy/src/rule.rs:40` (arg-matching) + `tests/basic.rs:170` (deny test); adk-js `reference/adk-js/core/src/plugins/base_plugin.ts:70` (callback contract) + `agents/context.ts:123,184` (ToolContext); mastra `reference/mastra/packages/core/src/a2a/a2a-agent.ts:1517` (`AbortSignal.timeout`); crewAI `reference/crewAI/lib/crewai/src/crewai/task.py:246` (guardrail-retry).
- **Project rules:** `parsimony-ladder.md` (stdlib before dep), `error-handling.md` (typed, fail-closed), `testing.md §4.1`, `no-stubs-no-mocks-no-wired.md`, `architecture.md`.

## Objective

- [ ] #58 — a cancelled run interrupts an in-flight tool handler; a per-tool timeout rejects a typed error; `JobQueue.cancel` aborts a running job; `maxConcurrency` bounds concurrent jobs.
- [ ] #55 — `PermissionRule.args` gates on arguments; `evaluate(toolName, args?)` denies `shell`+`rm -rf`, passes `shell`+`ls`; default flips fail-closed (documented public change).
- [ ] #65 — all 7 dead hooks wired (each invokes its handler; anti-dead-hook test per hook); `ToolContext` 2nd arg carries `signal`.
- [ ] #57 — `transform_tool_result` scrubs/delimits tool-result content (injected marker delimited; PII redacted).
- [ ] Full `@theokit/sdk` suite green; typecheck + Biome clean; `docs.md` + changesets updated.

## ADRs

### D1 — #58: stdlib AbortSignal→tools + per-tool timeout + JobQueue abort-on-cancel + concurrency (blueprint D1)

**Decision:** Thread `inputs.signal` into `runToolWithLifecycle` → tool handler; wrap each tool in `AbortSignal.any([runSignal, AbortSignal.timeout(perToolTimeoutMs)])`, rejecting an aborted/timed-out handler with a typed error; add a between-iteration `signal.aborted` check in `loop.ts`. `JobQueue`: store an `AbortController` per job (`.abort()` in `cancel()`); add an additive `maxConcurrency` semaphore.

**Rationale:** opencode/mastra prove the stdlib model; Node ≥22.12 has `AbortSignal.any`/`.timeout` (parsimony rung 2). Cancel-that-doesn't-interrupt + unbounded queue are silent bugs (`no-stubs-no-mocks-no-wired`).

**Alternatives considered:** `p-queue`/`p-timeout` (rejected — parsimony); status-only cancel (rejected — the cancel lies); global timeout (rejected — a hung tool shouldn't need whole-run abort).

**Consequences:** cancel interrupts; hung tool times out typed; queue bounded. `JobQueue`/tool changes additive (defaults preserve current behavior).

### D2 — #55: argument-level permission gating + fail-closed default (blueprint D2)

**Decision:** Add optional `args?` matcher to `PermissionRule` (`Record<string, string | RegExp | (v:unknown)=>boolean>`); `evaluate(toolName, args?)` (2nd arg optional — backward-compat); a rule with `args` matches only when name AND every arg predicate match. Flip `defaultAction` default to fail-closed (`"ask"`) with an explicit `"allow"` opt-out + a documented migration note.

**Rationale:** codex's execpolicy proves arg-gating + explicit default posture; name-only + fail-open is the hole (`shell` allow can't stop `rm -rf`). Fail-closed is the `error-handling.md` posture.

**Alternatives considered:** name-only + separate blocklist (rejected — trivially bypassable, per codex finding); keep fail-open default (rejected — a default-allow permission engine is theatre).

**Consequences:** rules gate on args; safe default. Public API change → `docs.md` + CHANGELOG + migration note. Existing `evaluate(name)` calls still compile.

### D3 — #65: wire the 7 dead hooks + minimal ToolContext (blueprint D3)

**Decision:** Add 7 `run*Hooks` methods to `PluginManager` (mirroring the existing 3) and invoke each at its pinned site (per the blueprint table): `post_tool_call` (after tool finalize), `pre_llm_call`/`post_llm_call` (around the LLM stream), `on_session_start`/`on_session_end` (loop init/finally), `transform_tool_result`/`transform_llm_output` (fold-transform before payload flows on). Thread a minimal `ToolContext` 2nd handler arg carrying `signal`. Full confirmation/credential round-trip is a documented follow-up.

**Rationale:** adk proves the callback contract; a declared hook that never fires is the exact `no-stubs-no-mocks-no-wired §3` class M1 targets. Each dead hook has a natural site.

**Alternatives considered:** remove all 7 from `HookName` (rejected — useful seams); wire only transform hooks (rejected — partial honesty); full ToolContext now (deferred — scope).

**Consequences:** every declared hook fires; `transform_tool_result` becomes the #57 seam. `ToolContext` arg additive.

### D4 — #57: tool-result content defense via transform_tool_result (blueprint D4)

**Decision:** Ship a built-in `transform_tool_result` behavior: delimit/spotlight tool output (wrap untrusted content in explicit data boundaries so the model treats it as data) + optional PII regex redaction, running before results reach the LLM.

**Rationale:** the seam is the wired hook (D3), not a bolt-on; crewAI's guardrail-retry is the validation precedent. Honest partial: delimiting/PII is partly external best-practice (peers thin, EC-4).

**Alternatives considered:** ad-hoc scrub outside the hook (rejected — the hook exists for this); LLM-judge classifier (rejected — YAGNI for M1).

**Consequences:** tool results carry explicit boundaries; PII redacted. Opt-in intensity to avoid over-scrubbing legitimate content.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| #55 flipping default to fail-closed breaks callers relying on default-allow | Medium | Documented public change + migration note; existing explicit `defaultAction:"allow"` still honored; changeset § Changed with `BREAKING:` note if needed | SDK |
| #58 threading signal into the hot tool path risks regressions across the loop | Medium | Additive (default no-timeout preserves behavior); full suite gate; isolate per-phase | SDK |
| #58 JobQueue changes touch 8 consumers | Medium | Additive-only (new opts default to current); typecheck + each consumer's tests | SDK |
| #65 wiring 7 hooks may surface latent consumer assumptions (a hook firing that never did) | Low | Anti-dead-hook tests; hooks are opt-in (only fire if a plugin registered them) | SDK |
| #57 over-scrubbing legitimate tool content (false-positive redaction) | Low | Opt-in intensity; delimiting (non-destructive) default; PII redaction conservative + tested | SDK |
| tool-dispatch.ts (408) / loop.ts (400) near 500 LoC budget | Low | Extract helpers if a phase pushes over; measure per phase | SDK |

## Unresolved Questions

- Q1 — Should the #55 fail-closed default be `"ask"` or `"deny"`? (Plan: `"ask"` — least-destructive fail-closed; confirm in review.)
- Q2 — Does full `ToolContext.requestConfirmation`/`requestCredential` fit M1's budget, or defer to a follow-up? (Plan: thread `signal` now; defer the round-trip; confirm.)
- Q3 — Should `transform_tool_result` PII redaction be on-by-default or opt-in? (Plan: delimiting on-by-default (non-destructive), PII redaction opt-in; confirm.)

## Dependencies

**No new runtime or dev dependencies.** All four fixes use Node stdlib only, per `parsimony-ladder.md` rung 2 and blueprint Corner 2:

| Dependency | Version | New? | Rationale |
|---|---|---|---|
| Node stdlib `AbortSignal.any` / `AbortSignal.timeout` | Node ≥22.12 (pinned floor) | No (runtime) | #58 per-tool timeout + merged run/timeout signal — no `p-timeout` |
| Node stdlib `AbortController` | built-in | No | #58 JobQueue per-job abort |
| Node stdlib `Promise.race` / `Promise.all` | built-in | No | #58 concurrency semaphore + timeout fallback |
| Node stdlib `RegExp` | built-in | No | #55 arg matcher · #57 PII redaction |

CVE surface: unchanged (no manifest edit). `/deps-audit` expected PASS.

## Dependency Graph

```
Phase 1 (#58 abort/timeout/queue) ─┐
Phase 2 (#65 wire 7 hooks + ToolContext) ─┤ P3 depends on P2 (transform_tool_result must be wired first)
Phase 3 (#57 tool-result transform) ──────┘
Phase 4 (#55 permission arg-gating) ─ independent
        │
        ▼
Phase 5 — Integration Validation
```

Phase 3 (#57) depends on Phase 2 (#65) — the `transform_tool_result` hook must be wired before #57 uses it. Phases 1, 2, 4 are independent. Sequenced by dependency + gap-count.

---

## Phase 1: #58 — AbortSignal→tools + per-tool timeout + JobQueue

**Objective:** A cancelled run interrupts in-flight tools; a per-tool timeout fires; JobQueue cancel aborts + concurrency is bounded.

### T1.1 — Thread signal + per-tool timeout into tool dispatch; between-iteration abort

#### Objective
Make cancellation actually interrupt a running tool and add a per-tool timeout.

#### Why this step (action + reasoning)
1. **What** — thread `inputs.signal` into `runToolWithLifecycle` → tool handler; wrap each tool in `AbortSignal.any([runSignal, AbortSignal.timeout(perToolTimeoutMs)])`; add a `signal.aborted` check between loop iterations.
2. **Why now** — `runToolWithLifecycle` (`tool-dispatch.ts:250`) receives no signal/timeout; `loop.ts` never checks abort between iterations (ADR D1, blueprint T1). #58 is 8 gaps of silent cancellation failure.

#### Evidence
`tool-dispatch.ts:250` `runToolWithLifecycle` — no signal param. `loop.ts` — no between-iteration abort. Peer: `reference/opencode/packages/opencode/src/session/tools.ts:40` (signal on tool ctx); `reference/mastra/packages/core/src/a2a/a2a-agent.ts:1517` (`AbortSignal.timeout`).

#### Files to edit
```
packages/sdk/src/internal/agent-loop/tool-dispatch.ts — thread signal + AbortSignal.any timeout into runToolWithLifecycle
packages/sdk/src/internal/agent-loop/loop.ts — between-iteration signal.aborted check
packages/sdk/tests/agent-loop/tool-abort-timeout.test.ts (NEW) — RED: aborted run stops handler; per-tool timeout rejects typed
```

#### Deep file dependency analysis
- `tool-dispatch.ts`: `inputs.signal` already available on `AgentLoopInputs`; pass to `runToolWithLifecycle` → tool `handler`. Downstream: `dispatchSingleCall` unchanged shape. Watch the 500 LoC budget (currently 408).
- `loop.ts`: add an early `if (inputs.signal?.aborted) break/return` at the top of each iteration.

#### Deep Dives
- Merge signals: `AbortSignal.any([runSignal, AbortSignal.timeout(ms)])` — Node ≥22.12. On abort, the handler receives an aborted signal; wrap the tool exec so an aborted/timed-out call rejects a typed error (`ToolAbortedError`/`tool_timeout`).
- Invariant: default `perToolTimeoutMs` undefined = no timeout (preserves current behavior).
- Edge: a tool that ignores its signal — the timeout still races the exec via `Promise.race` fallback.

#### Concurrency tests

Cancellation / timeout (applicable — abort + timer). `tool_abort_interrupts_handler()` asserts a long-running handler stops when the run signal aborts; `per_tool_timeout_rejects_typed()` asserts a hung tool rejects a typed timeout within the deadline. Cancellation propagation is the race-aware proof.

#### TDD
```
RED:  tool_abort_interrupts_in_flight_handler() — a tool handler that awaits a never-resolving promise; abort the run signal → the dispatch rejects/settles (handler does not run to completion)
RED:  per_tool_timeout_rejects_typed_error() — a hung tool + short perToolTimeoutMs → typed tool_timeout error
RED:  loop_checks_abort_between_iterations() — signal aborted before iteration N → loop stops, no further tool dispatch
GREEN: thread signal + AbortSignal.any timeout; add loop abort check
REFACTOR: extract a `withToolSignal` helper if tool-dispatch nears 500 LoC
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/agent-loop/tool-abort-timeout.test.ts
```

#### Acceptance Criteria
- [ ] Aborting the run interrupts an in-flight tool handler — `tool_abort_interrupts_in_flight_handler()` asserts the handler does not run to completion (`pnpm test tests/agent-loop/tool-abort-timeout.test.ts`).
- [ ] Per-tool timeout rejects a typed `tool_timeout` error within the deadline — `per_tool_timeout_rejects_typed_error()` asserts the specific error code.
- [ ] Loop stops between iterations when aborted — `loop_checks_abort_between_iterations()` asserts no further tool dispatch after abort.
- [ ] No new dep; complexity ≤ 10; changed files ≤ 500 LoC; Biome clean; coverage ≥ 90% (100% on abort/timeout paths).

#### DoD
- [ ] `pnpm --filter @theokit/sdk test` green; typecheck + Biome clean; changeset entry (#58).

### T1.2 — JobQueue abort-on-cancel + concurrency bound

#### Objective
Make `JobQueue.cancel` abort a running job and bound concurrency.

#### Why this step
1. **What** — store an `AbortController` per job, `.abort()` in `cancel()`; add an additive `maxConcurrency` semaphore.
2. **Why now** — `job-queue.ts` `cancel` sets status only (running work continues); no concurrency bound (ADR D1). Public, widely consumed → additive only.

#### Evidence
`job-queue.ts` `cancel`/`enqueue` (68 LoC). Peer: `reference/opencode/packages/opencode/src/util/queue.ts:21` (worker-pool bound).

#### Files to edit
```
packages/sdk/src/job-queue.ts — per-job AbortController + cancel().abort(); additive maxConcurrency semaphore
packages/sdk/tests/job-queue-cancel-concurrency.test.ts (NEW) — RED: cancel aborts running job; N+1th enqueue waits under maxConcurrency
```

#### Deep file dependency analysis
- `job-queue.ts`: `enqueue<T>(fn)` — pass an `AbortSignal` into `fn` (additive; fn may ignore it). Constructor gains optional `{ maxConcurrency }`. 8 consumers unaffected (defaults preserve behavior).

#### Concurrency tests

Cancellation + atomic-counter invariant (applicable). `cancel_aborts_running_job()` asserts a running job's signal aborts. `max_concurrency_bounds_running()` — enqueue N+1 jobs with `maxConcurrency=N`; assert at most N run concurrently (counter invariant) and the N+1th starts only after one finishes.

#### TDD
```
RED:  cancel_aborts_a_running_job() — enqueue a job awaiting its signal; cancel(id) → the job's signal.aborted true / job settles cancelled
RED:  max_concurrency_bounds_concurrent_jobs() — maxConcurrency=2, enqueue 3 slow jobs → at most 2 run at once; 3rd waits
RED:  default_unbounded_behavior_preserved() — no maxConcurrency → current behavior (backward-compat)
GREEN: per-job AbortController + semaphore
REFACTOR: none expected
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/job-queue-cancel-concurrency.test.ts
```

#### Acceptance Criteria
- [ ] `cancel(id)` aborts a running job (`cancel_aborts_a_running_job()`), `maxConcurrency` bounds concurrent jobs (`max_concurrency_bounds_concurrent_jobs()` atomic-counter invariant), default unbounded behavior preserved (`default_unbounded_behavior_preserved()`).
- [ ] Additive public API (existing consumers compile unchanged); complexity ≤ 10; ≤ 500 LoC; Biome clean.

#### DoD
- [ ] `pnpm --filter @theokit/sdk test` green; typecheck + Biome clean; `docs.md` note for the new JobQueue opts; changeset (#58).

---

## Phase 2: #65 — Wire the 7 dead hooks + minimal ToolContext

**Objective:** Every declared hook fires; tools receive a `ToolContext` with `signal`.

### T2.1 — Add 7 run*Hooks to PluginManager + invoke at pinned sites + ToolContext.signal

#### Objective
Wire `post_tool_call`, `pre_llm_call`, `post_llm_call`, `on_session_start`, `on_session_end`, `transform_tool_result`, `transform_llm_output`; thread `ToolContext.signal`.

#### Why this step
1. **What** — add the 7 `run*Hooks` methods (mirroring the existing 3) + invoke each at its blueprint-pinned site; add a minimal `ToolContext` 2nd handler arg with `signal`.
2. **Why now** — 7 of 10 declared hooks are silent no-ops (`no-stubs-no-mocks-no-wired §3`); a consumer registering `post_tool_call` gets nothing (ADR D3, blueprint T3).

#### Evidence
`types.ts:20` `HookName` (10) vs `manager.ts` (3 wired). Per-hook sites in blueprint T3 table. Peer: `reference/adk-js/core/src/plugins/base_plugin.ts:70`, `agents/context.ts:123,184`.

#### Files to edit
```
packages/sdk/src/internal/plugins/manager.ts — add runPostToolCallHooks / runPreLlmCallHooks / runPostLlmCallHooks / runOnSessionStartHooks / runOnSessionEndHooks / runTransformToolResultHooks / runTransformLlmOutputHooks
packages/sdk/src/internal/plugins/types.ts — add the 5 hook context types + ToolContext
packages/sdk/src/internal/agent-loop/tool-dispatch.ts — invoke post_tool_call after finalize; pass ToolContext.signal to handler
packages/sdk/src/internal/agent-loop/loop-llm-stream.ts — invoke pre/post_llm_call around the stream
packages/sdk/src/internal/agent-loop/loop.ts — invoke on_session_start/end + transform_llm_output at their sites
packages/sdk/src/define-tool.ts — ToolContext 2nd arg (optional, additive)
packages/sdk/tests/internal/plugins/dead-hooks-wired.test.ts (NEW) — RED: a plugin registered on EACH of the 7 hooks is invoked
```

#### Deep file dependency analysis
- `manager.ts`: mirror the existing `runPreToolCallHooks` pattern (fire-in-order; transform hooks fold the payload). `#merge`/`register` (M0) unchanged.
- `types.ts`: additive context interfaces; `HookName` unchanged (all 10 kept). `ToolContext` additive.
- loop/dispatch/stream: additive invocation at each pinned site.

#### Concurrency tests

(none — single-threaded) — Hook invocation runs on the event loop; the anti-dead-hook proof is invocation, not a race.

#### TDD
```
RED:  post_tool_call_hook_is_invoked() — register a post_tool_call plugin; run a tool → handler fired
RED:  pre_and_post_llm_call_hooks_invoked() — around a (fixture) LLM turn → both fired
RED:  on_session_start_and_end_hooks_invoked() — a run → both fired
RED:  transform_tool_result_hook_can_modify_results() — a transform plugin mutates a tool result → the modified value flows on
RED:  transform_llm_output_hook_can_modify_output() — a transform plugin mutates llm output → modified value flows on
RED:  tool_handler_receives_ToolContext_signal() — a tool handler reads its 2nd arg's signal
GREEN: add run*Hooks + invoke at sites + ToolContext
REFACTOR: extract a shared fold-transform helper for the 2 transform hooks
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/internal/plugins/dead-hooks-wired.test.ts
```

#### Acceptance Criteria
- [ ] Each of the 7 hooks invokes its registered handler — `dead-hooks-wired.test.ts` asserts `callLog` contains each hook name (`pnpm test tests/internal/plugins/dead-hooks-wired.test.ts`).
- [ ] Transform hooks modify the payload (`transform_tool_result_hook_can_modify_results()` asserts the modified value flows on); `ToolContext.signal` reaches the handler (`tool_handler_receives_ToolContext_signal()`).
- [ ] `HookName` unchanged (no capability removed); additive types; complexity ≤ 10; ≤ 500 LoC; Biome clean.

#### DoD
- [ ] `pnpm --filter @theokit/sdk test` green; typecheck + Biome clean; `docs.md` (hooks + ToolContext); changeset (#65).

---

## Phase 3: #57 — Tool-result content defense via transform_tool_result

**Objective:** Tool-result content is delimited (injection defense) + PII-redactable before reaching the LLM.

### T3.1 — Built-in transform_tool_result delimiting + opt-in PII redaction

#### Objective
Wrap untrusted tool output in explicit data boundaries + optional PII regex redaction.

#### Why this step
1. **What** — a built-in `transform_tool_result` behavior: delimit/spotlight tool output; opt-in PII redaction.
2. **Why now** — no content-level defense on tool results (ADR D4); the seam (`transform_tool_result`) is wired in Phase 2.

#### Evidence
No injection/PII defense on tool results in the loop. Peer: `reference/crewAI/lib/crewai/src/crewai/task.py:246` (guardrail-retry precedent).

#### Files to edit
```
packages/sdk/src/internal/agent-loop/ (new small module) tool-result-guard.ts (NEW) — delimit + optional PII redaction
packages/sdk/src/internal/agent-loop/loop.ts — apply the guard at the transform_tool_result site
packages/sdk/tests/agent-loop/tool-result-transform.test.ts (NEW) — RED: injected marker delimited; PII redacted when enabled
```

#### Deep file dependency analysis
- New leaf `tool-result-guard.ts`: pure functions (delimit, redactPii). Consumed at the loop's `transform_tool_result` site (Phase 2).

#### Deep Dives
- Delimiting: wrap tool output in explicit boundaries (e.g. `<tool-output>…</tool-output>` or an untrusted-data marker) so the model treats it as data. Non-destructive (default on).
- PII redaction (opt-in): conservative regexes (emails, phone, common secret patterns) → `[REDACTED]`. Off by default to avoid over-scrubbing.
- Invariant: legitimate tool output is not corrupted (delimiting is additive wrapping; redaction opt-in).

#### Concurrency tests

(none — single-threaded) — Pure content transform; no shared state.

#### TDD
```
RED:  injected_instruction_marker_is_delimited() — a tool result containing "IGNORE PREVIOUS INSTRUCTIONS…" is wrapped in explicit data boundaries (not passed as bare instruction)
RED:  pii_redacted_when_enabled() — with PII redaction on, an email/phone in a tool result → [REDACTED]
RED:  legitimate_output_preserved() — normal tool output content is intact (delimiting only wraps; no redaction when off)
GREEN: implement tool-result-guard + wire at the transform site
REFACTOR: none expected
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/agent-loop/tool-result-transform.test.ts
```

#### Acceptance Criteria
- [ ] An injected marker is delimited (`injected_instruction_marker_is_delimited()`), PII is redacted when enabled (`pii_redacted_when_enabled()` asserts `[REDACTED]`), legitimate output is preserved (`legitimate_output_preserved()`).
- [ ] New module a clean leaf; complexity ≤ 10; ≤ 500 LoC; Biome clean.

#### DoD
- [ ] `pnpm --filter @theokit/sdk test` green; typecheck + Biome clean; `docs.md` (tool-result guard); changeset (#57 + § Security).

---

## Phase 4: #55 — Argument-level permission gating + fail-closed default

**Objective:** Permission rules gate on arguments; the default is fail-closed.

### T4.1 — Extend PermissionRule.args + evaluate(toolName, args?) + fail-closed default

#### Objective
Gate permission on command/arguments, not just tool name; flip the default posture.

#### Why this step
1. **What** — add optional `args?` matcher to `PermissionRule`; `evaluate(toolName, args?)` (additive 2nd arg); flip `defaultAction` default to `"ask"` (fail-closed) with `"allow"` opt-out.
2. **Why now** — `evaluate` matches name only + fail-open default (`permission-engine.ts:31,38`); a `shell` allow rule can't stop `rm -rf` (ADR D2). Public API.

#### Evidence
`permission-engine.ts:11,31,38`. Peer: `reference/codex/codex-rs/execpolicy/src/rule.rs:40` (arg-matching) + `tests/basic.rs:170` (deny test).

#### Files to edit
```
packages/sdk/src/permission-engine.ts — PermissionRule.args?; evaluate(toolName, args?); default "ask"
packages/sdk/tests/permission-engine-args.test.ts (NEW) — RED: shell+rm-rf denied, shell+ls passes; fail-closed default denies/asks on no-match
docs.md — document the new args matcher + default-posture change + migration note
```

#### Deep file dependency analysis
- `permission-engine.ts` (public): additive `args?` on `PermissionRule`; `evaluate` 2nd arg optional (existing `evaluate(name)` calls compile). Callers (`permission-plugin.ts`, `subagents.ts`, `subagent-tool-scope.ts`) unaffected unless they rely on the fail-open default — the default flip is the documented public change.

#### Deep Dives
- `args` matcher: `Record<string, string | RegExp | (v:unknown)=>boolean>`; a rule matches when tool name matches AND every declared arg predicate matches the corresponding arg value. Rules without `args` behave as today (name-only).
- Default posture: `defaultAction ?? "ask"` (was `"allow"`). Migration note: pass `{ defaultAction: "allow" }` to restore prior behavior.
- Edge: a rule with `args` but the call has no such arg → predicate fails → rule doesn't match (falls through).

#### Concurrency tests

(none — single-threaded) — Pure evaluation function.

#### TDD
```
RED:  rule_denies_shell_with_rm_rf_args() — rule {tool:"shell", args:{command:/rm\s+-rf/}, action:"deny"}; evaluate("shell",{command:"rm -rf /"}) → "deny"
RED:  same_rule_passes_shell_with_ls() — evaluate("shell",{command:"ls"}) → falls through (not denied by that rule)
RED:  default_is_fail_closed() — no matching rule + no defaultAction → "ask" (not "allow")
RED:  explicit_allow_default_still_honored() — {defaultAction:"allow"} restores prior behavior
RED:  name_only_rules_still_work() — a rule without args gates by name (backward-compat)
GREEN: add args matcher + evaluate(name,args?) + flip default
REFACTOR: none expected
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/permission-engine-args.test.ts
```

#### Acceptance Criteria
- [ ] Arg-level deny works (`rule_denies_shell_with_rm_rf_args()` returns `"deny"`); name-only rules still work (`name_only_rules_still_work()`); default is fail-closed (`default_is_fail_closed()` returns `"ask"`); explicit allow honored (`explicit_allow_default_still_honored()`).
- [ ] Additive public API (existing `evaluate(name)` compiles); `docs.md` updated; complexity ≤ 10; ≤ 500 LoC; Biome clean.

#### DoD
- [ ] `pnpm --filter @theokit/sdk test` green; typecheck + Biome clean; `docs.md` + migration note; changeset (#55 § Changed with migration note).

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | #58 cancel doesn't interrupt tools + no per-tool timeout + JobQueue cancel/concurrency | T1.1, T1.2 | signal→handler + AbortSignal.timeout + loop abort check; JobQueue abort-on-cancel + maxConcurrency |
| 2 | #65 7/10 hooks silent no-op + no ToolContext | T2.1 | 7 run*Hooks wired at pinned sites + ToolContext.signal; anti-dead-hook test per hook |
| 3 | #57 no tool-result content defense | T3.1 | transform_tool_result delimiting + opt-in PII redaction |
| 4 | #55 permission name-only + fail-open | T4.1 | PermissionRule.args + evaluate(name,args?) + fail-closed default |

**Coverage: 4/4 gaps covered (100%)**

## Global Definition of Done

- [ ] All 5 phases completed — every task DoD ticked
- [ ] All tests pass — `pnpm test` exits 0 (sdk suite green)
- [ ] Typecheck emits zero errors — `pnpm typecheck` exits 0
- [ ] Biome emits zero warnings — `pnpm lint` exits 0
- [ ] Every changed file measures ≤ 500 lines — `wc -l` returns ≤ 500 (per `architecture.md`)
- [ ] CHANGELOG updated — a changeset per defect (#55/#57/#58/#65) with the public-API/behavior notes
- [ ] `docs.md` updated for public changes (PermissionEngine args + default; JobQueue opts; hooks + ToolContext; tool-result guard)
- [ ] Backward compatibility — additive APIs; the only intentional behavior change (permission default fail-closed) is documented with a migration note
- [ ] The RED regression tests each print FAIL against pre-fix code then PASS after
- [ ] Runtime-metric proof — abort/timeout, hook invocation, and tool-result transform are asserted in tests non-vacuously

## Failure scenarios (external I/O — tool exec + LLM stream + queue)

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| Tool handler (in-process, may await I/O) | hangs forever | a handler awaiting a never-resolving promise + short perToolTimeoutMs | rejects a typed `tool_timeout`; the run is not wedged |
| Run cancellation (AbortSignal) | user cancels mid-tool | abort the run signal during a slow handler | the in-flight tool is interrupted; loop stops between iterations |
| JobQueue job | cancel a running job | enqueue a slow job, `cancel(id)` | the job's signal aborts; status settles cancelled |
| Tool result content | injected instruction / PII | a tool result with an injection marker / an email | delimited (data boundary) / redacted when enabled — not executed as instruction |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validate the four fixes work together in the real SDK suite.

### Execution
```
pnpm --filter @theokit/sdk test          # full sdk suite (incl. new abort/queue/permission/hooks/transform tests)
pnpm typecheck                           # zero errors
pnpm lint                                # Biome clean
pnpm --filter @theokit/sdk test -- --coverage   # ≥ 90% on changed files
```
Chaos/failure pass (the `## Failure scenarios` rows):
```
pnpm --filter @theokit/sdk exec vitest run tests/agent-loop/tool-abort-timeout.test.ts tests/job-queue-cancel-concurrency.test.ts tests/agent-loop/tool-result-transform.test.ts
```

### Acceptance Criteria
- [ ] All suites green
- [ ] Coverage ≥ 90% on changed files (100% on abort/timeout/permission/transform paths)
- [ ] Zero type errors; zero Biome warnings
- [ ] Every `## Failure scenarios` row exercised
- [ ] The abort/timeout/hook/transform effects observed in tests, not just compiled

### If Validation Fails
1. Separate plan-caused from pre-existing failures.
2. Fix all plan-caused failures.
3. Re-run the chain.
4. Log pre-existing issues in the PR description.
