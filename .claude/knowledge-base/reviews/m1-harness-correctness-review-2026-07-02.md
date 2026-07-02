# Review: m1-harness-correctness

**Date:** 2026-07-02
**Reviewers (spawned agents):** 5 — architecture, tests, wiring, cross-validation, domain-security (security rate-limited; its lens covered by architecture + wiring + the security-focused fixes)
**Findings:** 1 BLOCKER · 2 HIGH · 5 MEDIUM · several LOW/INFO
**Verdict (initial):** NEEDS_FIXES → (after remediation `673c377`) **READY_TO_MERGE**

## Per-agent verdicts (initial)

| Agent | Verdict |
|---|---|
| architecture | CONCERNS (ARCH-01/02 escalate to BLOCKER if unwired) |
| tests | CONCERNS (loop-integration gap) |
| wiring | **BLOCKERS** (2 dead knobs) |
| cross-validation | GAPS_FOUND |
| domain-security | (rate-limited) |

## BLOCKER — fixed

### B1 — `perToolTimeoutMs` (#58) + `toolResultGuard` (#57) were dead knobs (flagged ×3: wiring, ARCH-01/02, XV-1)
- Consumed by the loop but NO public producer — `buildLoopInputs` never set them; no `SendOptions`/`AgentOptions` field mapped. Two headline objectives unreachable from the public API (`no-stubs-no-mocks-no-wired §3`).
- **Resolution:** added `SendOptions.perToolTimeoutMs` + `SendOptions.toolResultGuard`; mapped both in `buildLoopInputs` (`real-local-run.ts`); exported `ToolResultGuardOptions` from `index.ts`. Proven end-to-end: `hooks-loop-integration.test.ts` — `perToolTimeoutMs` bounds a hung tool through `runAgentLoop` (exit 124, run finishes); `toolResultGuard` delimits tool output before the transform hook sees it.

## HIGH — fixed

### H1 — no loop-integration test for the 7 hooks (TQ-M1-01) + missing `loop_checks_abort_between_iterations` (TQ-M1-02/XV-3)
- The 7 hooks were proven only at the manager level (the M0 F-H2 masking risk); `loop.ts` between-iteration abort had no test.
- **Resolution:** `tests/internal/agent-loop/hooks-loop-integration.test.ts` — drives `runAgentLoop` with a real `PluginManager`: asserts on_session_start/end, pre/post_llm_call, post_tool_call, transform_tool_result all fire through the real loop; a cancel after a tool round stops the loop (turns === 1, not maxIterations). Deleting a loop-site invocation now fails a test.

## MEDIUM — fixed

- **ARCH-03** — `raceToolExecution` attached an abort listener to the long-lived run signal and never removed it (leak on tool-heavy runs). → rewritten to remove the listener on the exec-wins path.
- **ARCH-04** — `permission-engine.ts` JSDoc still said default `"allow"` (contradicting the `"ask"` fail-closed impl). → corrected.
- **XV-2** — `docs.md` DoD unmet for JobQueue opts / hooks / ToolContext / guard. → added a docs.md block for `perToolTimeoutMs`, `toolResultGuard`, `JobQueue({maxConcurrency})`, `ToolContext`, and all 10 hooks.
- **ARCH-05** — `transform_llm_output` wired only in the tool-turn branch. → documented its precise scope (rewrites the assistant text recorded into the tool-turn loop context) in docs.md; narrowing the contract rather than expanding into the streaming path (lower risk).

## Cross-validation summary
4/4 tasks map to commits; ADRs D1-D4 followed; 0 new deps; 4 changesets (m1-55/57/58/65); Coverage Matrix 4/4. Q1 (fail-closed `"ask"`) + Q2 (signal now, round-trip deferred) resolved as planned; Q3 (#57 opt-in vs plan's on-by-default) — deviated but documented + justified (on-by-default would reshape every tool result + break golden tests); accepted.

## LOW / INFO (accepted or follow-up)
- ARCH-06 (JobQueue `jobs` Map unbounded retention — pre-existing) — follow-up (bounded/TTL).
- ARCH-07 (`#runTransform` undefined-return == keep-prior) — documented contract.
- ARCH-08 (boundary neutralization exact-case only) — comment softened; case-insensitive is a follow-up.
- ARCH-09 (ToolContext.signal to custom tools only, not memory) — documented (custom `defineTool` handlers); memory-tool parity is a follow-up.
- XV-5/INFO (timeout as ToolResult exit-124 vs thrown error) — documented, arguably better for loop resilience.

## Quality gates
`@theokit/sdk` full suite: **3150 passed / 1 failed** — the 1 failure is a sandbox `/tmp/.git` artifact affecting a pre-existing unrelated test (`context-discovery findGitRoot`); confirmed environmental (M1 didn't touch it; passed in M0's runs; `node -e` shows `.git FOUND at /tmp`). Every M1 test passes. typecheck clean; Biome clean; `pnpm validate` gates passed on every commit.

## Handoff decision (final)
**READY_TO_MERGE** — 0 unresolved BLOCKER/HIGH (all remediated + tested in `673c377`), all MEDIUM resolved or documented. Wiring now complete (both dead knobs reachable + proven end-to-end); the security-relevant fixes (#55 fail-closed, #57 injection defense) are wired and reachable. Open the `develop → main` release PR (`/release`).
