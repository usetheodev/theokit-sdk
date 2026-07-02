# Discovery Plan: Doom-loop / no-progress guard for the `@theokit/sdk` agent loop

> **Version 1.1** — (v1.1 absorbed 3 MUST-FIX from `reviews/doom-loop-guard-edge-cases-2026-07-01.md`: EC-1/EC-2 scope large-file reads to the grep'd regions, EC-3 opencode-permission-model conflation note on Q1.) Investigate how SOTA multi-model agents detect and stop a **doom loop** — the model repeating IDENTICAL tool calls (same name + same input) that make no progress — so the SDK's inner agent loop (`internal/agent-loop/loop.ts`) gains a typed early-stop instead of grinding to the iteration ceiling (the qwen3-coder `\n`-path hang: `read_file` returning `not_found`, retried identically). In scope: **opencode** (inline `DOOM_LOOP_THRESHOLD` fingerprint in the session processor) and **cline** (isolated pure `LoopDetectionTracker` + `MistakeTracker` with soft/hard thresholds and a typed stop outcome). Blueprint output: a design (fingerprint + threshold + typed action + where it plugs into OUR existing pluggable iteration-tracker abstraction), grounded with file:line citations, ready for `/to-plan`.

**Slug:** `doom-loop-guard`
**Owner:** paulo
**Created:** 2026-07-01
**Time budget:** 5h (per-project breakdown in ADR D1)

## Context

The SDK's inner agent loop (`packages/sdk/src/internal/agent-loop/loop.ts:50` `while (budget.shouldContinue())`) already has a **pluggable iteration-tracker** abstraction that can deny an iteration with a `decision.reason` (e.g. `"iteration_limit"` → `ctx.stoppedAtIterationLimit`), and the outer continuation driver (`internal/runtime/lifecycle/run-to-completion.ts:62`) already ships a `no_progress` terminal — but that `no_progress` fires ONLY on **empty rounds** (`isEmptyRound(result) && emptyStreak >= 1`, i.e. the model produced no output text). The P0 `\n`-path hang produced NON-empty rounds (it kept calling `read_file`), so the existing guard never fired and the loop ground to the iteration ceiling / re-prompted across rounds. **The gap is real and specific: no detection of identical-repeat tool calls.** This discovery studies the two references that solve exactly this (opencode inline doom-loop; cline isolated LoopDetection + Mistake trackers) so `/to-plan` can design a guard that plugs into OUR existing tracker abstraction (Rule 9 — do not reinvent; complement the empty-round `no_progress`, do not replace it). Project rules constraining the design: `rules/architecture.md` (the guard is a pure, injectable domain tracker — DIP, matching the existing budget-tracker seam), `rules/testing.md` (a pure state machine, unit-testable in isolation), `rules/error-handling.md` (a typed stop/terminal with a clear reason, never a silent hang).

## Objective

Decide the **fingerprint, threshold, typed action, and insertion seam** of a doom-loop guard for the SDK's inner agent loop, grounded in how opencode and cline detect-and-stop identical-repeat tool calls.

- [ ] All research questions answered with citations to `.claude/knowledge-base/references/`
- [ ] Cross-cutting comparison table populated for every in-scope reference project
- [ ] Recommendations section provides ≥ 1 concrete decision proposal per research question
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/cline/` | `sdk/packages/core/src/runtime/safety/loop-detection.ts`, `.../safety/mistake-tracker.ts` (+ the wiring test `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.test.ts`) | An **isolated pure tracker** (soft/hard thresholds, typed stop outcome) — the closest analog to OUR pluggable iteration-tracker seam; the primary reference. |
| `.claude/knowledge-base/references/opencode/` | `packages/opencode/src/session/processor.ts` (the doom-loop region) | An **inline** fingerprint check over the last N tool-call parts with a permission/nudge action — the threshold + fingerprint reference. |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| cline full `SessionRuntime` orchestration (`orchestration/*.ts` beyond the wiring test) | The guard's HOST wiring is large; we study the tracker itself + how it's tested, not the whole runtime (baseline OUR loop.ts insertion in `/to-plan`). |
| opencode permission subsystem beyond the doom-loop check | The permission gate is opencode-specific; we borrow the fingerprint + threshold + break decision, not the permission model. |
| Both refs' build artifacts (`dist/`, `node_modules/`) + docs | Generated / not source of truth. |
| Any project NOT symlinked under `.claude/knowledge-base/references/` | Cross-Project Rule — never cite a project we cannot read. |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** cline 3h (deepest — the isolated pure tracker + typed stop + wiring test is the direct analog to OUR pluggable tracker), opencode 2h (the inline fingerprint + threshold + break decision).

**Rationale:** cline's `safety/` module is a pure, injectable state machine with a typed `MistakeOutcome` (continue-with-guidance vs stop-with-message) — exactly the shape OUR `loop.ts` tracker seam wants; opencode gives the compact fingerprint (`name + JSON.stringify(input)` over last-N) and the continue-on-deny knob.

**Stop condition — per question:** after 3 empty Fase-A query-variant retries, mark the question BLOCKED "Fase A exhausted" and continue; never fabricate.
**Stop condition — per project:** on budget exhaustion, mark remaining questions BLOCKED "budget exhausted"; if every project is done-or-blocked, emit `<promise>BLUEPRINT_BLOCKED</promise>` with the honest report.
**Anti-pattern:** NEVER fabricate a Fase-B answer for a Fase-A-exhausted question (Unbreakable Rule 3).
**Consequences:** blocked questions surface in `## Blocked questions` as next-discovery seed.

### D2 — Investigation depth

**Decision:** Read `loop-detection.ts` + `mistake-tracker.ts` end-to-end (small pure modules); read only the doom-loop REGION of opencode `processor.ts` (the file is large); read only the loop-detection/mistake SCENARIOS of the cline wiring test.

**Rationale:** the tracker modules are the borrowable unit; the surrounding runtime is host-specific and belongs in the plan's Baseline (OUR loop.ts), not the blueprint.

**Consequences:** the blueprint recommends a tracker shape + insertion seam, not a runtime rewrite.

### D3 — Behavior-preservation + reuse constraint

**Decision:** Any borrowed pattern MUST integrate into OUR existing pluggable iteration-tracker seam (`loop.ts` `budget.shouldContinue()` / `decision.reason`, per the shipped step-cap/budget tracker) and COMPLEMENT the existing empty-round `no_progress` (`run-to-completion.ts:62`) — not replace it. A typed terminal/reason, never a thrown-away silent stop (`rules/error-handling.md`).

**Rationale:** Rule 9 (don't reinvent — OUR tracker abstraction already exists) + Rule 12 (DRY — one loop-termination home). The empty-round and identical-repeat detectors cover DIFFERENT failure modes; both stay.

**Consequences:** the blueprint's recommendation is an explicit "new tracker plugged into the existing seam" decision, with the fingerprint + threshold + reason token named.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How does opencode detect a doom loop — the fingerprint, the window (last-N parts), the threshold, the ACTION taken (permission/nudge vs hard break), and the `continue_loop_on_deny` knob? **(EC-3 scope note: the borrowed value is the FINGERPRINT + WINDOW + THRESHOLD + break-decision TECHNIQUE — NOT opencode's permission model. OUR action is a typed terminal/reason plugged into the existing iteration-tracker seam; cline's `MistakeOutcome` stop/continue (Q3) is the closer action analog.)** | techniques | `.claude/knowledge-base/references/opencode/` | `grep -n "DOOM_LOOP_THRESHOLD\|recentParts\|JSON.stringify(part.state.input)\|doom_loop\|continue_loop_on_deny" opencode/packages/opencode/src/session/processor.ts` | **(EC-2)** Read ONLY the doom-loop region via offset (the grep'd windows `:30-40`, `:515-545`, `:960-970`) — NOT the whole ~1000-line file; capture the fingerprint expression, the `slice(-THRESHOLD)` window, the identical-check, the action, and the break decision | Fingerprint + window + threshold (=3) + action + continue-on-deny, each with `opencode/.../processor.ts:line` |
| Q2 | How does cline's `LoopDetectionTracker` compute a tool-call signature and count consecutive identical calls, and what soft/hard thresholds + verdict does `checkRepeatedToolCall` emit? | techniques | `.claude/knowledge-base/references/cline/` | `grep -n "toolCallSignature\|sortKeys\|consecutiveIdenticalCount\|checkRepeatedToolCall\|softThreshold\|hardThreshold\|softWarning\|hardEscalation" cline/sdk/packages/core/src/runtime/safety/loop-detection.ts` | Read `loop-detection.ts` end-to-end; capture the key-sorted-JSON signature, the state (`consecutiveIdenticalCount`), the soft(3)/hard thresholds, the `LoopCheckResult`/`LoopDetectionVerdict` shape | State machine + signature + thresholds + verdict, each with `cline/.../loop-detection.ts:line` |
| Q3 | How does cline's `MistakeTracker` escalate repeated failures to a TYPED STOP — the `MistakeOutcome` (continue-with-guidance vs stop-with-message), `maxConsecutiveMistakes`, and `forceAtLimit` (jump straight to the limit for a hard loop)? | techniques | `.claude/knowledge-base/references/cline/` | `grep -n "MistakeOutcome\|maxConsecutiveMistakes\|forceAtLimit\|action.*stop\|action.*continue\|record(" cline/sdk/packages/core/src/runtime/safety/mistake-tracker.ts` | Read `mistake-tracker.ts` end-to-end; capture the typed outcome union, the counter + limit, and how `forceAtLimit` lets a hard loop-detection short-circuit to STOP | Typed outcome union + counter/limit + forceAtLimit semantics, each with `cline/.../mistake-tracker.ts:line` |
| Q4 | How does cline TEST the loop-detection + mistake-tracker wiring — which scenarios assert "aborts on hard-threshold loop detection of identical tool calls" and "aborts after maxConsecutiveMistakes", and how are the fake tool calls shaped? | tests | `.claude/knowledge-base/references/cline/` | `grep -n "loop detection\|identical tool\|maxConsecutiveMistakes\|hard-threshold\|resets mistake\|it(" cline/sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.test.ts` | **(EC-1)** Read ONLY the scenario blocks via offset (`Read` around `:1920-:2170`, driven by the Fase-A grep lines) — NOT the whole ~2400-line suite; capture the arrange (repeated identical calls / failing turns) and the assertion (abort + reason) | Test-scenario inventory (case → arrange → assertion), each with `cline/.../session-runtime-orchestrator.test.ts:line` — informs OUR TDD RED set |
| Q5 | Is the doom-loop / loop-detection logic dependency-free (a pure state machine) or does it pull a library? | deps | `.claude/knowledge-base/references/cline/` | `grep -n "^import" cline/sdk/packages/core/src/runtime/safety/loop-detection.ts cline/sdk/packages/core/src/runtime/safety/mistake-tracker.ts` ; read `cline/sdk/packages/core/package.json` deps | Read the import lines + package.json; confirm the tracker is pure TS (type-only imports) with no runtime lib | Dep verdict (pure vs lib) + citations — informs OUR "no new dependency" expectation (`rules/parsimony-ladder.md`) |
| Q6 | WHERE does the guard live architecturally — cline's isolated pure `safety/` module owned by the runtime (verdict → abort) vs opencode's INLINE processor check — and how is the verdict wired to a loop-break? | tools | `.claude/knowledge-base/references/cline/`, `.claude/knowledge-base/references/opencode/` | `grep -n "createLoopDetectionState\|resetLoopDetectionState\|LoopDetectionState\|export" cline/sdk/packages/core/src/runtime/safety/loop-detection.ts` ; `grep -n "shouldBreak\|permission\|doom_loop" opencode/packages/opencode/src/session/processor.ts` | Read the tracker's public surface (state create/reset/check) + the two wiring styles (isolated-injected vs inline); capture which maps to OUR pluggable tracker seam | Isolation verdict + wiring style per ref + the OUR-seam mapping, each with `...:line` — informs WHERE our tracker plugs (loop.ts budget/tracker) |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4 | Covered |
| Dependencies | Q5 | Covered |
| Tools | Q6 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | Every `.claude/knowledge-base/references/{project}/{path}` in Qx's Fase A exists | Mark Qx BLOCKED "path not found", continue |
| Per-question Fase A budget | Fase A returned ≥1 hotspot OR 3 query-variant retries attempted | After 3 empty retries, mark Qx BLOCKED "Fase A exhausted"; continue |
| Small-module read-full fallback | For `loop-detection.ts` / `mistake-tracker.ts` (small pure files), if a keyword grep is empty, Read the file fully before BLOCKING | A keyword miss must not BLOCK a readable small module |
| After answering Qx | Blueprint section under Qx has ≥1 `references/` citation | Re-iterate Qx (1 retry max) |
| Mid-loop sanity | ≥1 citation per ~200 words of blueprint prose | Add citations to under-cited paragraphs (1 retry max) |
| Before promising complete | All 4 coverage corners have populated blueprint sections | Refuse promise, continue |

## Acceptance Criteria

- [ ] All research questions answered OR explicitly BLOCKED with reason
- [ ] All four coverage corners have populated sections in the blueprint
- [ ] Every citation in the blueprint points to a real `.claude/knowledge-base/references/{...}` path
- [ ] At least one ADR section in the blueprint synthesizes decisions (the fingerprint + threshold + reason token + insertion seam)
- [ ] Time budget respected per project
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/doom-loop-guard-blueprint.md`

## Global Definition of Done

- [ ] All phases completed (plan → edge-cases → plan-confidence → execute → confidence → improve if needed → confidence re-score)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations
- [ ] Coverage Matrix 100% covered
- [ ] ADRs reference at least one project rule — `rules/architecture.md` (pluggable domain tracker / DIP seam), `rules/testing.md` (pure state machine unit-testable), `rules/error-handling.md` (typed stop, never a silent hang)
