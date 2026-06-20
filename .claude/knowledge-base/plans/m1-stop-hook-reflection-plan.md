---
slug: m1-stop-hook-reflection
created_at: 2026-06-20
goal: Fire the declared HookEvent "stop" at the agent loop's clean-finish terminal and honor a hook decision:"feedback" as a bounded in-loop re-prompt, measured by tests/internal/agent-loop/stop-hook-reflection.test.ts passing green.
---

# Plan: M1-4 — Fire the `stop` hook + honor `feedback` as a bounded re-prompt

> **Version 1.1** (absorbed edge-case review `reviews/m1-stop-hook-reflection-edge-cases-2026-06-20.md`: EC-1/EC-2 folded into T1.1 TDD — ceiling counts feedback re-prompts + the error-terminal test exercises continueOrTerminate routing via a spy; EC-3/EC-4 documented in Drawbacks) — The file-based hook system declares `HookEvent "stop"` but never dispatches it (only `preRun`/`preToolUse`/`postToolUse` fire). This plan fires `stop` at the agent loop's clean-finish terminal and, when a `stop` hook returns `decision: "feedback"`, pushes that feedback as a `user` re-prompt and continues the loop — a bounded reflection ladder — reusing the existing `HooksExecutor` and the `MAX_NUDGE_ATTEMPTS` bounded-re-prompt pattern. Closes roadmap gap M1-4. Design locked by blueprint `m1-stop-hook-reflection` (discover-confidence SHIPPABLE 99.2).

## Goal

> "Enable a `stop` file-based hook to inspect the agent's clean finish and drive a bounded corrective re-prompt (reflection ladder) so a continued run can self-correct without an infinite loop, measured by `tests/internal/agent-loop/stop-hook-reflection.test.ts` passing green."

## Context

Roadmap gap M1-4 (`gap-audit/THEOKIT_GAP_AUDIT.md`): `HookEvent "stop"` is declared (`packages/sdk/src/internal/runtime/hooks/hooks-executor.ts:18`, `hooks-frontmatter.ts:16`) but never fired — only `preRun` (`local-agent.ts:360`), `preToolUse` + `postToolUse` (`tool-dispatch.ts:223,311`) dispatch. A user who registers a `stop` hook gets nothing.

The `HooksExecutor.run(payload)` already returns `{ decisions, blocked }` with `decision: "allow"|"deny"|"feedback"` + `feedback?: string` (`hooks-executor.ts:69-86`); `preToolUse` already consumes it via `inputs.hooks.run({...})` (`tool-dispatch.ts:223`). The loop already ships a BOUNDED corrective re-prompt: `shouldNudgeAndContinue` pushes a `user` message while `ctx.nudgeAttempts < MAX_NUDGE_ATTEMPTS` (=2) and finishes at `ctx.finalStatus="finished"; return "done"` (`loop.ts:212-231,276`). The loop's `AgentLoopInputs` already carries `hooks: HooksExecutor` (`loop-types.ts:73`).

M1-4 wires `stop` at the clean-finish terminal + maps a `feedback` decision onto a bounded re-prompt mirroring the nudge. Discovery (`knowledge-base/discoveries/blueprints/m1-stop-hook-reflection-blueprint.md`, SHIPPABLE 99.2) compared ADK-JS `afterAgentCallback` and CrewAI's bounded guardrail-retry against the first-party loop, locking four ADRs (dispatch point, feedback→re-prompt not output-replacement, ceiling, reuse-executor).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/internal/agent-loop/loop.ts` | 308 | `a66c3b3` | The agent loop: `runAgentLoop` + `continueOrTerminate` (clean finish at :276) + `shouldNudgeAndContinue` (bounded re-prompt :212-231) | clean-finish + nudge behavior preserved; `MAX_NUDGE_ATTEMPTS` untouched |
| `packages/sdk/src/internal/agent-loop/loop-context-init.ts` | 194 | `ed8c67d` | Builds `LoopContext` (`nudgeAttempts`, `finalStatus`, …) | existing fields preserved; additive only |
| `packages/sdk/src/internal/runtime/hooks/hooks-executor.ts` | 148 | `31ba23b` | `HooksExecutor.run(payload)` → `{decisions, blocked}`; loads commands per `HookEvent` | `run` signature + `HookDecision` shape preserved (read-only reuse) |
| `packages/sdk/tests/internal/agent-loop/stop-hook-reflection.test.ts` (NEW) | 0 | — | (unit + integration tests — RED first) | — |
| `docs.md` | (contract) | — | Public API contract; hooks section at :1179 | additive note only |
| `packages/sdk/CHANGELOG.md` (root) + `.changeset/` (NEW) | — | — | changelog + changeset | additive `[Unreleased]`/changeset entry |

