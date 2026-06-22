# Review — m4-skills-discovery (M4-1)

**Date:** 2026-06-21
**Verdict:** READY_TO_MERGE
**Commits:** f9be17a (impl) + 369b9cc (review-fix)
**Plan:** knowledge-base/plans/m4-skills-discovery-plan.md (plan-confidence SHIPPABLE 96.4)
**Code-quality:** PASS (audit `m4-skills-discovery-code-quality-2026-06-21.md`)

## Method

Two independent FAANG-level reviewers (read-only), in parallel:
- **Agent A — architecture / cross-validation / behavior-preservation / never-throw.**
- **Agent B — test quality / wiring triad / edge-case completeness (ran the tests).**

## Findings adjudicated

| # | Sev | Source | Finding | Resolution |
|---|---|---|---|---|
| 1 | **HIGH** | A | `tests/skills-wiring.test.ts:43-46` failed typecheck (TS18048 — `pkg.exports["./skills"]` is `T \| undefined` under `noUncheckedIndexedAccess`; `expect().toBeDefined()` does not narrow the TS type). Violates Global DoD "zero type errors". | **FIXED** (369b9cc): replaced `toBeDefined()` with an explicit `if (entry === undefined) throw` guard that narrows. `typecheck` now clean. |
| 2 | LOW | B | `skills-subpath.test.ts:49` used `toContain` on the fixture description where `toBe` is achievable. | **FIXED** (369b9cc): tightened to `toBe(...)`. |
| 3 | INFO | B | empty-`SKILL.md` / dir-`SKILL.md` / `name: ../evil` edge cases passed but were uncovered. | **Hardened** (369b9cc): added an empty-`SKILL.md` test locking the `missing_frontmatter` contract on the public surface. (dir-SKILL.md and `name:` metadata confirmed safe by reviewer probes — name is never used as a path; `source` stays in-root; render escapes.) |
| 4 | LOW | A | Wiring test imports the source barrel, not the built dist. | Accepted — plan T2.2 framed it as a barrel test + package.json export assertion; the CJS `require` smoke (T2.1) + `attw` cover dist resolution. |
| 5 | INFO | A,B | knip flags `src/skills.ts` as "unused file". | Pre-existing knip-config gap — `models`/`messages`/`compaction` (shipped subpaths) flagged identically; M4-1 public exports are NOT flagged as orphan. Not a regression. |
| 6 | INFO | A | per-package CHANGELOG not updated. | Root `CHANGELOG.md` carries the entry + changeset present (package CHANGELOG is changeset-generated at release). Rule 6 satisfied. |

## Verdict rationale

Agent B returned READY_TO_MERGE (0 BLOCKER/0 HIGH, 13/13 tests green). Agent A returned NEEDS_FIXES solely on finding #1 (the typecheck HIGH), explicitly stating "Once the test's type narrowing is fixed … this is READY_TO_MERGE." Finding #1 is fixed and verified. Both reviewers independently confirmed: architecture/DIP clean, subpath wired correctly (ESM+CJS), behavior byte-preserved (stderr format + `<skills>` block, golden tests green), never-throw contract holds, wiring triad real.

## Validation (post-fix)

- typecheck: clean (0 errors)
- full sdk suite: **2795 passed / 35 skipped** (no regression vs 2781 baseline; +14 from M4-1 tests + prior)
- biome: clean · attw: 🌟 No problems found (`@theokit/sdk/skills` resolves) · code-quality: PASS
- ADRs D1–D5 all delivered; Coverage Matrix 8/8.

**Verdict:** READY_TO_MERGE
