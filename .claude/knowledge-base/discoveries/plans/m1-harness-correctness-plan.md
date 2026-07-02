# Discovery Plan: M1 Harness Correctness Core — Fix Approaches

> **Version 1.1** (2026-07-02 — absorbed EC-1 MUST-FIX: Q1/Q2/Q3 also read OUR loci to pin fix
> sites, per `reviews/m1-harness-correctness-edge-cases-2026-07-02.md`). **Version 1.0** — Investigate the CORRECT FIX APPROACH for the 4 M1 correctness defects (silent
> no-ops): **#58** cancellation does not interrupt in-flight tools + no per-tool timeout + JobQueue
> cancel/concurrency gaps; **#55** `PermissionEngine` gates on tool NAME only and defaults fail-OPEN
> (no argument/command gating, no dangerous-op gate); **#65** 7 of 10 declared plugin hooks are
> never invoked (silent no-op) + no `ToolContext` capability surface; **#57** no content-level
> prompt-injection/PII defense on tool results. Grounded in already-cloned peers (codex, opencode,
> adk-js, mastra, crewAI). Deliverable: `m1-harness-correctness-blueprint.md`.

**Slug:** `m1-harness-correctness`
**Owner:** paulohenriquevn
**Created:** 2026-07-02
**Time budget:** 7h (per-project breakdown in ADR D1)

## Context

M1 of `theokit-sdk/ROADMAP.md` (owned milestone, #55/#57/#58/#65) is the Harness **correctness
core**: eliminate surfaces that exist but silently do nothing. Grounding reads (2026-07-02, post-M0)
confirmed all four in current source:

- **#58** `packages/sdk/src/internal/agent-loop/tool-dispatch.ts` (`runToolWithLifecycle`) threads NO
  `AbortSignal` into tool handlers and applies NO per-tool timeout; `loop.ts` performs no
  between-iteration abort check. `packages/sdk/src/job-queue.ts` (public) — cancel/concurrency
  semantics to verify against opencode's findings (cancel doesn't interrupt running work; no bound).
- **#55** `packages/sdk/src/permission-engine.ts:38` `evaluate(toolName)` matches tool NAME only;
  `:31` `defaultAction` defaults to `"allow"` (fail-open). No argument/command gating (a `shell`
  rule cannot distinguish `ls` from `rm -rf /`).
- **#65** `packages/sdk/src/internal/plugins/types.ts:20` `HookName` declares 10 hooks; only 3 are
  wired in `manager.ts` (`pre_tool_call`, `pre_user_send`, `post_assistant_reply`). The 7 others
  (`post_tool_call`, `pre_llm_call`, `post_llm_call`, `on_session_start`, `on_session_end`,
  `transform_tool_result`, `transform_llm_output`) are silent no-ops — a `no-stubs-no-mocks-no-wired`
  §3 violation. No `ToolContext` 2nd-arg (tools cannot request confirmation/credentials).
