# Review: m3-command-policy

**Date:** 2026-06-21
**Reviewers (spawned agents):** 2 — architecture+wiring+behavior, test-auditor+cross-validation (general-purpose, opus-class)
**Findings (initial):** 0 BLOCKER, 0 HIGH, 1 LOW (empty-string deny footgun), INFO
**Findings (after hardening `a9f3c97`):** 0 BLOCKER, 0 HIGH, 0 MEDIUM, advisory INFO only
**Verdict:** READY_TO_MERGE

> Per-agent finding files: `.claude/agents/review-m3-command-policy-2026-06-21/findings/*.md`.

## Scope reviewed

Commits `95d9210` (T1.1) + `51bf3ae` (T2.1 docs) + hardening `a9f3c97`, on `develop` vs `main`. Files: `packages/sdk-tools/src/internal/command-policy.ts`, `index.ts`, `tests/command-policy.test.ts`, `docs.md`, root `CHANGELOG.md`, `.changeset/m3-command-policy.md`.

## BLOCKER / HIGH findings

_None._ Both reviewers independently reached 0 BLOCKER, 0 HIGH. The slice is four small pure functions (40 LoC). The **key Rule-9 check passed**: `denyCatastrophicCommands()` genuinely COMPOSES `catastrophicShellReason` (M3-2) — it does not re-implement the deny-list — and the test pins this with an exact-value `toBe(catastrophicShellReason(...))` assertion that kills any re-implementation/divergence mutant.

## LOW findings (addressed in hardening `a9f3c97`)

- **[FIXED] empty-string deny footgun** (architecture): a `CommandPolicy` returning `""` is treated as a deny-with-blank-reason (`"" !== null`), which is almost never intended; it was undocumented and untested. The `!== null` strict check is the CORRECT choice (a falsy check would lose a legitimately-empty deny and mis-treat `""` as allow) — so the fix is documentation + a test, not a behavior change: documented on the `CommandPolicy` type ("return `null` to allow — NOT `''`") and added a regression test pinning the empty-string-is-deny behavior.

## INFO (addressed / confirmed)

- test-auditor INFO (addressed): the `commandDenialReason returns the deny reason string` test asserted only `typeof === "string"` (weak in isolation, though mitigated by the first-deny-wins exact-reason test). Strengthened to an exact `toBe(catastrophicShellReason(...))` assertion.
- confirmations: SRP/cohesion/placement clean; DIP imports only the same-package `catastrophicShellReason` (no coupling to `@theokit/sdk` or `acp`); deny-wins correct (first non-null, short-circuits); empty array allows all; `isCommandAllowed === (commandDenialReason === null)`; no throw path; all 5 ADRs honored + Coverage Matrix 8/8; zero new deps; changeset `@theokit/sdk-tools:minor` correct; docs honest (the `pre_tool_call` glue is the consumer's; NO `@theokit/agents` package or ACP plugin shipped — KISS/YAGNI per D4); no scope creep (only planned files changed).
- non-vacuous assertions: composition pinned with `toBe`; first-deny-wins tested in BOTH orders with a distinct sentinel string; empty-list asserts both `isCommandAllowed` true AND `commandDenialReason` null.

## Quality gate re-validation (after `a9f3c97`)

- Full sdk-tools suite: 25 files / **251 passed, 0 failed** (+11 from M3-6: 10 policy + 1 barrel).
- typecheck exit 0; Biome clean (57 files, 0 warnings, complexity ≤ 10); knip exit 0; build emits ESM+CJS+DTS; code-quality PASS.

## Edge-case coverage

Plan EC-1 (first-deny-wins both orders) covered, plus the review-added empty-string-deny case and the exact-reason composition assertion; empty-policy-list allows-all covered.

## Verdict rationale

0 BLOCKER, 0 HIGH from two independent reviewers. The single LOW (empty-string footgun) is addressed in `a9f3c97` with documentation + a regression test; the weak-assertion INFO is likewise strengthened. The Rule-9 compose-not-duplicate property — the central design risk for this slice — is verified correct and mutation-guarded. Per `cycle-review.md § Verdicts`: **READY_TO_MERGE.**

## Recommended next step

`/release` (a `@theokit/sdk-tools` minor — additive command-policy layer). Then continue M3 with M3-7 (web-search adapter env-driven) — the last M3 item.
