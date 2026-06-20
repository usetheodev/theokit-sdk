# Discovery Plan: M1-4 — Fire the `stop` hook + honor `feedback` as a bounded re-prompt (reflection ladder)

> **Version 1.1** (absorbed edge-case review `reviews/m1-stop-hook-reflection-edge-cases-2026-06-20.md`: EC-1 reframed Q1 to map ADK callbacks onto the SDK decision/feedback model — not output replacement; EC-2/EC-3 added as halt-loop checkpoints) — Investigate how to (a) fire the already-declared `HookEvent "stop"` at the agent-loop's terminal boundary and (b) honor a hook `decision: "feedback"` as a BOUNDED corrective re-prompt (a reflection ladder), reusing the SDK's existing `HooksExecutor` (which already handles `feedback`/`deny` for `preToolUse`) and the existing bounded-nudge precedent (`shouldNudgeAndContinue` + `MAX_NUDGE_ATTEMPTS`). The blueprint compares Google ADK-JS lifecycle callbacks (`afterAgentCallback`/`afterModelCallback`) and CrewAI's guardrail bounded-retry against the first-party loop, to lock the dispatch point, the feedback→re-prompt contract, and the iteration ceiling before any code.

**Slug:** `m1-stop-hook-reflection`
**Owner:** paulo
**Created:** 2026-06-20
**Time budget:** 3h (per-project breakdown in ADR D1)

## Context

Roadmap gap M1-4 (`gap-audit/THEOKIT_GAP_AUDIT.md`): the file-based hook system declares five `HookEvent`s — `preRun | postRun | preToolUse | postToolUse | stop` (`packages/sdk/src/internal/runtime/hooks/hooks-executor.ts:18`, `hooks-source.ts:25`, `HOOK_EVENTS` at `hooks-frontmatter.ts:16`) — but only three are ever dispatched: `preRun` (`local-agent.ts:360`), `preToolUse` (`tool-dispatch.ts:224`), `postToolUse` (`tool-dispatch.ts:313`). **`stop` is declared but never fired.** A user who registers a `stop` hook to inspect the agent's final answer and ask it to keep going (a reflection ladder) gets nothing.

The `HooksExecutor` already returns `{ decisions, blocked }` with `decision: "allow" | "deny" | "feedback"` and a `feedback?: string` (`hooks-executor.ts:29-45`); `preToolUse` already consumes a denial/feedback decision (`tool-dispatch.ts:224-234`). And the loop already ships a BOUNDED corrective re-prompt precedent: `shouldNudgeAndContinue` pushes a `user` message and continues while `ctx.nudgeAttempts < MAX_NUDGE_ATTEMPTS` (=2) (`loop.ts:212-231`), terminating at `ctx.finalStatus = "finished"; return "done"` (`loop.ts:276`).

This discovery exists to lock three open decisions before `/to-plan`, by comparing the field's end-of-turn lifecycle patterns against the first-party loop: (a) the exact dispatch point for `stop` (the terminal "done"/finished boundary); (b) the `feedback`→re-prompt contract (convert a hook's `feedback` string into a bounded `user` re-prompt, mirroring the nudge); (c) the iteration ceiling that prevents an infinite reflection loop.

