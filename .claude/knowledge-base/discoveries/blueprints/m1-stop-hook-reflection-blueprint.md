# Blueprint: M1-4 — Fire the `stop` hook + honor `feedback` as a bounded re-prompt

> **Version 1.0** — Synthesizes Google ADK-JS end-of-turn lifecycle callbacks (`afterAgentCallback`) and CrewAI's bounded guardrail-retry against the first-party agent loop, to lock the contract for firing the already-declared `HookEvent "stop"` at the loop's clean-finish boundary and honoring a `decision: "feedback"` as a BOUNDED corrective re-prompt (reflection ladder), reusing the existing `HooksExecutor` + the `shouldNudgeAndContinue`/`MAX_NUDGE_ATTEMPTS` precedent. Decisions informed: dispatch point, feedback→re-prompt mapping (NOT output replacement), reflection ceiling, granularity (in-loop, not task re-run).

**Slug:** `m1-stop-hook-reflection`
**Source plan:** `.claude/knowledge-base/discoveries/plans/m1-stop-hook-reflection-plan.md`
**Owner:** paulo
**Generated:** 2026-06-20 via `/discover-execute`
**Confidence verdict:** SHIPPABLE (99.2, discover-confidence 2026-06-20)

## Context

`HookEvent "stop"` is declared (`packages/sdk/src/internal/runtime/hooks/hooks-executor.ts:18`, `hooks-frontmatter.ts:16`) but never dispatched — only `preRun`/`preToolUse`/`postToolUse` fire. The `HooksExecutor` already returns `{ decisions, blocked }` with `decision: "allow"|"deny"|"feedback"` + `feedback?: string` (`hooks-executor.ts:29-45`), and `preToolUse` already consumes a decision (`tool-dispatch.ts:224-234`). The loop already ships a bounded corrective re-prompt: `shouldNudgeAndContinue` pushes a `user` message while `ctx.nudgeAttempts < MAX_NUDGE_ATTEMPTS` (=2) and finishes at `ctx.finalStatus = "finished"; return "done"` (`loop.ts:212-231,276`). M1-4 wires `stop` at that finish boundary + maps `feedback` onto the existing bounded re-prompt.

## Objective

Decide the dispatch point, feedback→re-prompt contract, and reflection ceiling for firing `stop` + honoring `feedback`, backed by the field's lifecycle callbacks and the first-party nudge precedent.

---

## Coverage Corner 1 — Integration Tests

### ADK-JS + CrewAI

How end-of-turn callbacks and bounded retries are tested:

- **ADK-JS after-callbacks** are exercised via the plugin manager tests: `.claude/knowledge-base/reference/adk-js/core/test/plugins/plugin_manager_test.ts`, `base_plugin_test.ts`, `logging_plugin_test.ts` assert the after-callback fires and that a returned value is surfaced.
- **CrewAI bounded guardrail-retry** is tested in `.claude/knowledge-base/reference/crewAI/lib/crewai/tests/test_task_guardrails.py`:
  - `test_task_with_failing_guardrail` — "failing guardrail triggers retry with error context", asserts `task.retry_count == 1` (`:71-95`).
  - `test_task_with_guardrail_retries` — multiple retries, asserts `task.retry_count == 2` (`:98-120`).
  - `test_guardrail_error_in_context` — "guardrail error is passed in context for retry" (`:125`).

These seed the SDK's TDD RED cases: `stop` fires on clean finish; a `feedback` decision pushes a `user` re-prompt and continues; the re-prompt is bounded (ceiling reached → finish anyway); `deny`/`allow` decisions behave correctly; error/iteration-ceiling terminals do NOT fire `stop`.

---

## Coverage Corner 2 — Dependencies

### ADK-JS

| Dependency | Version | Why | Citation |
|---|---|---|---|
| (none) | — | `afterAgentCallback` lifecycle is first-party — `base_agent.ts` imports are relative/internal only | `.claude/knowledge-base/reference/adk-js/core/src/agents/base_agent.ts:1-13` |

### CrewAI

