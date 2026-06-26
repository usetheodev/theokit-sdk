# Edge Case Review — v30-operational-hygiene

Date: 2026-06-24
Tasks analyzed: 2 (T1.1 untrack .pyc + gitignore dedup, T1.2 Actions PR permission)
Edge cases found: 4 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 2)

Boundaries: T1.1 mutates the git INDEX (no working-tree deletion, no source); T1.2 calls the GitHub REST API. No runtime code path, no concurrency, no I/O beyond git + gh.

## MUST FIX

(none.)

Notably, the `git rm --cached` on working-tree-modified `.pyc` was a suspected footgun (20 of 117 show ` M`). **Empirically refuted**: `git rm --cached --dry-run` on a modified `.pyc` returns exit 0 with no error — `--cached` tolerates working-tree-only modifications (it only refuses on index-vs-HEAD divergence, which these do not have). No `-f` needed. The plan command is correct as written.

## SHOULD TEST

### EC-1: removal must be strictly scoped to `*.pyc`
- **Affected task:** T1.1
- **Family:** State
- **Suggested test:** assert `git diff --cached --name-only | grep -vcE '\.pyc$'` returns `0` after the staged removal (i.e. ONLY `.pyc` paths were unstaged) — already partially covered by the "no `packages/sdk/src` modified" acceptance criterion; widen to "no non-`.pyc` path staged".

### EC-2: empty/edge glob robustness
- **Affected task:** T1.1
- **Family:** Input
- **Suggested test:** use `git rm --cached --ignore-unmatch -- $(git ls-files '*.pyc')` so a re-run (when 0 `.pyc` remain tracked) is idempotent and never errors. Pin idempotency: running the untrack twice leaves count at 0 without failure.

## DOCUMENT

### EC-3: regenerated `.pyc` reappear as untracked-but-ignored after `pnpm validate`
- **Accepted risk:** `pnpm validate` runs Python skills that regenerate `__pycache__/*.pyc`. Post-untrack these are untracked AND ignored (`.gitignore`), so `git status` stays clean of them. Expected, not a regression — this is exactly the fix's goal.

### EC-4: org-level policy may shadow the repo setting (Q1)
- **Accepted risk:** if the org enforces "Allow Actions to create PRs = off", the repo-level PATCH succeeds but is overridden. The implement phase reads the value back; a full DoD confirmation (Actions actually opening a Version PR) only happens on the next real release. Setting the repo value is the deliverable; the test-release confirmation is a maintainer follow-up. Already captured as plan Q1.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 3 | 0 | 2 (EC-1, EC-2) | 1 (EC-3) |
| T1.2 | 1 | 0 | 0 | 1 (EC-4) |

**Verdict:** PLAN OK

The plan is correctly scoped for an infra-hygiene slice. The one suspected MUST-FIX (`-f` on modified `.pyc`) was empirically refuted. The 2 SHOULD-TEST items harden the untrack (strict-scope + idempotency) and fold into T1.1's existing assertions; the 2 DOCUMENT items record expected post-conditions already reflected in Q1. Proceed to `/plan-confidence`.
