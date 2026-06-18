# Release — monorepo-cohesion-split

**Date:** 2026-06-18
**Verdict:** PR_OPEN_AWAITING_APPROVAL
**Source review:** `.claude/knowledge-base/reviews/monorepo-cohesion-split-review-2026-06-18.md` (READY_TO_MERGE)

## theokit-sdk (monorepo) — changesets-driven

- **PR #15 MERGED** (2026-06-18, merge `496c974`) — develop → main, 12 commits.
- **Bump:** MAJOR — `@theokit/sdk@1.9.0 → 2.0.0` (changeset `.changeset/monorepo-cohesion-split.md`); breaking surface removal (`./rag`, `voice`).
- **CI run 27775412350 FAILED** at the changesets action's internal `git push`: the `.githooks/pre-push` hook fired inside CI (`core.hooksPath` set by `prepare`), ran `pnpm validate`, and `sdk-budget#test` failed under CI parallel-contention flakiness (passes 34/34 isolated). `changeset version` itself succeeded; only the hook-gated push failed.
- **Fix — PR #16** (https://github.com/usetheodev/theokit-sdk/pull/16): pre-push hook now skips when `CI=true`/`GITHUB_ACTIONS`. Dev hooks must not gate CI git operations.
- **Awaiting:** merge of PR #16 → `release.yml` re-runs → changesets opens the **Version Packages** PR → merging that publishes `@theokit/sdk@2.0.0` via OIDC.

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
