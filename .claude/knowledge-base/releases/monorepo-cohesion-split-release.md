# Release — monorepo-cohesion-split

**Date:** 2026-06-18
**Verdict:** RELEASED ✅ — `@theokit/sdk@2.0.0` published to npm (`latest`).
**Source review:** `.claude/knowledge-base/reviews/monorepo-cohesion-split-review-2026-06-18.md` (READY_TO_MERGE)

## Final outcome

`release.yml` run **27777702804 succeeded** (after PR #17 merge). `npm view @theokit/sdk version` → **2.0.0**. Published Harness set: `@theokit/sdk@2.0.0`, `sdk-cache/tools/memory/budget/handoff@0.1.0` (unchanged — peer `>=1.7.0` still satisfied by 2.0.0, no needless cascade), `acp/cli/memory-honcho/mem0/supermemory@1.0.0`.

Path to release (4 merges): PR #15 (split) → CI failed on pre-push hook running flaky tests → PR #16 (hook CI-skip) → CI pushed Version branch but failed to auto-open PR (GH Actions PR-create permission disabled) → PR #17 (Version Packages, opened manually) → **published**.

## theokit-sdk (monorepo) — changesets-driven

- **PR #15 MERGED** (2026-06-18, merge `496c974`) — develop → main, 12 commits.
- **Bump:** MAJOR — `@theokit/sdk@1.9.0 → 2.0.0` (changeset `.changeset/monorepo-cohesion-split.md`); breaking surface removal (`./rag`, `voice`).
- **CI run 27775412350 FAILED** at the changesets action's internal `git push`: the `.githooks/pre-push` hook fired inside CI (`core.hooksPath` set by `prepare`), ran `pnpm validate`, and `sdk-budget#test` failed under CI parallel-contention flakiness (passes 34/34 isolated). `changeset version` itself succeeded; only the hook-gated push failed.
- **Fix — PR #16 MERGED**: pre-push hook now skips when `CI=true`/`GITHUB_ACTIONS`. **Worked** — the run 27777283666 log shows "pre-push: CI detected — skipping" and the `changeset-release/main` branch (sdk@2.0.0, changeset consumed, 22 files) pushed successfully.
- **CI run 27777283666 FAILED at the LAST step only:** `GitHub Actions is not permitted to create or approve pull requests` — the repo setting **Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests" is DISABLED**. `changeset version` + push succeeded; only the auto-PR-open failed.
- **Version PR #17** (https://github.com/usetheodev/theokit-sdk/pull/17): opened MANUALLY from the bot's `changeset-release/main` branch (bypasses the disabled setting). Bumps `@theokit/sdk → 2.0.0` + dependents.
- **Awaiting:** merge of PR #17 → `release.yml` re-runs with no changesets → `pnpm changeset publish` → **`@theokit/sdk@2.0.0` published to npm**.
- **Recommended:** enable the "Allow GitHub Actions to create and approve pull requests" setting so future releases auto-open the Version PR.

## Extracted repos (existing on GitHub) — pushed to `develop`, NOT released

| Repo | Action | Publish? |
|---|---|---|
| `theokit-gateways` | remote set + pushed `develop` | NO — `release.yml` triggers on push to `main`; `main` not pushed. |
| `theokit-react` | remote set + pushed `develop` | NO — same. |

Each will release independently when its `main` is cut (user decision). Their CHANGELOGs already carry the extraction entry.

## Extracted repos NOT yet on GitHub (local folders only)

`theokit-backend-dx`, `theokit-rag`, `theokit-voice`, `theokit-skills-google-workspace` — created locally with preserved history + `origin` stripped (EC-1). The user creates the GitHub repos, then `git remote add origin … && git push origin develop`.

## Next

1. Approve + merge PR #15 → changesets CI publishes `@theokit/sdk@2.0.0`.
2. (Optional) cut `main` on `theokit-gateways` / `theokit-react` to release them.
3. Create the 4 remaining GitHub repos + push.