### Current callers / dependents

- **Symbol:** `continueOrTerminate(inputs, ctx, llmOutput)` in `loop.ts:265` (internal) — called by `runAgentLoop`'s turn driver (`loop.ts:262`). The clean-finish branch (`loop.ts:274-277`) is where `stop` fires. No external callers.
- **Symbol:** `HooksExecutor.run` (`hooks-executor.ts:69`) — REUSED unchanged; existing callers `tool-dispatch.ts:223,311`, `local-agent.ts:360`.
- **Symbol:** `LoopContext` (`loop-context-init.ts`) — internal; gains an additive `stopFeedbackAttempts` field. Callers: `loop.ts` (read/write).
- No public barrel export changes — M1-4 is internal loop behavior + an existing file-based hook event going live.

### Domain glossary

- **stop hook** — a file-based hook registered under `HookEvent "stop"`, intended to fire when the agent finishes a turn cleanly.
- **decision** — a hook's structured stdout: `"allow" | "deny" | "feedback"` (+ optional `feedback` text), aggregated by `HooksExecutor.run`.
- **reflection ladder** — a bounded sequence of corrective re-prompts: the `stop` hook's `feedback` is fed back as a `user` message to make the model keep going, capped to prevent an infinite loop.
- **clean-finish terminal** — the loop path where the model stops without tool calls and the response is complete: `ctx.finalStatus="finished"; return "done"` (`loop.ts:276`). Distinct from the `error` terminal and the iteration-ceiling (`stoppedAtIterationLimit`).
- **nudge** — the existing bounded re-prompt (`shouldNudgeAndContinue`) used when the model stops with an incomplete answer.

### Architecture boundaries affected

Per `rules/architecture.md` §2: the change wires through the existing `HooksExecutor` port already on `AgentLoopInputs` (`loop-types.ts:73`) — no new infra, no new dependency direction. It stays inside the agent-loop module; no public surface crosses outward (the only outward-visible change is documented behavior of the existing file-based `stop` hook).

## Prior Art & Related Work

- **Internal blueprint** `knowledge-base/discoveries/blueprints/m1-stop-hook-reflection-blueprint.md` (ADRs D1-D4) — the locked design source.
- **Reference** ADK-JS `afterAgentCallback` end-of-turn lifecycle (`.claude/knowledge-base/reference/adk-js/core/src/agents/base_agent.ts:169-205`) — fires after a clean impl completion, callbacks chain.
- **Reference** CrewAI bounded guardrail-retry (`.claude/knowledge-base/reference/crewAI/lib/crewai/src/crewai/task.py:273,1258-1262`) — `guardrail_max_retries`, error re-fed as context for retry.
- **First-party precedent** `shouldNudgeAndContinue` + `MAX_NUDGE_ATTEMPTS` (`packages/sdk/src/internal/agent-loop/loop.ts:26,212-231`) — the bounded re-prompt to mirror.
- **First-party reuse** `HooksExecutor.run` (`packages/sdk/src/internal/runtime/hooks/hooks-executor.ts:69`) + the `preToolUse` consumption pattern (`tool-dispatch.ts:223-234`).

## Objective

- [ ] `stop` is dispatched via `HooksExecutor.run({event:"stop", …})` at the clean-finish terminal (`loop.ts` continueOrTerminate), NOT on error/iteration-ceiling.
- [ ] A `stop` hook returning `decision:"feedback"` pushes the `feedback` string as a `user` message and continues the loop (re-prompt), mirroring the nudge.
- [ ] The reflection re-prompt is bounded by a new `LoopContext.stopFeedbackAttempts` + `MAX_STOP_FEEDBACK_ATTEMPTS`; at the ceiling the loop finishes anyway.
- [ ] `allow` / no-hook / `deny` decisions finish normally (no block semantics at stop).
- [ ] Zero new dependencies (reuse `HooksExecutor` + nudge pattern).
- [ ] docs.md hooks note + CHANGELOG + changeset.
- [ ] `tests/internal/agent-loop/stop-hook-reflection.test.ts` green; typecheck + Biome + knip clean.

