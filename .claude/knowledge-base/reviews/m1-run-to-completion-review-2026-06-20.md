# Review: M1 Phase 3 — `runToCompletion`

**Date:** 2026-06-20
**Slug:** `m1-run-to-completion`
**Commit reviewed:** f218630 (fixes in follow-up commit)
**Reviewers:** 5 specialist agents (architecture, test-quality, correctness, wiring/cross-validation, API/DX)

## Verdict

**READY_TO_MERGE** — after the review-fix round. No BLOCKER at any stage; all HIGH findings resolved.

## Per-agent verdicts (initial)

| Agent | Verdict | HIGH |
|---|---|---|
| architecture (DIP/SRP/layering) | READY | 0 (1 MEDIUM docs RunOperation — adjudicated as by-design) |
| test-quality | NEEDS_FIXES | 2 (cloud throw untested; weak abort test) |
| correctness (loop logic) | READY | 0 (1 MEDIUM pre-abort; LOWs EC-10, abort label) |
| wiring/cross-validation | READY | 0 (1 MEDIUM CHANGELOG) |
| API/DX | NEEDS_FIXES | 2 (docs example non-compiling; rounds wording) |

## Findings resolved

- **HIGH** CloudAgent throw path untested → test added.
- **HIGH** abort test ambiguous → tightened (`sends == ["do X"]`, `rounds === 0`).
- **HIGH** docs.md example non-compiling (optional method) → `?.` + undefined guard.
- **HIGH** `rounds` wording inconsistent → precise JSDoc + docs.md aligned.
- **MEDIUM** CHANGELOG `[Unreleased]` missing entry → added.
- **MEDIUM** classifyRound priority untested → boundary tests added.
- **LOW** EC-10 `totalTokens` invariant → `addUsage` derives total.
- **LOW** no-usage/default-prompt/maxRounds=0 untested → tests added.

Tests: 11 → 18 GREEN.

## Adjudicated as by-design (documented, not defects)

- Abort → `terminal: "step_limit"`: plan-approved ("stop with current terminal"); documented in run.ts JSDoc, docs.md, changeset. Pre-first-round abort runs one round (consistent with the SDK's between-operations abort contract; the LLM call itself is non-cancellable mid-flight per D140).
- docs.md `RunOperation` stays the Run-scoped subset; agent-level ops (`runUntil`/`fork`/`runToCompletion`) are documented in prose, matching the existing convention.
- `runToCompletion?` optional on `SDKAgent`, consistent with `runUntil?`/`fork?`/`usePersonality?`.

## Gates

tsc clean · Biome clean (cognitive-complexity ≤ 10) · knip clean · full SDK suite GREEN.
