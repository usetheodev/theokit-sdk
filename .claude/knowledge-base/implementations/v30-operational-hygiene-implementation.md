# Implementation — v30-operational-hygiene (V3-0)

**Date:** 2026-06-24 · **Branch:** develop · **Plan:** `knowledge-base/plans/v30-operational-hygiene-plan.md` (v1.1, SHIPPABLE 96.8)

## What shipped

Two operational-hygiene fixes. No production source touched.

| Task | Delta | Verification | Status |
|---|---|---|---|
| T1.1 | `git rm --cached --ignore-unmatch` of 117 tracked `.pyc` (all under `.claude/`); collapsed the duplicated `*.pyc`/`*.pyo`/`*.pyd` `.gitignore` block to a single canonical Python set | `git ls-files \| grep -c '\.pyc$'` → 0; `grep -c '^\*\.pyc$' .gitignore` → 1; working-tree `.pyc` still present + `git check-ignore` resolves; only `.pyc` staged (non-`.pyc` = `.gitignore` only); `packages/sdk/src` diff = 0 | committed (`develop`) |
| T1.2 | `gh api PUT .../actions/permissions/workflow` `can_approve_pull_request_reviews=true` (preserving `default_workflow_permissions=read`) | read-back: `{"default_workflow_permissions":"read","can_approve_pull_request_reviews":true}` | applied (GitHub setting; no repo file) |

## TDD evidence (RED → GREEN)

- T1.1: RED `git ls-files | grep -c '\.pyc$'` = 117 → GREEN = 0. Idempotency (EC-2): the `--ignore-unmatch` form re-runs cleanly at 0. Strict scope (EC-1): only `.pyc` + `.gitignore` staged.
- T1.2: RED `can_approve_pull_request_reviews` = false → GREEN = true (read-back confirmed).

## Wiring triad (infra-adapted)

- **(a) Caller:** the `.gitignore` rule is consumed by git on every status/add; the Actions permission is consumed by `.github/workflows/release.yml` (changesets) at release time.
- **(b) Integration test:** `git check-ignore` confirms the ignore rule binds; the `gh api` read-back confirms the setting persisted.
- **(c) Observability:** `git status` no longer lists tracked `.pyc` (the spurious-diff symptom is gone) — directly observable.

## Honest notes / open items

- **Q1 (org-level shadow):** `gh api /orgs/usetheodev/actions/permissions/workflow` returned 404 (token lacks org-admin read, or no org-level override exists). The repo-level setting took (`true`). The FULL DoD ("the changesets action opens the Version PR by itself") can only be confirmed on the next real release — a maintainer follow-up. The repo setting change is the deliverable and is verified applied.
- No CHANGELOG entry: per the plan, this is repo/CI infra with no published-`@theokit/sdk` surface change; the commit + plan are the record.

## Validation

- `git ls-files | grep -c '\.pyc$'` → 0; `.gitignore` single `*.pyc`.
- `can_approve_pull_request_reviews` → true.
- `pnpm validate` exit 0 (the index cleanup did not regress any gate; regenerated `.pyc` stay untracked + ignored).