| Dependency | Version | Why | Citation |
|---|---|---|---|
| `pydantic` (already a CrewAI dep) | — | `GuardrailResult` is a `BaseModel`; the bounded-retry logic itself is first-party (no NEW dep for the retry mechanism) | `.claude/knowledge-base/reference/crewAI/lib/crewai/src/crewai/utilities/guardrail.py:6,60` |

**Conclusion:** firing `stop` + honoring `feedback` needs ZERO new dependencies — it reuses the SDK's existing `HooksExecutor` and the `MAX_NUDGE_ATTEMPTS` bounded-loop pattern (Rule 9).

---

## Coverage Corner 3 — Tools

### ADK-JS dispatch wiring

- `afterAgentCallback` is invoked at the END of the run: `BaseAgent.runAsync` runs `runAsyncImpl(context)` to completion, then calls `handleAfterAgentCallback(context)` and yields any resulting event (`.claude/knowledge-base/reference/adk-js/core/src/agents/base_agent.ts:169-205`). `handleAfterAgentCallback` chains the registered callbacks in order until one returns non-undefined, short-circuiting on `abortSignal.aborted` (`:protected handleAfterAgentCallback`). The whole run is span-wrapped (`finally { span.end() }`).
- Plugins expose the same lifecycle via `base_plugin.ts` (`.claude/knowledge-base/reference/adk-js/core/src/plugins/base_plugin.ts`), invoked by the plugin manager.

**SDK dispatch-point decision (EC-3):** fire `stop` at the loop's CLEAN-FINISH terminal — `loop.ts:276` (`ctx.finalStatus = "finished"; return "done"`), the same boundary the nudge exhausts to. The `error` and iteration-ceiling (`stoppedAtIterationLimit`) terminals do NOT fire `stop` — they are not "the agent decided to stop". This mirrors ADK firing after a clean `runAsyncImpl` completion (not on abort).

---

## Coverage Corner 4 — Techniques

### Technique 1 — End-of-turn lifecycle + continuation influence

| Project | Approach | Citation |
|---|---|---|
| ADK-JS | `afterAgentCallback` fires after the impl completes; callbacks chain until one returns content; a returned value is APPENDED as an extra event to the stream | `.claude/knowledge-base/reference/adk-js/core/src/agents/base_agent.ts:169-205` |
| first-party nudge | when the model stops without tool_use and the response is incomplete, push a `user` "please continue/finish" message and continue, while `nudgeAttempts < MAX_NUDGE_ATTEMPTS` (=2) | `packages/sdk/src/internal/agent-loop/loop.ts:212-231` |

**Divergence (EC-1):** ADK's callback REPLACES/APPENDS output (a value-returning in-process callback). The SDK's `stop` is a subprocess hook returning a `decision`. M1-4 maps ADK's "callback can influence continuation" onto the SDK's existing model: a `decision: "feedback"` becomes a bounded `user` re-prompt (continue the loop) — it does NOT replace the model's output. The mechanism to reuse is the nudge, not output replacement.

### Technique 2 — Bounded corrective re-prompt (the ceiling)

| Project | Approach | Citation |
|---|---|---|
| CrewAI | `guardrail_max_retries: int = 3` (default); `max_attempts = guardrail_max_retries + 1`; per-guardrail `retry_count`; on failure the error is re-fed as context for the retry | `.claude/knowledge-base/reference/crewAI/lib/crewai/src/crewai/task.py:273,1258-1262` |
| first-party nudge | `MAX_NUDGE_ATTEMPTS = 2`; `ctx.nudgeAttempts` increments per re-prompt; terminal finish when the ceiling is hit | `packages/sdk/src/internal/agent-loop/loop.ts:26,214,220` |

**Convergent finding:** both bound corrective re-prompts with a small integer ceiling (CrewAI 3+1; nudge 2) and finish anyway at the ceiling. M1-4 adds a `stop`-feedback ceiling in the same shape (a counter on `LoopContext`, mirroring `nudgeAttempts`).

