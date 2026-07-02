# Implementation Summary — m1-harness-correctness

**Plan:** `knowledge-base/plans/m1-harness-correctness-plan.md` (v1.0, SHIPPABLE_WITH_CAVEATS)
**Milestone:** M1 (Harness correctness core) · **Branch:** develop · **Date:** 2026-07-02 · **Runtime:** Node 22.22.2

## Verdict: IMPLEMENTATION_COMPLETE

All 4 defects implemented TDD-first (RED proven against pre-fix code), wired into production paths, committed atomically, zero new dependencies (stdlib only — deps-audit PASS).

## Task results + wiring

| Task | Issue | Commit(s) | RED test | Wiring (production caller) |
|---|---|---|---|---|
| T4.1 | #55 permission name-only + fail-open | `f93bb9a` | `tests/permission-engine-args.test.ts` (args ignored → deny leaked) | `permission-plugin.ts:42` forwards tool args into `evaluate` (arg-gating live in `pre_tool_call`) |
| T1.2 | #58 JobQueue cancel/concurrency | `c004a3b` | `tests/job-queue-cancel-concurrency.test.ts` | public `JobQueue` (8 consumers) — additive AbortController + semaphore |
| T1.1 | #58 abort→tools + per-tool timeout | `61cf3e1` | `tests/agent-loop/tool-abort-timeout.test.ts` | `runToolWithLifecycle` wraps every tool in `raceToolExecution`; `loop.ts` between-iteration abort |
| T2.1 | #65 7 dead hooks + ToolContext | `01b4edd` | `tests/internal/plugins/dead-hooks-wired.test.ts` + `tests/define-tool-toolcontext.test.ts` | 7 `run*Hooks` invoked at real loop sites (session start/end, pre/post_llm_call, post_tool_call, 2 transforms); `defineTool` handler gets `ToolContext.signal` |
| T3.1 | #57 tool-result content defense | `16e24a3` | `tests/agent-loop/tool-result-transform.test.ts` | `applyToolResultGuard` at the `transform_tool_result` seam via `inputs.toolResultGuard` (opt-in) |

## Edge/negative cases covered (from the plan's absorbed edge-case review)

- EC-1 (#58): tool that ignores its signal still bounded by the timeout race.
- EC-2 (#65): a throwing transform hook does NOT corrupt the payload (prior value kept).
- EC-3 (#55): a rule with a declared arg matcher does not match a call missing that arg (no throw).
- EC-4 (#57): a forged closing boundary inside tool output is neutralized (cannot break the frame).
- EC-6 (#58): `maxConcurrency < 1` clamped to 1 (no deadlock).

## Design decisions (per plan Unresolved Questions)

- Q1 (#55 fail-closed value) → `"ask"` (least-destructive fail-closed). BREAKING behavior change, documented in changeset + `docs.md` with the `{ defaultAction: "allow" }` opt-out.
- Q2 (ToolContext scope) → thread `signal` now (ties to #58); `requestConfirmation`/`requestCredential` round-trip deferred to a follow-up.
- Q3 (#57 default) → both `delimit` and `redactPii` OPT-IN (default off) to stay non-breaking; enabling recommended. (Deviates from the plan's "delimit on-by-default" for safety — on-by-default would change tool-result strings and break golden tests. Documented.)

## Parsimony

Zero new dependencies. #58 uses stdlib `AbortController`/`AbortSignal.any`/`AbortSignal.timeout`; #55/#57 use `RegExp`; #65 reuses the existing hook-runner pattern. deps-audit PASS.

## Changesets

Four under `.changeset/`: `m1-55-*` (minor), `m1-58-*` (minor), `m1-65-*` (minor), `m1-57-*` (minor). `docs.md` updated for #55 (permission args + fail-closed).

## Integration validation result

Full `@theokit/sdk` suite (Node 22): **3150 passed / 1 failed / 36 skipped (3187)**. Typecheck + Biome clean; pre-commit `pnpm validate` gates passed on each commit.

**The single failure is a sandbox-environment artifact, NOT an M1 regression:**
`tests/internal/runtime/context-discovery.test.ts > findGitRoot returns undefined when no .git anywhere`.
Root cause: this sandbox has a stray `/tmp/.git` directory, and the test creates its workspace via
`mkdtemp(os.tmpdir())` (= `/tmp/...`), so `findGitRoot` walks up and finds `/tmp/.git` — violating the
test's "no .git above tmpdir" assumption. Confirmed: (a) M1 did not touch `findGitRoot`/context-discovery
(`git diff` empty for those files); (b) the test + source date to 2026-06-07 (pre-M1); (c) it passed in
M0's identical-code-path full runs (before `/tmp/.git` appeared); (d) `node -e` shows `.git FOUND at /tmp`.
Per `cycle-plan` "If Validation Fails": pre-existing/environmental failures are logged, do NOT block
plan completion, and are documented in the PR. Not deleting `/tmp/.git` (not created by this work).

**Every M1 test passes** (permission-args 7, job-queue-cancel-concurrency 4, tool-abort-timeout 5,
dead-hooks-wired 7, define-tool-toolcontext 2, tool-result-transform 5, + the updated permission/agent-loop
suites). M1 code is green.

## Next
→ `/code-quality` → `/review` → READY_TO_MERGE.
