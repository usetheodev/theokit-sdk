---
slug: v30-operational-hygiene
milestone_id: V3-0
created_at: 2026-06-24
goal: Untrack all 117 committed .pyc bytecode files from theokit-sdk and enable GitHub Actions to create PRs, measured by git ls-files .pyc count returning 0.
---

# Plan: V3-0 — Operational hygiene (infra)

> **Version 1.1** — (absorbs EC-1 strict-scope assertion + EC-2 `--ignore-unmatch` idempotency from the edge-case review; the suspected `-f` MUST-FIX was empirically refuted.)
>
> **Version 1.0** — Two operational frictions V2 exposed: (1) GitHub Actions cannot create PRs in the org, so the changesets action pushes `changeset-release/main` but fails to open the "Version Packages" PR (every release needs the PR opened by hand); (2) 117 `__pycache__/*.pyc` bytecode files are tracked in `theokit-sdk`, producing a spurious diff on every Python run. This plan fixes both: a one-call `gh api` PATCH for (1) and `git rm --cached` + `.gitignore` dedup for (2). No production source changes; pure repository + CI hygiene.

## Goal

> Enable the theokit-sdk repository to keep Python bytecode out of git AND let GitHub Actions open release PRs, measured by `git ls-files | grep -c '\.pyc$'` returning `0` (and the Actions PR-creation permission verified `true`).

## Context

V3-0 of `docs/gap-audit/ROADMAP-v3.md` (Esforço S). Both items are operational debt surfaced during the V2/V3 release work:
1. The changesets release flow (`reference_theokit_changesets_release_flow`) documents that the GitHub Actions changesets job FAILS at "Create Release Pull Request" with `GitHub Actions is not permitted to create or approve pull requests`; today the human opens the Version PR manually (`gh pr create --base main --head changeset-release/main`). The permanent fix is the org/repo Actions setting.
2. The 117 tracked `.pyc` files (confirmed `git ls-files | grep -c '\.pyc$'` = 117, all under `.claude/`) reappear as ` M …cpython-310.pyc` in every `git status` because each Python skill invocation regenerates the bytecode — constant spurious diff noise that pollutes every commit's working tree.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `.gitignore` | (n/a) | `c692f9c` (2026-06-24) | Repo ignore rules; already has `__pycache__/` (L25) + `*.pyc` (L26 AND duplicate L32) + `*.pycache/` (L29) | Keep ignoring `__pycache__/` + `*.pyc`; remove the duplicate `*.pyc` line; do NOT change unrelated rules |
| `.claude/**/__pycache__/*.pyc` (117 files) | (bytecode) | various | Python bytecode caches committed before the ignore rule landed | Working-tree copies stay (Python regenerates); only the git INDEX entries are removed |
| (no production `src/` file is touched) | — | — | — | — |

### Current callers / dependents

- **Symbol/artifact:** the 117 `.pyc` files — they are bytecode caches with **no importer**: Python imports the `.py` source and regenerates `.pyc` on demand into `__pycache__/`. Nothing in the repo reads a tracked `.pyc` (verified: all are under `.claude/skills|scripts/**/__pycache__/`, siblings of their `.py`). Removing them from the index has zero runtime effect.
- **External (public API):** none — this is repo/CI infra, not the `@theokit/sdk` package surface. No `package.json`/`dist/` change; no published-artifact change.
- **CI setting:** the changesets `release.yml` workflow consumes the `can_approve_pull_request_reviews` repo Actions permission (currently `false`).

### Domain glossary

- **`.pyc`** — CPython compiled bytecode cache under `__pycache__/`, regenerated automatically from `.py`; never hand-edited.
- **`git rm --cached`** — removes a path from the git index (untracks) while keeping the working-tree file.
- **changesets Version PR** — the `changeset-release/main` PR the changesets action opens to apply version bumps; blocked today by the Actions PR-creation policy.
- **`can_approve_pull_request_reviews`** — the REST field for the "Allow GitHub Actions to create and approve pull requests" toggle (`/repos/{owner}/{repo}/actions/permissions/workflow`).

### Architecture boundaries affected

None. No layering, no module, no public surface. Repository-management + CI-configuration only.

## Prior Art & Related Work