**Granularity (EC-2):** CrewAI re-runs the whole TASK; the SDK re-prompts IN-LOOP (push the hook's `feedback` as a `user` message + continue the same conversation, like the nudge). M1-4 adopts the in-loop granularity, NOT a run restart.

---

## Cross-cutting Comparison

| Dimension | ADK-JS | CrewAI | first-party (loop nudge / HooksExecutor) |
|---|---|---|---|
| End-of-turn fire point | after `runAsyncImpl` (clean) | after task output, before next task | `loop.ts:276` clean-finish terminal (proposed for `stop`) |
| Continuation influence | callback returns content (append/replace) | guardrail error re-fed as context | `decision:"feedback"` → push `user` re-prompt (proposed) |
| Ceiling | n/a (single after-callback) | `guardrail_max_retries+1` (=4) | `MAX_NUDGE_ATTEMPTS` (=2); new `stop`-feedback counter (proposed) |
| Granularity | in-run event | whole-task re-run | in-loop re-prompt (same conversation) |
| New dependency | none | none (pydantic already present) | none — reuse `HooksExecutor` |

## ADRs

### D1 — Dispatch `stop` at the clean-finish terminal only

**Decision:** fire `executeHooks({ event: "stop", payload })` at the loop's clean-finish boundary (`loop.ts:276`, where `finalStatus="finished"` and the loop would return `"done"`). Do NOT fire on the `error` terminal or the iteration-ceiling (`stoppedAtIterationLimit`).

**Rationale:** `stop` means "the agent decided it is done" — the clean finish. ADK fires its after-callback after a clean `runAsyncImpl` completion, not on abort (`base_agent.ts:169-205`). Error/ceiling terminals are involuntary stops; firing `stop` there would let a reflection hook re-prompt a broken/over-budget run.

**Alternatives considered:** fire on every terminal (rejected — re-prompting after an error/ceiling masks failure and risks runaway cost); fire only via a separate `postRun` (rejected — `postRun` is a non-decision lifecycle notification; `stop` is the decision point for reflection).

**Consequences:** a `stop` hook sees only clean finishes; `error`/ceiling remain terminal. `postRun` (also currently unfired) is out of scope for M1-4.

### D2 — Map `decision: "feedback"` onto a bounded `user` re-prompt, NOT output replacement (EC-1)

**Decision:** when a `stop` hook returns `decision: "feedback"` with a `feedback` string, push `{ role: "user", content: [{ type: "text", text: feedback }] }` and CONTINUE the loop (re-enter the turn), exactly like `shouldNudgeAndContinue`. `decision: "allow"` (or no `stop` hook) finishes normally; `decision: "deny"` finishes normally (a `stop` deny has no "block" semantics — the run already produced its answer; treat as allow + log).

**Rationale:** the SDK's `stop` is a subprocess hook returning a decision (consumed for `preToolUse` at `tool-dispatch.ts:224-234`), not ADK's value-returning callback. Reusing the existing `feedback` decision + the nudge re-prompt is Rule 9/DRY and matches CrewAI's "re-feed the error as context for retry" (`task.py:1258-1262`). The model keeps producing its own output; the hook only nudges it to keep going.

**Alternatives considered:** replace the model output with the hook's text (rejected — ADK-style output replacement is foreign to the hook model + dangerous: a hook would author the agent's answer); add a new decision type (rejected — `feedback` already exists, YAGNI).

**Consequences:** consumers author a `stop` hook that emits `{"decision":"feedback","feedback":"..."}` to drive a reflection ladder; the loop re-prompts with that text.

### D3 — Bound the reflection re-prompt with a ceiling mirroring `MAX_NUDGE_ATTEMPTS`

**Decision:** add a `stopFeedbackAttempts` counter to `LoopContext` (mirroring `nudgeAttempts`) with a small ceiling (propose a `MAX_STOP_FEEDBACK_ATTEMPTS` constant). While under the ceiling, a `feedback` decision re-prompts + continues; at the ceiling, finish anyway (ignore further feedback) to prevent an infinite reflection loop.