## ADRs

### D1 — Dispatch `stop` at the clean-finish terminal only

**Decision:** fire `stop` at the loop's clean-finish branch (where `finalStatus` would become `"finished"`), before finishing. Do NOT fire on the `error` terminal or the iteration-ceiling.

**Rationale:** `stop` means "the agent decided it is done" — the clean finish. ADK fires its after-callback after a clean impl completion, not on abort (`base_agent.ts:169-205`). Error/ceiling are involuntary; re-prompting there masks failure / risks runaway cost. Blueprint ADR D1.

**Alternatives considered:** fire on every terminal (rejected — re-prompting after error/ceiling is dangerous); fire via `postRun` (rejected — `postRun` is a non-decision notification, out of scope).

**Consequences:** a `stop` hook sees only clean finishes; `postRun` remains unfired (separate future item).

### D2 — Map `decision:"feedback"` onto a bounded `user` re-prompt, NOT output replacement

**Decision:** on `decision:"feedback"` with a `feedback` string, push `{role:"user", content:[{type:"text", text: feedback}]}` and continue the loop (re-enter the turn), exactly like `shouldNudgeAndContinue`. `allow`/no-hook → finish; `deny` at stop → finish (no block semantics; treat as allow).

**Rationale:** the SDK's `stop` is a subprocess hook returning a decision (the `preToolUse` pattern at `tool-dispatch.ts:223-234`), not ADK's value-returning callback. Reusing the existing `feedback` decision + the nudge re-prompt is Rule 9/DRY and matches CrewAI's "re-feed the error as context for retry". Blueprint ADR D2.

**Alternatives considered:** replace model output with the hook text (rejected — foreign + dangerous: a hook would author the answer); new decision type (rejected — `feedback` already exists, YAGNI).

**Consequences:** consumers author a `stop` hook emitting `{"decision":"feedback","feedback":"…"}` to drive reflection.

### D3 — Bound the reflection with a ceiling mirroring `MAX_NUDGE_ATTEMPTS`

**Decision:** add `stopFeedbackAttempts: number` to `LoopContext` + a `MAX_STOP_FEEDBACK_ATTEMPTS` constant in `loop.ts`. While under the ceiling, a `feedback` decision re-prompts; at the ceiling, finish anyway (ignore further feedback).

**Rationale:** every reference bounds corrective re-prompts (CrewAI `guardrail_max_retries+1`; nudge `MAX_NUDGE_ATTEMPTS=2`). Without a ceiling a misbehaving hook loops forever. Same shape as the proven nudge ceiling (Rule 9). Blueprint ADR D3.

**Alternatives considered:** unbounded (rejected — infinite loop / runaway cost); reuse `nudgeAttempts` (rejected — distinct concerns; separate counters keep each ceiling clear, SRP).

**Consequences:** a deterministic upper bound on reflection rounds; the ceiling is a tuning knob (a future `SendOptions` knob is out of scope).

### D4 — Reuse `HooksExecutor`; zero new dependencies

**Decision:** dispatch `stop` through the existing `inputs.hooks.run(...)` path; no new module, no new dep.

**Rationale:** the executor already loads commands per event + aggregates decisions; `architecture.md` §2 (wire through the existing port); Rule 9. Blueprint ADR D4.

**Alternatives considered:** a new stop dispatcher (rejected — duplicates the executor); a programmatic JS-callback channel (rejected — hooks are file-based; plugins already cover programmatic hooks — scope creep).

