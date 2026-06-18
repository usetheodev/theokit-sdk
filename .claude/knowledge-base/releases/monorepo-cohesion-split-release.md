# Release — monorepo-cohesion-split

**Date:** 2026-06-18
**Verdict:** PR_OPEN_AWAITING_APPROVAL
**Source review:** `.claude/knowledge-base/reviews/monorepo-cohesion-split-review-2026-06-18.md` (READY_TO_MERGE)

## theokit-sdk (monorepo) — changesets-driven

- **PR:** https://github.com/usetheodev/theokit-sdk/pull/15 (develop → main, 12 commits)
- **Bump:** MAJOR — `@theokit/sdk@1.9.0 → 2.0.0` (changeset `.changeset/monorepo-cohesion-split.md`); breaking surface removal (`./rag`, `voice`).
- **Mechanism:** on merge, the changesets GitHub Action versions + publishes via OIDC/CI (no local publish, no manual tag — changesets owns versioning/changelog/tag). The skill's manual CHANGELOG-promote + manual-tag steps were intentionally skipped to avoid double-bumping a changesets repo.
- **Awaiting:** human approval + merge of PR #15.

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