- **Internal memory (documented decision):** `reference_theokit_changesets_release_flow` — records item 1's failure mode (`GitHub Actions is not permitted to create or approve pull requests`) + the manual workaround + the permanent fix (the Actions setting). `project_v2_2_adoption_reality` notes the tracked-`.pyc` debt.
- **ROADMAP:** `docs/gap-audit/ROADMAP-v3.md § V3-0` declares the exact fixes ("gitignorar + `git rm --cached`"; "Settings → Actions → General → Allow GitHub Actions to create and approve pull requests").
- **External:** GitHub REST API `actions/permissions/workflow` (`can_approve_pull_request_reviews`) — `https://docs.github.com/en/rest/actions/permissions`.
- No code prior-art to discover — this is in-house git + GitHub-API mechanics (discovery is a no-op for this slice; cited prior art above is sufficient).

## Objective

- [ ] Sub-goal 1 — every tracked `.pyc` is removed from the git index (`git ls-files | grep -c '\.pyc$'` → 0); working-tree files remain and stay ignored.
- [ ] Sub-goal 2 — `.gitignore` ignores `__pycache__/` + `*.pyc` with the duplicate `*.pyc` line removed (single authoritative entry).
- [ ] Sub-goal 3 — the repo Actions permission `can_approve_pull_request_reviews` is `true` (PATCH via `gh api`), OR — if the token lacks admin (HTTP 403) — the exact manual step is surfaced to the owner (honest fallback, not a silent skip).

## ADRs

### D1 — Untrack via `git rm --cached` (keep working tree), not `git rm`
- **Decision:** `git rm --cached` the 117 `.pyc` paths; the `.gitignore` (already present) then keeps them out.
- **Rationale:** removes the index entries (stops the spurious diff) without deleting the regenerable caches; zero runtime impact.
- **Alternatives considered:** (a) `git rm` (delete from disk) — REJECTED: pointless churn; Python regenerates them immediately, re-creating untracked files. (b) Leave them tracked + add a pre-commit hook to ignore changes — REJECTED: complexity; the files simply should not be in git.
- **Consequences:** one-time index cleanup; future `.pyc` stay ignored.

### D2 — Fix item 1 via repo-level `gh api` PATCH; fall back to a surfaced manual step on 403
- **Decision:** `gh api --method PUT /repos/usetheodev/theokit-sdk/actions/permissions/workflow` setting `can_approve_pull_request_reviews=true` (preserving `default_workflow_permissions`). If the call returns 403 (no admin), surface the exact Settings path as a manual step for the owner.
- **Rationale:** the REST setting is the documented permanent fix; a one-call PATCH is the smallest correct action. Honest fallback respects the 95% rule (don't claim a fix the token couldn't make).
- **Alternatives considered:** (a) Org-level setting — REJECTED for this slice: narrower repo-level is sufficient + less blast radius (org-level needs org-admin and affects all repos). (b) Grant the workflow a PAT to open PRs — REJECTED: stores a secret + reinvents what the native toggle does.
- **Consequences:** the changesets action can open the Version PR itself; the security note ("Actions can create/approve PRs") is accepted for this single repo's release automation.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `can_approve_pull_request_reviews=true` lets Actions create/approve PRs (GitHub flags as a security consideration) | Low | Scoped to one repo (not org-wide); used only by the trusted changesets release workflow; branch protection on `main` still requires human merge | maintainer |
| Untracking 117 files makes one large index-only commit | Low | The commit is purely deletions of bytecode (no source); reviewable as "remove tracked .pyc"; working tree unchanged | SDK |
| Token may lack repo-admin → PATCH 403 | Medium | Honest fallback: surface the exact manual Settings step (D2); item-2 (.pyc) is fully fixable regardless, so the slice still delivers value | maintainer |

## Unresolved Questions

