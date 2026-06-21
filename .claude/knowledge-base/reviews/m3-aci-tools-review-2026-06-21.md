# Review: m3-aci-tools

**Date:** 2026-06-21
**Reviewers (spawned agents):** 2 — architecture+wiring+behavior, test-auditor+cross-validation (general-purpose, opus-class)
**Findings (initial):** 0 BLOCKER, 0 HIGH, 4 LOW, INFO
**Findings (after hardening `faf69ee`):** 0 BLOCKER, 0 HIGH, 0 MEDIUM, advisory LOW/INFO only
**Verdict:** READY_TO_MERGE

> Per-agent finding files: `.claude/agents/review-m3-aci-tools-2026-06-21/findings/*.md`.

## Scope reviewed

Commits `682c9e7` (T1.1) + `b392b02` (T2.1 docs) + hardening `faf69ee`, on `develop` vs `main`. Files: `packages/sdk-tools/src/internal/tool-aci.ts`, `index.ts`, `tests/tool-aci.test.ts`, `docs.md`, root `CHANGELOG.md`, `.changeset/m3-aci-tools.md`.

## BLOCKER / HIGH findings

_None._ Both reviewers independently reached 0 BLOCKER, 0 HIGH. The slice is two pure, zero-dep functions; behavior verified correct (immutable override with references preserved; ampersand-first escaping with no double-escape; name + description both escaped so the `<tools>` block cannot be broken out of; single-source render reads only the passed array; empty-safe; never-throw).

## LOW findings (addressed in hardening `faf69ee`)

- **[FIXED] `esc` could throw on a non-string name/description** (architecture F7): although `CustomTool` types both as `string`, an untyped/`as any` caller could pass a non-string and break the "never-throw" docstring. Wrapped with `String(s)` — the guarantee now holds for untyped callers too.
- **[FIXED] tool-name escaping not directly tested** (architecture F8): the anti-injection property (a tool name containing `</name>` cannot break the block) rested on inference from the description test. Added an explicit test (`a</name>x` → `&lt;/name&gt;`, raw `</name>x` absent).

## LOW findings (accepted — plan-conformant)

- per-package `packages/sdk-tools/CHANGELOG.md` not updated (cross-validation LOW-1): the entry lives in the root `CHANGELOG.md`, which the plan scoped explicitly and which matches the established M3-1..M3-4 pattern; changesets generate the per-package CHANGELOG at version-bump. Plan-conformant, not a correctness defect.
- `withDescription`→`renderToolList` composition (cross-validation LOW-2): already exercised by the no-drift test; no extra case needed.

## INFO confirmations

- ADRs D1-D5 honored in code; Coverage Matrix 8/8 covered; assertions non-vacuous (no-drift asserts the old description is ABSENT via `>old<`, not just the new present; escape asserts raw `<b>` absent + escaped present; EC-1 asserts `&amp;lt;` absent — kills the wrong-order mutant).
- SRP/cohesion/placement clean (internal/, 53 LoC, complexity ≤ 10); DIP type-only `CustomTool` import; zero new deps; `withDescription` does not mutate the original (object literal; `inputSchema`/`handler` preserved by reference — correct, a handler closure cannot be deep-copied); single source of truth (no hidden registry); KISS/YAGNI exemplary.
- changeset `@theokit/sdk-tools:minor` correct; docs accurate (the `<tools>` block is a prompt aid, the provider schema stays `inputSchema`) — no overclaim; no scope creep (only planned files changed).

## Quality gate re-validation (after `faf69ee`)

- Full sdk-tools suite: 24 files / **241 passed, 0 failed** (+10 from M3-5: 9 helper + 1 barrel).
- typecheck exit 0; Biome clean (55 files, 0 warnings, complexity ≤ 10); knip exit 0; build emits ESM+CJS+DTS; code-quality PASS.

## Edge-case coverage

Plan EC-1 (ampersand-first escaping) covered, plus the review-added tool-name escaping (anti-injection) and the never-throw `String()` guard; empty-array and no-drift cases covered.

## Verdict rationale

0 BLOCKER, 0 HIGH from two independent reviewers. The 2 actionable LOW findings (never-throw hardening + name-escaping test) are addressed in `faf69ee`; the remaining 2 LOW are plan-conformant non-defects. Per `cycle-review.md § Verdicts`: **READY_TO_MERGE.**

## Recommended next step

`/release` (a `@theokit/sdk-tools` minor — additive ACI helpers). Then continue M3 with M3-6 (catastrophic shell at the agents layer — depends on M3-2, now done).