**Consequences:** `stop` joins the existing fired events through one code path.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| A misbehaving `stop` hook always returning `feedback` could loop | Medium | `MAX_STOP_FEEDBACK_ATTEMPTS` ceiling (D3) finishes anyway; unit-tested ceiling case | SDK |
| Firing a subprocess hook at every clean finish adds latency | Low | The executor no-ops when no `stop` command is registered (`hooks-executor.ts:71` returns early on zero commands) — zero cost when unused | SDK |
| `deny` at stop has no obvious semantics (the answer already exists) | Low | Documented: `deny` at `stop` is treated as `allow` (finish) — no partial-output suppression; covered by a test | SDK |
| A `feedback` re-prompt could be dropped if the iteration budget is exhausted (EC-3) | Low | Acceptable defense-in-depth: reflection is bounded by BOTH `MAX_STOP_FEEDBACK_ATTEMPTS` AND `while (budget.shouldContinue())` (`loop.ts:47`); the unanswered pushed `user` message is harmless (run finishes) | SDK |
| `reflectAfterStop` does not check the abort signal mid-reflection (EC-4) | Low | Consistent with the existing `shouldNudgeAndContinue` precedent; an in-flight abort is honored at the next loop iteration's budget/gate check (`loop.ts:47-65`), not mid-hook | SDK |

## Unresolved Questions

- (none — every decision is resolved at plan time via blueprint ADRs D1-D4. The exact `MAX_STOP_FEEDBACK_ATTEMPTS` value is a tuning constant, not an open design question; propose 2, matching `MAX_NUDGE_ATTEMPTS`.)

## Dependency Graph

```
Phase 1 (fire stop + bounded feedback re-prompt) ──▶ Phase 2 (docs + changelog) ──▶ Final Phase (integration validation)
```

Sequential: Phase 2 documents Phase 1; Final validates both.

---

## Phase 1: Fire `stop` + bounded feedback re-prompt

**Objective:** dispatch `stop` at the clean-finish terminal and honor `feedback` as a bounded re-prompt, with full TDD.

### T1.1 — Dispatch `stop` + bounded `feedback` re-prompt in the loop

#### Objective
Add a `reflectAfterStop` helper that fires `inputs.hooks.run({event:"stop", …})` and decides whether to re-prompt; wire it into `continueOrTerminate`'s clean-finish branch; add `LoopContext.stopFeedbackAttempts` + `MAX_STOP_FEEDBACK_ATTEMPTS`.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — introduces an async helper that, at clean finish, fires the `stop` hook and (under the ceiling) pushes a `feedback` decision's text as a `user` re-prompt and signals "continue"; wires it into the one clean-finish branch.

2. **Why it is necessary now** — it is the whole deliverable, and it is the minimal change that makes the declared-but-dead `stop` event live. The algorithm is fully specified by ADRs D1-D3 and mirrors the existing `shouldNudgeAndContinue`, so it is written test-first without further discovery.

#### Evidence
Design source `.claude/knowledge-base/discoveries/blueprints/m1-stop-hook-reflection-blueprint.md` (ADRs D1-D3). Dispatch point `loop.ts:265-277` (continueOrTerminate clean finish). Reuse `inputs.hooks.run` (`hooks-executor.ts:69`), pattern from `tool-dispatch.ts:223-234`. Bounded-re-prompt precedent `loop.ts:212-231` (`shouldNudgeAndContinue` + `MAX_NUDGE_ATTEMPTS`). `LoopContext` at `loop-context-init.ts`. `AgentLoopInputs.hooks` at `loop-types.ts:73`.

#### Files to edit
```
packages/sdk/src/internal/agent-loop/loop.ts — add reflectAfterStop + MAX_STOP_FEEDBACK_ATTEMPTS; wire into continueOrTerminate clean-finish branch
packages/sdk/src/internal/agent-loop/loop-context-init.ts — add stopFeedbackAttempts: number (init 0)
packages/sdk/tests/internal/agent-loop/stop-hook-reflection.test.ts — NEW: RED tests first (TDD)
```

#### Deep file dependency analysis
- `loop.ts` — add `reflectAfterStop(inputs, ctx)` (async) + `MAX_STOP_FEEDBACK_ATTEMPTS`; call it in `continueOrTerminate` (`:274-277`) before `finalStatus="finished"`. Reads `inputs.hooks` (already on `AgentLoopInputs`), `inputs.agentId`/`inputs.runId`. Downstream: `runAgentLoop` turn driver consumes the `"continue"`/`"done"` return unchanged.
- `loop-context-init.ts` — add `stopFeedbackAttempts: 0` to the `LoopContext` literal; `LoopContext` type (in loop-context-init.ts) gains the field. Read/written only by `loop.ts`.
- `hooks-executor.ts` — REUSED unchanged (read-only).

