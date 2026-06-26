# Review — v30-operational-hygiene (V3-0)

**Date:** 2026-06-24 · **Slug:** v30-operational-hygiene
**Commit reviewed:** `chore(hygiene): untrack 117 committed .pyc + dedup .gitignore Python block (V3-0)` on `develop`.
**Review method:** objective verification (deterministic infra change — no code logic; the `pnpm validate` full gate is the comprehensive check a fresh-eyes panel would otherwise re-derive).
**Verdict:** **READY_TO_MERGE** (0 BLOCKER, 0 HIGH, 0 MEDIUM; 1 INFO follow-up).

## Overview
V3-0 (operational hygiene, Esforço S): (1) GitHub Actions could not create the changesets Version PR; (2) 117 `.pyc` bytecode files were tracked, polluting every `git status`. Both fixed: a one-call `gh api` PATCH (repo Actions permission) + `git rm --cached` of the 117 `.pyc` with a `.gitignore` Python-block dedup. No production source touched.

## DoD verification (both items)

| DoD (ROADMAP-v3 § V3-0) | Check | Result |
|---|---|---|
| `git status` lists no tracked `.pyc` | `git ls-files \| grep -c '\.pyc$'` | **0** ✓ |
| Regenerated `.pyc` no longer pollute status | `git status --short \| grep -c '\.pyc$'` after `pnpm validate` ran Python skills | **0** ✓ (the symptom — 20+ ` M …pyc` per status — is gone) |
| `.gitignore` ignores Python bytecode (deduped) | `grep -c '^\*\.pyc$' .gitignore` | **1** ✓ (was 2; collapsed the duplicate `*.pyc`/`*.pyo`/`*.pyd` block) |
| Actions can create PRs | `gh api .../actions/permissions/workflow --jq .can_approve_pull_request_reviews` | **true** ✓ (`default_workflow_permissions` preserved as `read`) |

## Safety verification (no collateral)

- **Strict scope (EC-1):** only `.pyc` paths + `.gitignore` were staged (`git diff --cached --name-only | grep -vcE '\.pyc$'` = 1, the `.gitignore`). Zero non-`.pyc` source removed.
- **No production source touched:** `git diff --name-only -- packages/sdk/src` = 0.
- **Working tree intact:** `git check-ignore` resolves on a sample `.pyc` — the regenerable caches remain on disk, just untracked + ignored. Python regenerates them; zero runtime impact (D1).
- **Idempotent (EC-2):** the `git rm --cached --ignore-unmatch` form re-runs cleanly when 0 `.pyc` remain tracked.
- **Full gate green:** `pnpm validate` exit 0 — build + full test suite (2913 passed) + typecheck + biome + knip + jscpd (0 clones) + publint + attw + bundle budget all pass. The index cleanup regressed nothing.

## Why no multi-agent fresh-eyes panel
Per `cycle-plan`/`cycle-review` proportionality + KISS: this is a deterministic repository/CI-config change with no algorithm, no public-API surface, no logic branch. Every claim is objectively verifiable by a command (above), and `pnpm validate` already exercises the comprehensive gate a panel would re-derive. A 5–7-agent review here is ceremony, not signal. The verification table IS the review.

## INFO — follow-up (not a blocker)
- **Q1 (org-level shadow):** `gh api /orgs/usetheodev/actions/permissions/workflow` → 404 (token lacks org-admin read, or no org-level override). The repo-level setting took (`true`). The FULL DoD confirmation ("the changesets action opens the Version PR by itself") is only observable on the next real `develop→main` release — a maintainer follow-up. The repo setting change is the deliverable and is verified applied; if an org policy shadows it, the maintainer toggles the org-level setting (admin-only).

## Conclusion
Both V3-0 frictions are fixed and objectively verified: tracked `.pyc` 0 (and regenerated ones no longer dirty `git status`), `.gitignore` deduped, Actions PR-creation permission `true`. No production source changed; `pnpm validate` exit 0. **Verdict: READY_TO_MERGE.**

## Loop-closure note
The Actions-PR fix means the next changesets release should open its Version PR automatically (no manual `gh pr create --base main --head changeset-release/main`). The maintainer confirms on the next real release.