- **#57** no content-level defense against prompt injection / PII in tool results before they reach
  the LLM. `transform_tool_result` (a dead hook from #65) is the natural seam for this scrub.

Rules that bound the fixes: `rules/parsimony-ladder.md` (stdlib `AbortController`/`AbortSignal.timeout`
before a queue dep), `rules/error-handling.md` (typed errors, fail-closed — #55 default), `rules/testing.md`
§4.1 (negative-case tests assert the specific typed error / the denied call / the aborted handler),
`rules/no-stubs-no-mocks-no-wired.md` (#65 — every declared hook MUST have an invocation site or be
removed), `rules/architecture.md` (DIP — permission/hooks are boundary contracts).

## Objective

Produce a blueprint that lets `/to-plan M1` decide the exact fix shape for #55/#57/#58/#65 with peer
precedent, so implementation is TDD-first and reinvention-free.

- [ ] All research questions answered with citations to `.claude/knowledge-base/reference/`
- [ ] Cross-cutting comparison populated for every in-scope peer
- [ ] ≥ 1 concrete fix-decision proposal per defect (#55/#57/#58/#65)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/reference/opencode/` | `packages/opencode/src/{util/queue.ts,session/tools.ts,permission/}` | JobQueue cancel/concurrency (#58); permission arg gating (#55) |
| `.claude/knowledge-base/reference/codex/` | `codex-rs/execpolicy/src/` | argument/command permission policy engine (#55) |
| `.claude/knowledge-base/reference/adk-js/` | `core/src/plugins/`, `core/src/agents/context.ts`, `core/test/plugins/` | before/after callbacks + ToolContext (requestConfirmation/requestCredential) (#65) |
| `.claude/knowledge-base/reference/mastra/` | agent/tool exec (targeted) | abort-to-tool + per-tool timeout (#58) |
| `.claude/knowledge-base/reference/crewAI/` | `lib/crewai/src/crewai/task.py` | guardrail/output-validation pattern (#57 corroboration) |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/reference/*/{docs,examples,dist,build,node_modules,target,.venv}/` | Not the mechanism |
| Live/bidi, artifacts, RAG backends, workflow engines of any peer | Out of M1 scope (correctness core only) |
| Any project not under `.claude/knowledge-base/reference/` | Cross-Project Rule: never claim a feature without reading source |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** opencode 2h (#58 queue + #55 permission), codex 1.5h (#55 execpolicy), adk-js 2h (#65
callbacks + ToolContext), mastra 1h (#58 abort/timeout), crewAI 0.5h (#57 guardrail corroboration).

**Rationale:** #58 and #65 are the heaviest (8 + 2+ gaps); opencode + codex carry the permission
arg-gating precedent; adk carries the ToolContext + callback surface. crewAI corroborates #57 (a
thin area across peers — the injection-defense technique is partly external best-practice).

**Stop condition — per question:** Fase A empty after 3 query-variant retries → mark BLOCKED, continue.
**Stop condition — per project:** budget exhausted → mark remaining BLOCKED, continue; if all remaining
are done/blocked, emit `<promise>BLUEPRINT_BLOCKED</promise>`, never `BLUEPRINT_COMPLETE` from a
blocked state. **Anti-pattern:** never fabricate a Fase B answer (Unbreakable Rule 3).

### D2 — Investigation depth

**Decision:** Read the mechanism file end-to-end at each hotspot; grep-then-read for tests. Capture
the *fix pattern* (signature + guard + test), not the whole subsystem.

**Consequences:** blueprint is fix-focused; broader peer architecture is out of scope by design.

### D3 — Parsimony precedence (Tools corner deferral)

**Decision:** DEFER the **Tools** corner — the fixes introduce no new build/test/CI tooling (existing
Vitest/tsup/tsc/Biome). The **Dependencies** question (Q5) doubles as the parsimony check: confirm
stdlib (`AbortController`, `AbortSignal.timeout`, `Promise.race`) before any queue/timeout dep.

## Research Questions

<!-- DEFER-CORNER: tools | fixes introduce no new build/test/CI tooling; they run on the existing locked toolchain (Vitest/tsup/tsc/Biome). The Dependencies question Q5 doubles as the parsimony-ladder tooling check. See ADR D3. -->

| # | Question | Corner | Reference project(s) | Fase A (broad — grep/ast map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How do peers (a) propagate an AbortSignal into in-flight tool execution so cancel actually interrupts, (b) apply a per-tool timeout, and (c) bound + cancel a job queue? AND where in OUR code do these land? (#58, EC-1) | techniques | peers + OUR `packages/sdk/src/internal/agent-loop/tool-dispatch.ts` (`runToolWithLifecycle`), `loop.ts`, `packages/sdk/src/job-queue.ts` | `grep -n "AbortSignal\|signal\|abort\|timeout\|concurren\|queue" opencode/.../queue.ts opencode/.../session/tools.ts`; then `grep -n "signal\|timeout\|cancel\|concurrency" OUR tool-dispatch.ts loop.ts job-queue.ts` | Read the peer queue/tool-exec, THEN our `runToolWithLifecycle` + `job-queue.ts` to pin the exact fix sites + current signatures | Prose + table: signal path → handler; timeout mechanism; queue bound+cancel — peer pattern AND our fix site, with `reference/...:line` + `packages/sdk/...:line` |
| Q2 | How does codex's execpolicy gate on the command/arguments (not just tool name), and its default posture (fail-open/closed)? AND where does our `PermissionEngine.evaluate` change? (#55, EC-1) | techniques | codex `codex-rs/execpolicy/src/` + OUR `packages/sdk/src/permission-engine.ts` | `grep -n "pub fn\|Rule\|match\|default\|allow\|deny\|forbidden\|arg" rule.rs execpolicycheck.rs`; read OUR `permission-engine.ts:38` `evaluate` | Read `rule.rs`+`execpolicycheck.rs` (program+args matcher + default), THEN our `evaluate(toolName)` to pin the signature change (args gating + default posture) | Model: rule shape + default posture (peer) + our `evaluate` change site + citations |
| Q3 | How does adk-js (a) wire before/after tool+model+session callbacks (no dead no-op), (b) expose a ToolContext 2nd-arg (requestConfirmation/requestCredential), (c) transform a tool result — the seam our #57 scrub uses? AND which of OUR 7 dead hooks map to which invocation site? (#65 + #57, EC-1) | techniques | adk `core/src/plugins/base_plugin.ts`, `.../agents/context.ts`, crewAI `task.py` + OUR `packages/sdk/src/internal/plugins/{types.ts,manager.ts}` | `grep -n "beforeTool\|afterTool\|beforeModel\|afterModel\|onSession\|transform\|requestConfirmation\|requestCredential\|guardrail" base_plugin.ts context.ts task.py`; read OUR `manager.ts` hook-runners + `types.ts HookName` | Read adk callbacks + `context.ts:123/184`; crewAI `task.py` guardrail-retry; THEN our `manager.ts`/`types.ts` to pin each of the 7 dead hooks' intended invocation site | Table: callback→contract; ToolContext shape; per-dead-hook fix site (wire-or-remove) + `transform_tool_result` seam for #57 + citations |
| Q4 | How do peers TEST cancellation-interrupts-tool, argument-level permission deny, and hook-invocation (proving no dead hook)? (#58/#55/#65) | tests | `.claude/knowledge-base/reference/codex/codex-rs/execpolicy/tests/`, `.claude/knowledge-base/reference/adk-js/core/test/plugins/`, `.claude/knowledge-base/reference/opencode/` | `grep -ln "abort\|cancel\|deny\|forbidden\|beforeTool\|not.*called\|toHaveBeenCalled" codex/.../execpolicy/tests/basic.rs adk-js/core/test/plugins/*.ts` | Read the assert shapes: aborted handler stops; denied command not executed; each callback fires | Table: boundary → test name → assertion + citation |
| Q5 | Do peers use Node/stdlib primitives (AbortController, AbortSignal.timeout, Promise.race) for abort/timeout/queue, or a dependency (p-queue/p-timeout)? Confirms parsimony for #58. (#58) | deps | `.claude/knowledge-base/reference/opencode/`, `.claude/knowledge-base/reference/mastra/` | `grep -rn "AbortController\|AbortSignal.timeout\|p-queue\|p-timeout\|new Promise" opencode/packages/opencode/src/util mastra` | Read each site; note stdlib vs dep + the rejection/error shape | List: peer → mechanism (stdlib?) → error shape + citation |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4 | Covered |
| Dependencies | Q5 | Covered |
| Tools | (none) | ADR-deferred (D3 + DEFER-CORNER marker) |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners accounted (3 covered + 1 ADR-deferred = 100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | cited `reference/{project}/{path}` exists | Mark Qx BLOCKED "path not found", continue |
| Per-question Fase A budget | ≥ 1 hotspot OR 3 query-variant retries | After 3 retries, mark Qx BLOCKED "Fase A exhausted" |
| After answering Qx | blueprint section has ≥ 1 citation | Re-iterate Qx (1 retry max) |
| Q5 stdlib-first | Q5 confirms `AbortController`/`AbortSignal.timeout` (Node ≥22.12) before proposing a dep | Re-iterate Q5 to record the stdlib decision |
| #57 seam check | Q3 answer ties the tool-result scrub to the `transform_tool_result` hook seam (not a bolt-on) | Re-iterate Q3 |
| Per-project time budget | budget not exhausted | Mark remaining Qx BLOCKED "budget exhausted", advance |
| Before promising complete | all covered corners populated + ≥ 1 ADR | Refuse promise, continue |

## Acceptance Criteria

- [ ] All 5 questions answered OR explicitly BLOCKED with reason
- [ ] Integration-tests, Dependencies, Techniques corners populated (Tools ADR-deferred)
- [ ] Every citation resolves to a real `.claude/knowledge-base/reference/{...}` path
- [ ] ≥ 1 ADR in the blueprint synthesizing the fix decision per defect (#55/#57/#58/#65)
- [ ] Time budget respected per project
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint at `.claude/knowledge-base/discoveries/blueprints/m1-harness-correctness-blueprint.md`

## Global Definition of Done

- [ ] plan → edge-cases → plan-confidence → execute → confidence complete
- [ ] Final `/discover-confidence` verdict in blueprint header
- [ ] No fabricated citations
- [ ] Coverage Matrix 100% accounted
- [ ] ADRs reference ≥ 1 project rule (parsimony-ladder / error-handling / testing / no-stubs-no-mocks-no-wired)