Project rules honored: `architecture.md` §2 (the dispatch wires through the existing `HooksExecutor` port — no new infra), `testing.md` §3 (deterministic injected-hook unit tests), `no-stubs-no-mocks-no-wired.md` (the `stop` event must have a real dispatch caller, not just a declared union member), Unbreakable Rule 9 (reuse `HooksExecutor` + the `MAX_NUDGE_ATTEMPTS` bounded-loop pattern, don't reinvent).

## Objective

Produce a blueprint that lets us decide the exact contract for firing `stop` + honoring `feedback` as a bounded re-prompt — dispatch point, payload shape, feedback→re-prompt conversion, and the reflection ceiling — backed by the field's lifecycle callbacks and the first-party nudge precedent.

- [ ] All research questions answered with citations to `.claude/knowledge-base/reference/`
- [ ] Cross-cutting comparison table populated (ADK-JS lifecycle callbacks vs CrewAI guardrail-retry vs first-party nudge)
- [ ] Recommendations section provides one concrete decision per open question (dispatch point, feedback→re-prompt contract, ceiling)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/reference/adk-js/` | `core/src/agents/base_agent.ts`, `core/src/agents/llm_agent.ts`, `core/src/plugins/base_plugin.ts`, `core/test/**` | Direct analog: `afterAgentCallback`/`afterModelCallback` end-of-turn lifecycle — when fired, what a return value does (short-circuit vs continue) |
| `.claude/knowledge-base/reference/crewAI/` | `lib/crewai/src/crewai/utilities/guardrail.py`, `lib/crewai/src/crewai/task.py` | Bounded corrective re-prompt: a guardrail failure re-prompts the agent up to a retry ceiling |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/reference/codex/`, `opencode/` | Their end-of-turn handling is TUI/session-driven, not a pluggable end-of-turn callback + bounded re-prompt — adk-js + crewAI are the clean analogs |
| `.claude/knowledge-base/reference/adk-js/**/dist/`, `node_modules/` | Build artifacts |
| ADK-JS `beforeAgentCallback` / `beforeModelCallback` | M1-4 is the END-of-turn (`stop`) path; pre-callbacks already map to `preRun`/`preToolUse` (already fired) |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** ADK-JS: 1.5h (lifecycle-callback analog), CrewAI: 1.5h (bounded-retry analog).

**Rationale:** ADK-JS shows the end-of-turn callback shape + return-value semantics; CrewAI shows the bounded corrective re-prompt (guardrail retry ceiling). Both are load-bearing for the two halves of M1-4 (fire `stop` + bounded `feedback` re-prompt). Codex/opencode excluded (see out-of-scope).

**Alternatives considered:** ADK-JS only (rejected — it has callbacks but CrewAI's guardrail-retry is the cleaner bounded-re-prompt precedent); equal split across 4 refs (rejected — codex/opencode dilute).

**Stop condition — per question (mandatory):** When a question's Fase A returns empty matches after 3 consecutive retries with different query variants, mark the question BLOCKED with reason "Fase A exhausted — no hotspots found" and continue. Do NOT pad with unrelated hotspots.

**Stop condition — per project (mandatory):** When a project's budget is exhausted with N questions pending, mark them BLOCKED with reason "budget exhausted" and continue. If every remaining question across all projects is `done` or honestly `blocked`, emit `<promise>BLUEPRINT_BLOCKED</promise>` — never `BLUEPRINT_COMPLETE` from a blocked state.

**Anti-pattern:** NEVER fabricate Fase B answers to close a Fase-A-exhausted question (Unbreakable Rule 3).

**Consequences:** the halt-loop stops per-project on budget exhaustion; blocked questions surface as next-discovery seed.

### D2 — Investigation depth

**Decision:** Read each ADK-JS callback file end-to-end + its test; Grep-then-Read for CrewAI `guardrail.py` + the retry site in `task.py`.

**Rationale:** the callback firing point + the bounded-retry ceiling are the load-bearing evidence; deep reads on those, targeted reads elsewhere.

**Consequences:** budget concentrated on the dispatch-point + retry-ceiling files.

### D3 — First-party current-state is context, not a discover target

**Decision:** Treat the SDK's `HooksExecutor` (`hooks-executor.ts`), the `preToolUse` feedback consumption (`tool-dispatch.ts:224-234`), and the bounded-nudge precedent (`loop.ts:212-231,276`) as already-known current state cited inline — NOT as `reference/` questions.

**Rationale:** per `cycle-discover.md` ("Do NOT trigger DISCOVER for questions answered by reading your own code"), first-party code needs no discovery. The discovery's value is the EXTERNAL comparison informing the dispatch-point + ceiling ADRs.

**Consequences:** research questions target only `reference/` projects; the blueprint's Recommendations synthesize external findings against the first-party nudge precedent.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | WHEN does ADK-JS fire `afterAgentCallback`/`afterModelCallback` (end-of-turn timing), and HOW does its return value influence continuation? Extract only the TIMING + the continuation-influence IDEA, then map onto the SDK's `decision: "feedback"` → bounded re-prompt model (NOT ADK's output-replacement) — EC-1 | techniques | `.claude/knowledge-base/reference/adk-js/core/src/agents/base_agent.ts`, `core/src/agents/llm_agent.ts` | Grep `afterAgentCallback`/`afterModelCallback`/`runAsync`/`yield` to find the fire site | Read the fire site + return-value handling; capture the callback-vs-decision divergence | Fire point + sync/async + an explicit ADR mapping ADK's value-return onto the SDK decision/feedback model (the SDK re-prompts, does NOT replace output) |
| Q2 | HOW does CrewAI bound a corrective re-prompt — when a guardrail fails, how is the agent re-prompted and what caps the retries? | techniques | `.claude/knowledge-base/reference/crewAI/lib/crewai/src/crewai/utilities/guardrail.py`, `lib/crewai/src/crewai/task.py` | Grep `guardrail`/`max_retries`/`retry_count`/`_invoke`/`retry` to find the bounded retry loop | Read the retry loop + the re-prompt construction | Bounded-retry algorithm: ceiling source, what is re-fed to the agent, terminal behavior at ceiling + cites |
| Q3 | HOW are these tested — the after-callback fire AND the guardrail bounded retry (ceiling reached, retry succeeds)? | tests | `.claude/knowledge-base/reference/adk-js/core/test/**`, `.claude/knowledge-base/reference/crewAI/**` (guardrail tests) | Grep `afterAgentCallback`/`guardrail` in test dirs; enumerate `it(`/`def test_` | Read each test case body | Table: test name → scenario (fired / re-prompted / ceiling hit) → assertion — seeds SDK TDD cases |
| Q4 | Do ADK-JS / CrewAI add a DEPENDENCY for the end-of-turn callback / guardrail-retry, or is it first-party? | deps | `.claude/knowledge-base/reference/adk-js/core/src/agents/`, `.claude/knowledge-base/reference/crewAI/lib/crewai/src/crewai/utilities/guardrail.py` | Grep `import` in the callback/guardrail files | Read the imports | Per-project: first-party vs lib (name) — confirms M1-4 needs no new dep (reuse HooksExecutor) |
| Q5 | WHERE in the run pipeline is the end-of-turn callback invoked (the dispatch wiring), and is it a pluggable strategy? | tools | `.claude/knowledge-base/reference/adk-js/core/src/plugins/base_plugin.ts`, `core/src/agents/base_agent.ts` | Grep `PluginManager`/`runAsync`/`callback(` to find the invocation site | Read the interface + invocation point | Dispatch-point description + plugin/callback contract — informs the SDK's loop-end `stop` dispatch site |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q3 | Covered |
| Dependencies | Q4 | Covered |
| Tools | Q5 | Covered |
| Techniques | Q1, Q2 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | every `.claude/knowledge-base/reference/{project}/{path}` declared in Fase A exists | Mark Qx BLOCKED "path not found", continue |
| Per-question Fase A budget | Fase A returned ≥1 hotspot OR 3 query-variant retries attempted | After 3 retries empty, mark Qx BLOCKED "Fase A exhausted"; continue |
| After answering Qx | Blueprint section under Qx has ≥1 citation | Re-iterate Qx (1 retry max) |
| Q1/Q5 dispatch point (key) | Fase B captured the EXACT fire point + whether a return value alters the result | Required for the SDK dispatch-point ADR; do not close Q1/Q5 without it |
| Q2 ceiling (key) | Fase B captured the retry CEILING source + terminal-at-ceiling behavior | Required for the reflection-ceiling ADR; do not close Q2 without it |
| Q2 granularity (EC-2) | Fase B captured the retry GRANULARITY (whole-task re-run vs same-conversation re-prompt) | Blueprint MUST map CrewAI's re-feed onto the SDK in-loop "push feedback as user message + continue" (the `shouldNudgeAndContinue` precedent), NOT "restart the run" |
| Q1/Q5 terminal selection (EC-3) | Fase B captured whether ADK fires the after-callback on the ERROR terminal too or only the clean finish | Required to recommend which SDK terminal(s) dispatch `stop` (proposal: clean `finished` only; error/iteration-ceiling are not "the agent decided to stop") |
| Per-project time budget | budget not exhausted | When exhausted, mark remaining Qx BLOCKED "budget exhausted"; advance |
| Before promising complete | all 4 coverage corners have populated sections | Refuse promise, continue iterating |

## Acceptance Criteria

- [ ] All research questions answered OR explicitly marked BLOCKED with reason
- [ ] All four coverage corners have populated sections in the blueprint
- [ ] Every citation in the blueprint points to a real `.claude/knowledge-base/reference/{...}` path
- [ ] At least one ADR section in the blueprint synthesizes the dispatch-point, feedback→re-prompt, and ceiling decisions
- [ ] Time budget respected per project
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/m1-stop-hook-reflection-blueprint.md`

## Global Definition of Done

- [ ] All phases completed (plan → edge-cases → plan-confidence → execute → confidence → improve if needed)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations
- [ ] Coverage Matrix 100% covered
- [ ] ADRs reference at least one project rule principle (Rule 9 reuse `HooksExecutor` + `MAX_NUDGE_ATTEMPTS` ceiling; `architecture.md` §2 dispatch via existing port; `testing.md` §3 deterministic units)
