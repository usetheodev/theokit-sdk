# Implementation: M1-4 — Fire the `stop` hook + bounded `feedback` re-prompt

**Slug:** `m1-stop-hook-reflection`
**Date:** 2026-06-20
**Plan:** `knowledge-base/plans/m1-stop-hook-reflection-plan.md` (SHIPPABLE 95.6)
**Blueprint:** `knowledge-base/discoveries/blueprints/m1-stop-hook-reflection-blueprint.md` (SHIPPABLE 99.2)
**Promise:** IMPLEMENTATION_COMPLETE

## What shipped

The declared-but-dead `HookEvent "stop"` now fires. The agent loop dispatches `stop` (via the existing `HooksExecutor`) at the clean-finish terminal; a `stop` hook returning `decision:"feedback"` pushes that text as a `user` re-prompt and continues the loop — a bounded reflection ladder. Zero new dependencies.

## Files

| File | Change |
|---|---|
| `packages/sdk/src/internal/agent-loop/loop.ts` | NEW `reflectAfterStop` (fires `stop`, honors `feedback` bounded) + `finishOrReflect` (nudge/reflect/finish decision, extracted to cap complexity) + `MAX_STOP_FEEDBACK_ATTEMPTS=2`; `continueOrTerminate` exported + wired; 354 LoC. |
| `packages/sdk/src/internal/agent-loop/loop-context-init.ts` | added `stopFeedbackAttempts: number` to `LoopContext` (init 0). |
| `packages/sdk/tests/internal/agent-loop/stop-hook-reflection.test.ts` | NEW — 9 tests (fake-hooks driven). |
| `docs.md` | hooks-section note: `stop` fires on clean finish; `feedback` → bounded re-prompt; allow/deny finish. |
| `CHANGELOG.md` (root) | `[Unreleased] § Added` entry. |
| `.changeset/m1-stop-hook-reflection.md` | minor changeset. |

## Design (blueprint ADRs D1-D4 + edge-case EC-1..EC-4)

- **D1** dispatch `stop` at the clean-finish terminal only (not on error/iteration-ceiling).
- **D2** `decision:"feedback"` → push `feedback` as a `user` message + continue (mirror the nudge); allow/deny/no-hook finish (NOT output replacement).
- **D3** bound with `LoopContext.stopFeedbackAttempts` + `MAX_STOP_FEEDBACK_ATTEMPTS` (2); finish at ceiling.
- **D4** reuse `HooksExecutor.run`; zero new deps.
- **EC-1** ceiling counts feedback re-prompts only (allow/deny don't bump). **EC-2** error-terminal test exercises `continueOrTerminate` routing via a spy. **EC-3/EC-4** documented (budget also bounds; abort honored at next iteration).

## Wiring triad

- **(a) Caller** — `reflectAfterStop` ← `finishOrReflect` ← `continueOrTerminate` ← `runIteration` ← `runAgentLoop` (production path, internal callers — knip clean).
- **(b) Integration test** — `stop-hook-reflection.test.ts` drives `reflectAfterStop` + the real `continueOrTerminate` error routing with a fake `inputs.hooks.run` (the boundary the loop crosses).
- **(c) Runtime metric** — N/A: `stop` dispatch is observable via the hook firing itself (consistent with `preToolUse`/`postToolUse`, which have no separate counter).

## Gates

- Unit tests: 14/14 GREEN (9 + 5 added in the review round).
- Full SDK suite: 371 files / 2720 tests passed, 0 failed (19/35 skips Ollama/env-gated).
- `tsc --noEmit`: clean.
- Biome (cognitive-complexity ≤ 10): clean — `finishOrReflect` extracted to keep `continueOrTerminate` under the cap.
- knip (dead-code): clean.
- LoC: `loop.ts` 354 (≤ 360 target, 500 budget).

## Commit (develop)

- `fb268f9` feat(sdk): fire stop hook + bounded feedback re-prompt (M1-4)
