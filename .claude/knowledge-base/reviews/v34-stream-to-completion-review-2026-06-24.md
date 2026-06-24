# Review — v34-stream-to-completion (V3-4)

**Date:** 2026-06-24 · **Slug:** v34-stream-to-completion
**Commits reviewed:** `96a507f` (feat) + `1918060` (type-test, review LOW) on `develop` (theokit-sdk)
**Reviewers:** 2 independent fresh-eyes agents (driver-correctness · public-API/architecture/DRY/docs)
**Verdict:** **READY_TO_MERGE** (2 PASS lenses, 0 BLOCKER, 0 HIGH, 0 MEDIUM; the single LOW absorbed).

## Overview
V3-4 (gap V2-2A-2): the SDK already covered (c) terminals (`runToCompletion`/`classifyRound`, M1) + (b) stateless (`buildReplayHistory`); the only missing criterion was **(a) streaming**. This slice adds `agent.streamToCompletion` — an `AsyncGenerator<SDKMessage, StreamToCompletionResult>` that drives a multi-round continuation loop **yielding each round's events live**, reusing `classifyRound`/`addUsage`/`isEmptyRound` verbatim (made `export @internal`; one definition, no copy). Local-only (cloud throws `UnsupportedRunOperationError`); stateful (stateless+streaming = `buildReplayHistory` + this, documented). ADR 0031 respected: a streaming sibling of an existing primitive, not a new policy layer.

## Lens verdicts

### Driver correctness — PASS
Verified by tracing + mutation. (a) stream-then-wait ordering correct against BOTH local runtimes (`FixtureRunBase` + `RealLocalRun` make `stream()` self-terminating, so drain-then-`wait()` cannot deadlock). (b) `classifyRound` reused (grep = 1 definition). (c) terminal precedence + emptyStreak + maxRounds + signal-between-rounds byte-equivalent to `runToCompletion`. (d) result is the generator RETURN value. Adversarial probes all correct (maxRounds=0, zero-event-done, abort mid-round vs between-rounds, early `gen.return()` cleanup forwards into the inner stream + skips the next round). `yield*` vs `for await` mutation: equivalent (stream returns `void`); preserves cleanup. Mutation test (dropped the abort line) confirmed the abort test genuinely pins behavior. Cloud-throw synchronous. 27 sibling tests green.

### Public-API / architecture / DRY / docs — PASS
docs.md updated in the same commit (manual-`next()` idiom + `for await` discards-return caveat + stateless=`buildReplayHistory` note + local-only/cloud-throws) — CLAUDE.md public-surface rule satisfied. `SDKAgent.streamToCompletion?` optional (no implementer breaks); `StreamToCompletionResult` `@public` + reaches the barrel. `RunOperation` gained `"streamToCompletion"`. DRY: classifyRound/addUsage/isEmptyRound one definition each; the `run-to-completion.ts` change is export-only (M1 driver's 18 tests still green — no regression). Architecture: genuine sibling, local-only + stateful (consistent), zero new dependency. `StreamToCompletionResult = RunToCompletionResult` alias is the correct choice (identical shape; a distinct interface would duplicate knowledge). Locked names intact; typecheck + biome clean.

## LOW finding — absorbed (`1918060`)
- (API lens) The plan's T1.1 type contract was satisfied by a runtime `as` cast (suppresses, not asserts). **Added** `test_stream_to_completion_types` with `expectTypeOf` (StreamToCompletionResult equals the M1 result shape; RunOperation accepts `'streamToCompletion'`; impl returns `AsyncGenerator<SDKMessage, StreamToCompletionResult>`), validated by `tsc` (exit 0). Closes the T1.1 DoD.

## Validation (all green)
`@theokit/sdk` full suite **2880 passed** / 35 skipped (post-refactor); 10 `stream-to-completion` tests (round-order, done@0, step_limit, no_progress, abort-between-rounds, return-value-via-manual-next EC-1, early-break-cleanup EC-2, type-test, local-wiring, cloud-throw); typecheck exit 0; biome clean (7 src files + 2 tests); `classifyRound` one definition (DRY); docs.md synced; changeset `@theokit/sdk` minor.

## Conclusion
The slice closes the V3-4 (a) streaming gap with a streaming twin of `runToCompletion` that reuses the proven terminal policy (no re-derivation — the "sem re-trabalho" directive) and respects ADR 0031 (sibling of an existing primitive, not a speculative Harness layer). Driver verified by mutation; public surface documented + type-tested; M1 untouched in behavior. The owner chose to extend the SDK over the roadmap's app-policy escape hatch; this is the minimal, DRY realization of that choice. **Verdict: READY_TO_MERGE.**

## Loop-closure follow-up (out of this slice)
Per ROADMAP-v3 V3-4: the theocode `runCodeAgent` MAY now adopt `agent.streamToCompletion` for the generic streaming-continuation outer loop, keeping its `selectReflection` ladder (verify-fix/requireEdit — code-assistant domain) as app-policy on top. That adoption happens in the theocode repo.