- Q1 — Is the PR-creation policy enforced at the ORG level (overriding the repo setting)? If so, the repo PATCH succeeds but is shadowed by the org policy; the true fix then requires an org-admin toggle. The implement phase verifies by reading the setting back AND noting that a full DoD confirmation needs a test release (out of this slice's mechanical scope — the setting change is the deliverable; the test-release confirmation is a follow-up the maintainer runs on the next real release).
- Q2 — `(none other — every other decision is resolved at plan time.)`

## Dependency Graph

```
T1.1 (untrack .pyc + gitignore dedup)  ──┐
                                          ├──▶  T2.1 (verify both DoDs)
T1.2 (Actions PR permission PATCH)     ──┘
T1.1 and T1.2 are INDEPENDENT (disjoint surfaces: git index vs GitHub API) — any order.
```

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `gh` CLI | (installed) | tooling | Already used for releases; performs the Actions-permission PATCH. No new dependency. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | — | No dependency added. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

---

## Phase 1: Apply the two fixes

**Objective:** Untrack the bytecode and enable Actions PR creation.

### T1.1 — Untrack the 117 `.pyc` files + dedup `.gitignore`

#### Objective
Remove every tracked `.pyc` from the git index and collapse the duplicate `*.pyc` ignore line to one.

#### Why this step (action + reasoning)
1. **What this step does** — `git rm --cached` the 117 paths and delete the duplicate `*.pyc` `.gitignore` line.
2. **Why it is necessary now** — the tracked bytecode produces a spurious diff on every Python run (Baseline Context — they show as ` M …pyc` in every `git status`), polluting every commit; ADR D1 is the minimal fix. The `.gitignore` already ignores them, so untracking is the only missing step.

#### Evidence
- `git ls-files | grep -c '\.pyc$'` → `117` (all under `.claude/`, verified).
- `.gitignore:26` and `.gitignore:32` both contain `*.pyc` (duplicate); `:25` `__pycache__/`.
- `docs/gap-audit/ROADMAP-v3.md § V3-0` item 2: "gitignorar + `git rm --cached`".

#### Files to edit
```
.gitignore — remove the duplicate `*.pyc` line (keep one)
(git index) — git rm --cached every tracked *.pyc (no working-tree deletion)
```

#### Deep file dependency analysis
- `.gitignore` (Baseline row 1): already ignores `__pycache__/` + `*.pyc`; this task removes the redundant second `*.pyc`. No downstream dependency.
- The 117 `.pyc` (Baseline row 2): no importer; removing index entries is runtime-inert (Python regenerates).

#### Tasks
1. `git rm --cached --ignore-unmatch -- $(git ls-files '*.pyc')` — untrack all bytecode, strictly scoped to `*.pyc`; `--ignore-unmatch` makes a re-run idempotent (EC-2).
2. Edit `.gitignore` to keep a single `*.pyc` entry (remove the duplicate).
3. Confirm working-tree `.pyc` files still exist (untracked, ignored).
4. Assert ONLY `.pyc` paths were staged for removal (EC-1): `git diff --cached --name-only | grep -vcE '\.pyc$'` returns `0`.

#### TDD
```
RED:   `git ls-files | grep -c '\.pyc$'` returns 117 (current state — the "failing" assertion).
GREEN: after `git rm --cached`, `git ls-files | grep -c '\.pyc$'` returns 0.
REFACTOR: `.gitignore` has exactly one `*.pyc` line.
VERIFY: git ls-files | grep -c '\.pyc$'   # expect 0
```

#### Acceptance Criteria
- [ ] `git ls-files | grep -c '\.pyc$'` returns `0`.
- [ ] `grep -c '^\*\.pyc$' .gitignore` returns `1` (duplicate removed).
- [ ] A working-tree `.pyc` still exists on disk and is ignored: `git check-ignore .claude/scripts/__pycache__/check_xrefs.cpython-310.pyc` resolves.
- [ ] No file under `packages/sdk/src/` is modified (`git diff --name-only -- packages/sdk/src | wc -l` returns `0`).
- [ ] Only `.pyc` paths were staged for removal: `git diff --cached --name-only | grep -vcE '\.pyc$'` returns `0` (EC-1 strict scope).
- [ ] The untrack is idempotent: re-running the `git rm --cached --ignore-unmatch` command leaves the tracked `.pyc` count at `0` without error (EC-2).

#### DoD
- [ ] `git ls-files | grep -c '\.pyc$'` returns `0`.
- [ ] `.gitignore` has a single `*.pyc` entry.
- [ ] Working tree `.pyc` files remain (ignored), confirmed by `git check-ignore`.

### T1.2 — Enable GitHub Actions PR creation

#### Objective
Set the repo Actions permission `can_approve_pull_request_reviews=true` (or surface the manual step on 403).

#### Why this step (action + reasoning)
1. **What this step does** — `gh api --method PUT .../actions/permissions/workflow` with `can_approve_pull_request_reviews=true`, preserving `default_workflow_permissions`.
2. **Why it is necessary now** — the changesets release action cannot open the Version PR without it (Context + ADR D2); every release currently needs a manual `gh pr create`.

#### Evidence
- `gh api /repos/usetheodev/theokit-sdk/actions/permissions/workflow` → `{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}` (verified).
- `reference_theokit_changesets_release_flow` memory documents the failure + this fix.

#### Files to edit
```
(no file) — GitHub repo Actions setting via gh api PATCH/PUT
```

#### Deep file dependency analysis
- No repo file changes. The setting is consumed by `.github/workflows/release.yml` (changesets) at release time.

#### Tasks
1. `gh api --method PUT /repos/usetheodev/theokit-sdk/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true`.
2. Read the setting back to confirm `true`.
3. If step 1 returns 403, surface the exact manual step: Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests".

#### TDD
```
RED:   `gh api .../actions/permissions/workflow` shows can_approve_pull_request_reviews=false.
GREEN: after the PUT, the read-back shows can_approve_pull_request_reviews=true.
REFACTOR: None.
VERIFY: gh api /repos/usetheodev/theokit-sdk/actions/permissions/workflow --jq .can_approve_pull_request_reviews   # expect true
```

#### Acceptance Criteria
- [ ] `gh api /repos/usetheodev/theokit-sdk/actions/permissions/workflow --jq .can_approve_pull_request_reviews` returns `true` — OR a 403 was hit and the exact manual Settings step is recorded in the implementation log.
- [ ] `default_workflow_permissions` is unchanged (still `read`).

#### DoD
- [ ] The Actions PR-creation permission reads `true` (or the manual step is surfaced with the exact path on 403).

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | 117 `.pyc` tracked in git (spurious diffs) | T1.1 | `git rm --cached` all 117 |
| 2 | `.gitignore` has a duplicate `*.pyc` line | T1.1 | dedup to a single entry |
| 3 | No production source touched (infra-only) | T1.1 | assert `packages/sdk/src` diff = 0 |
| 4 | GitHub Actions cannot create the Version PR | T1.2 | PATCH `can_approve_pull_request_reviews=true` |
| 5 | Honest handling if the token lacks admin | T1.2 | 403 → surface exact manual step |

**Coverage: 5/5 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed.
- [ ] `git ls-files | grep -c '\.pyc$'` returns `0`.
- [ ] `.gitignore` has a single `*.pyc` entry.
- [ ] `can_approve_pull_request_reviews` reads `true` (or manual step surfaced on 403).
- [ ] `NODE_OPTIONS="--max-old-space-size=8192" pnpm validate` exits `0` (the index cleanup must not break any gate; no production source changed).
- [ ] No file under `packages/sdk/src/` modified.
- [ ] CHANGELOG: not applicable — no published-package change (repo/CI infra only); the change is captured in the commit + this plan.
- [ ] `ROADMAP-v3.md` V3-0 flipped `[x]` in both copies after `/review` READY_TO_MERGE.
- [ ] Plan archived to `knowledge-base/plans/completed/` after PR merge.

## Final Phase: Integration Validation (MANDATORY)

> Runs after Phase 1. The plan is NOT done until validation passes.

### Execution
```
git ls-files | grep -c '\.pyc$'                                              # expect 0
grep -c '^\*\.pyc$' .gitignore                                               # expect 1
git check-ignore .claude/scripts/__pycache__/check_xrefs.cpython-310.pyc     # resolves
gh api /repos/usetheodev/theokit-sdk/actions/permissions/workflow --jq .can_approve_pull_request_reviews  # expect true (or 403 documented)
NODE_OPTIONS="--max-old-space-size=8192" pnpm validate                       # exit 0
```

### Acceptance Criteria
- [ ] Tracked `.pyc` count is 0.
- [ ] `.gitignore` single `*.pyc`.
- [ ] Actions PR-creation permission `true` (or manual step documented).
- [ ] `pnpm validate` exit 0.
- [ ] Zero production source changed.

### If Validation Fails
1. If `pnpm validate` regresses, the only plausible cause is an accidental non-`.pyc` removal — restore via `git restore --staged` and re-run `git rm --cached` scoped strictly to `*.pyc`.
2. Pre-existing failures unrelated to this slice are logged, not fixed here.