**Rationale:** every reference bounds corrective re-prompts (CrewAI `guardrail_max_retries+1`; nudge `MAX_NUDGE_ATTEMPTS=2`). Without a ceiling a misbehaving `stop` hook loops forever. Same shape as the proven nudge ceiling (Rule 9).

**Alternatives considered:** unbounded (rejected — infinite loop / runaway cost); reuse `nudgeAttempts` itself (rejected — nudge and stop-feedback are distinct concerns; separate counters keep each ceiling clear, SRP).

**Consequences:** a deterministic upper bound on reflection rounds; the ceiling value is a tuning knob (a future `SendOptions` knob could expose it — out of scope for M1-4).

### D4 — Reuse `HooksExecutor`; zero new dependencies

**Decision:** dispatch `stop` through the existing `HooksExecutor.executeHooks` (the same path `preRun`/`preToolUse`/`postToolUse` use); no new module, no new dep.

**Rationale:** the executor already loads commands per event, runs them as subprocesses, and aggregates `{decisions, blocked}` (`hooks-executor.ts`). Q4 confirmed the field's lifecycle/guardrail mechanisms are first-party. `architecture.md` §2 — wire through the existing port.

**Alternatives considered:** a new stop-specific dispatcher (rejected — duplicates the executor); a programmatic JS callback API (rejected — the SDK's hooks are file-based subprocess hooks; adding a parallel JS-callback channel is scope creep — plugins already cover programmatic hooks).

**Consequences:** `stop` joins the existing 3 fired events; the file-based hook author gets the 4th.

## Recommendations for the project

| # | Recommendation | Linked to | Priority |
|---|---|---|---|
| 1 | Dispatch `stop` via `HooksExecutor.executeHooks({event:"stop"})` at the clean-finish terminal (`loop.ts:276`), not on error/ceiling | Q1,Q5 · D1,D4 · architecture.md §2 | HIGH |
| 2 | On `decision:"feedback"`, push the `feedback` string as a `user` message + continue (mirror `shouldNudgeAndContinue`); allow/deny finish | Q1,Q2 · D2 · Rule 9 | HIGH |
| 3 | Bound with a new `LoopContext.stopFeedbackAttempts` + `MAX_STOP_FEEDBACK_ATTEMPTS` ceiling; finish at ceiling | Q2 · D3 | HIGH |
| 4 | Zero new deps — reuse `HooksExecutor` + the nudge pattern | Q4 · D4 | HIGH |
| 5 | TDD RED cases from CrewAI/ADK tests: `stop` fires on finish; feedback re-prompts once; ceiling reached → finish; error terminal does NOT fire `stop`; allow finishes | Q3 · testing.md §3 | HIGH |
| 6 | The typed tool-result accessor mentioned in the roadmap is a SEPARATE concern (M1-5 readers) — keep M1-4 scoped to `stop` + feedback re-prompt | — · YAGNI | MEDIUM |

## Blocked questions (if any)

| Question | Reason | Suggested human follow-up |
|---|---|---|
| (none) | all 5 answered with verified citations | — |

## Halt-loop progress (audit trail)

- Iterations used: 1 (inline per-iteration contract; bounded read-and-synthesize)
- Questions answered: 5 / 5
- Questions blocked: 0
- Citations verified: all `.claude/knowledge-base/reference/` paths confirmed on disk (Step 7 sanity check)
- Promise emitted: `<promise>BLUEPRINT_COMPLETE</promise>`

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/m1-stop-hook-reflection-plan.md`
- Edge-case review: `.claude/knowledge-base/reviews/m1-stop-hook-reflection-edge-cases-2026-06-20.md`
- First-party anchors: `packages/sdk/src/internal/runtime/hooks/hooks-executor.ts`, `packages/sdk/src/internal/agent-loop/loop.ts`, `packages/sdk/src/internal/agent-loop/tool-dispatch.ts`
- Project rules: `.claude/rules/architecture.md`, `.claude/rules/testing.md`, `.claude/rules/no-stubs-no-mocks-no-wired.md`