#### Deep Dives
- **Helper signature:** `async function reflectAfterStop(inputs: AgentLoopInputs, ctx: LoopContext): Promise<boolean>` — returns `true` when the loop should re-prompt+continue, `false` to finish.
- **Logic (D1/D2/D3):**
  1. `if (ctx.stopFeedbackAttempts >= MAX_STOP_FEEDBACK_ATTEMPTS) return false;` (ceiling — finish).
  2. `const result = await inputs.hooks.run({ event: "stop", agentId: inputs.agentId, runId: inputs.runId });`
  3. find a feedback decision: `const fb = result.decisions.find(d => d.decision === "feedback" && (d.feedback ?? "").length > 0);`
  4. `if (fb === undefined) return false;` (allow/deny/none → finish).
  5. `ctx.stopFeedbackAttempts += 1; ctx.messages.push({ role: "user", content: [{ type: "text", text: fb.feedback! }] }); return true;`
- **Wire:** in `continueOrTerminate`, the clean-finish branch becomes: `if (shouldNudgeAndContinue(ctx, llmOutput)) return "continue"; if (await reflectAfterStop(inputs, ctx)) return "continue"; ctx.finalStatus = "finished"; return "done";`
- **Invariants:** `stop` fires ONLY on this clean-finish branch (error returns "error" earlier `loop.ts:270`; ceiling is the post-loop `while` exit — never reaches here). The executor no-ops when no `stop` command is registered (zero cost). `MAX_STOP_FEEDBACK_ATTEMPTS = 2`.
- **Edge cases:** no `stop` hook registered → `result.decisions` empty → finish; multiple decisions, first `feedback` wins; empty `feedback` string → ignored (finish); ceiling reached → finish even if a hook still says feedback.

#### Pseudo-code / Signatures
```pseudocode
const MAX_STOP_FEEDBACK_ATTEMPTS = 2
async function reflectAfterStop(inputs, ctx): boolean
  if ctx.stopFeedbackAttempts >= MAX_STOP_FEEDBACK_ATTEMPTS: return false
  result = await inputs.hooks.run({ event: "stop", agentId, runId })
  fb = result.decisions.find(d => d.decision == "feedback" && nonEmpty(d.feedback))
  if not fb: return false
  ctx.stopFeedbackAttempts += 1
  ctx.messages.push({ role: "user", content: [{ type: "text", text: fb.feedback }] })
  return true

# continueOrTerminate clean-finish branch
if shouldNudgeAndContinue(ctx, out): return "continue"
if await reflectAfterStop(inputs, ctx): return "continue"
ctx.finalStatus = "finished"; return "done"
```

#### Tasks
1. Write RED tests in `tests/internal/agent-loop/stop-hook-reflection.test.ts`.
2. Add `stopFeedbackAttempts: 0` to `LoopContext` init + type.
3. Add `MAX_STOP_FEEDBACK_ATTEMPTS` + `reflectAfterStop` in `loop.ts`.
4. Wire `reflectAfterStop` into `continueOrTerminate`'s clean-finish branch (after the nudge check).
5. REFACTOR for Biome cognitive-complexity ≤ 10.

#### TDD
```
RED: test_fires_stop_hook_on_clean_finish() — hooks.run called once with event "stop" when the model finishes cleanly
RED: test_feedback_decision_reprompts_and_pushes_user_message() — decision "feedback" → loop continues + a user message with the feedback text is appended
RED: test_reflection_is_bounded_by_ceiling() — a hook always returning feedback re-prompts at most MAX_STOP_FEEDBACK_ATTEMPTS times, then finishes
RED: test_allow_decision_finishes_normally() — decision "allow" (or no stop hook) → finishes, no extra message
RED: test_deny_at_stop_finishes_normally() — decision "deny" at stop → finishes (no block, treated as allow)
RED: test_stop_not_fired_on_error_terminal() — drive continueOrTerminate's ERROR path (errored llmOutput → returns "error" before the clean-finish branch) with a SPY on inputs.hooks.run; assert it was NEVER called with event "stop" (EC-2 — must exercise routing, not the pure helper, else vacuous)
RED: test_stopFeedbackAttempts_increments_only_on_feedback() — reflectAfterStop bumps ctx.stopFeedbackAttempts ONLY on an honored feedback; allow/deny/no-hook leave it at 0 (EC-1 — ceiling counts re-prompts, not stop-fires)
GREEN: implement reflectAfterStop + wire + LoopContext field + constant
REFACTOR: extract decision-find helper if needed; complexity <= 10
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/internal/agent-loop/stop-hook-reflection.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/internal/agent-loop/stop-hook-reflection.test.ts` reports 8/8 tests passed (6 core + EC-1/EC-2)
- [ ] `test_fires_stop_hook_on_clean_finish` passes (stop dispatched at clean finish)
- [ ] `test_reflection_is_bounded_by_ceiling` passes (no infinite reflection)
- [ ] `test_stop_not_fired_on_error_terminal` passes (D1: clean-finish only)
- [ ] `grep -c "event: \"stop\"" packages/sdk/src/internal/agent-loop/loop.ts` returns ≥ 1 (stop is actually dispatched)
- [ ] `pnpm --filter @theokit/sdk exec biome check packages/sdk/src/internal/agent-loop/loop.ts packages/sdk/src/internal/agent-loop/loop-context-init.ts` reports 0 errors (complexity ≤ 10)
- [ ] `wc -l packages/sdk/src/internal/agent-loop/loop.ts` returns ≤ 360 (budget 500)

#### DoD
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/internal/agent-loop/stop-hook-reflection.test.ts` green
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0
- [ ] `pnpm --filter @theokit/sdk exec biome check` clean on changed files

---

## Phase 2: Document the behavior + changelog

**Objective:** document that `stop` now fires + honors `feedback`, and record the change.

### T2.1 — docs.md hooks note + CHANGELOG + changeset

#### Objective
Add a concise note to the docs.md hooks section that the `stop` event fires on clean finish and a `feedback` decision drives a bounded re-prompt; add a changeset + root CHANGELOG `[Unreleased]` entry.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — documents the now-live `stop` hook behavior in the public hooks contract + records a changeset/CHANGELOG entry.

2. **Why it is necessary now** — CLAUDE.md mandates `docs.md` reflect any change to the documented surface in the same change; M1-4 changes the observable behavior of the documented file-based `stop` hook (it now fires). Unbreakable Rule 6 requires the changelog entry.

#### Evidence
docs.md hooks section at `docs.md:1179-1183`. CHANGELOG precedent: prior M1 entries in root `CHANGELOG.md [Unreleased]`. Changeset dir `.changeset/`.

#### Files to edit
```
docs.md — note in the hooks section: stop fires on clean finish; feedback → bounded re-prompt
packages/sdk/CHANGELOG.md (root) — [Unreleased] § Added entry
.changeset/m1-stop-hook-reflection.md — NEW: minor changeset
```

#### Deep file dependency analysis
- `docs.md` — additive note in the existing hooks section (`:1179`); no existing contract changed.
- root `CHANGELOG.md` — additive `[Unreleased] § Added` bullet (the manual workspace changelog; the package CHANGELOG is changeset-generated at release).
- `.changeset/` — new minor changeset consumed at the next `changeset version`.

#### Deep Dives
- **Doc note content:** the `stop` hook fires once when the agent finishes a turn cleanly; a hook returning `{"decision":"feedback","feedback":"…"}` re-prompts the agent with that text (bounded — at most a small number of rounds); `allow`/`deny` finish normally. Behavior change only — no new API symbol.
- **Invariant:** the doc must NOT claim a programmatic callback (hooks remain file-based per `docs.md:1179`).

#### Tasks
1. Add the hooks-section note in docs.md.
2. Add `.changeset/m1-stop-hook-reflection.md` (minor).
3. Add the root CHANGELOG `[Unreleased] § Added` bullet.

#### TDD
```
RED: N/A (documentation-only task — no test). VERIFY via grep oracles in Acceptance Criteria.
GREEN: write the docs note + changeset + CHANGELOG entry
REFACTOR: None expected
VERIFY: grep -c "stop" docs.md (hooks section) + ls .changeset/m1-stop-hook-reflection.md
```

#### Acceptance Criteria
- [ ] `grep -c "feedback" docs.md` returns ≥ 1 in the hooks section (stop+feedback documented)
- [ ] `ls .changeset/m1-stop-hook-reflection.md` exists
- [ ] `grep -c "stop" packages/sdk/CHANGELOG.md` returns ≥ 1 (root [Unreleased] entry mentions the stop hook)
- [ ] `pnpm --filter @theokit/sdk exec biome check docs.md` reports 0 errors (or docs.md excluded — no error)

#### DoD
- [ ] docs.md hooks note present
- [ ] changeset + CHANGELOG entry present
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0 (no code change in this task; sanity)

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `stop` declared but never fired (M1-4) | T1.1 | dispatch at clean-finish terminal (D1) |
| 2 | Honor `decision:"feedback"` as a re-prompt | T1.1 | push feedback as user message + continue (D2) |
| 3 | Bound the reflection (no infinite loop) | T1.1 | `stopFeedbackAttempts` + `MAX_STOP_FEEDBACK_ATTEMPTS` (D3) |
| 4 | allow/deny/none finish normally | T1.1 | finish branch; deny treated as allow |
| 5 | Reuse HooksExecutor, zero new deps | T1.1 | `inputs.hooks.run` (D4) |
| 6 | Document + record the behavior change | T2.1 | docs.md note + changeset + CHANGELOG |

**Coverage: 6/6 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk exec vitest run` green
- [ ] Zero type errors — `pnpm --filter @theokit/sdk typecheck`
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk exec biome check`
- [ ] Dead-code clean — `pnpm quality:dead` (knip)
- [ ] File-size budget respected (`loop.ts` ≤ 500)
- [ ] CHANGELOG.md updated under `[Unreleased]` + changeset added (Unbreakable Rule 6)
- [ ] Backward compatibility preserved (additive internal field + a previously-dead hook event going live; no public symbol removed)
- [ ] `docs.md` reflects the now-live `stop` hook (source-of-truth rule)
- [ ] Plan-specific: `stop` fires ONLY on clean finish (asserted by `test_stop_not_fired_on_error_terminal`); reflection bounded (asserted by `test_reflection_is_bounded_by_ceiling`); `HooksExecutor.run` reused (no new dispatcher)
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merge

## Dependencies

M1-4 introduces ZERO new dependencies — it reuses the SDK's existing `HooksExecutor` and the `MAX_NUDGE_ATTEMPTS` bounded-loop pattern (Rule 9 / KISS).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (internal) `HooksExecutor` | n/a (in-repo `hooks-executor.ts:69`) | npm/TS | hook dispatch — reused (Rule 9) |
| (internal) `shouldNudgeAndContinue` / `MAX_NUDGE_ATTEMPTS` | n/a (in-repo `loop.ts`) | npm/TS | bounded re-prompt precedent — mirrored |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | A programmatic hook lib / state machine was considered and rejected — the existing file-based `HooksExecutor` already dispatches + aggregates decisions; adding infra violates Rule 9/KISS. | n/a — no new dep |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Failure scenarios

(none — no external I/O introduced. The `stop` dispatch reuses the existing `HooksExecutor`, which already runs file-based hook subprocesses; M1-4 adds no new HTTP/DB/queue/socket. Hook-subprocess failure handling is the existing executor's concern, unchanged by this plan.)

## Final Phase: Integration Validation (MANDATORY)

**Objective:** validate the `stop` dispatch + bounded re-prompt works in the real loop, not just isolated units.

### Execution
```
pnpm --filter @theokit/sdk exec vitest run tests/internal/agent-loop/stop-hook-reflection.test.ts
pnpm --filter @theokit/sdk exec vitest run        # full suite — no regression
pnpm --filter @theokit/sdk typecheck
pnpm --filter @theokit/sdk exec biome check
pnpm quality:dead
```

### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/internal/agent-loop/stop-hook-reflection.test.ts` reports all tests passed
- [ ] `pnpm --filter @theokit/sdk exec vitest run` reports 0 failed (full suite — no regression)
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0
- [ ] `pnpm --filter @theokit/sdk exec biome check` exits 0
- [ ] `pnpm quality:dead` exits 0 (no orphan; `reflectAfterStop` is called by `continueOrTerminate`)
- [ ] Runtime-metric proof — N/A documented: `stop` dispatch is observable via the hook itself (the hook fires), consistent with how `preToolUse`/`postToolUse` have no separate counter

### If Validation Fails
1. Identify plan-caused vs pre-existing failures.
2. Fix all plan-caused failures.
3. Re-run the chain.
4. Log pre-existing issues in the PR description; they do not block.
