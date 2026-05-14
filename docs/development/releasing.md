# Releasing

We use [Changesets](https://github.com/changesets/changesets) for versioning and publishing. The contract: every user-visible change ships with a changeset, and the release pipeline turns those changesets into version bumps + `CHANGELOG.md` entries + npm publishes.

## Adding a changeset

When you make a change that affects users (anything not purely internal):

```bash
pnpm changeset
```

The interactive prompt asks:

1. Which package(s) changed → typically `@usetheo/sdk`.
2. Type of bump → `patch` (bug fix), `minor` (new feature), `major` (breaking change).
3. Summary → one or two sentences describing the change from the user's perspective.

This writes a markdown file to `.changeset/`. Commit it with your PR.

## Anatomy of a changeset

```markdown
---
"@usetheo/sdk": minor
---

Add `Cron` namespace for scheduling agent runs. Supports both local in-process scheduling and cloud (Theo PaaS) scheduling.
```

The frontmatter declares the package and bump type. The body becomes a `CHANGELOG.md` entry.

## What gets versioned

Only packages under `packages/*` are versioned and published. The vendored `referencia/*` projects are explicitly **ignored** in `.changeset/config.json` — they carry upstream lineage and are not part of our publish surface.

## Release pipeline

The release flow has three steps. Steps 1 and 2 typically happen in a "Version Packages" PR; step 3 is the merge of that PR.

### 1. Version

Collapse all `.changeset/*.md` into version bumps and `CHANGELOG.md` entries:

```bash
pnpm version-packages
```

This:

- Reads every changeset.
- Bumps `version` in each affected `package.json`.
- Prepends entries to each affected `CHANGELOG.md`.
- Deletes the consumed changeset files.

Review the diff. Anything wrong? Adjust the changesets and re-run.

### 2. Commit the version bumps

```bash
git add .
git commit -m "chore: version packages"
git push origin <branch>
```

Open a PR ("Version Packages: …") for review.

### 3. Publish

After the version PR merges to `main`:

```bash
pnpm release
```

Which is:

```bash
pnpm build && changeset publish
```

`changeset publish`:

- Runs validation gates first (`publint`, `attw`).
- Publishes each newly-versioned package to npm with `--access public`.
- Tags the git commit with the new version(s).

Push tags:

```bash
git push --follow-tags
```

## Bump semantics

| Bump | When |
| --- | --- |
| `patch` | Bug fix, doc update, internal refactor with no API change |
| `minor` | New feature, additive API change, new public symbol |
| `major` | Breaking change to the public API as defined in `docs.md` |

Until v1.0.0, breaking changes can ship in `minor` releases per semver, but we still call them out clearly in the changeset and `CHANGELOG.md`.

## Pre-releases

For pre-release versions (alpha, beta, rc), enter pre-release mode first:

```bash
pnpm changeset pre enter beta
# … add changesets normally …
pnpm version-packages         # produces 0.x.x-beta.0
pnpm release
# … later …
pnpm changeset pre exit       # back to normal versioning
```

## CI integration (future)

The recommended CI setup uses [`changesets/action`](https://github.com/changesets/action) to automate the "Version Packages" PR. Until that's wired up, the flow is manual.

## What NOT to do

- **Never `npm publish` directly.** Always go through `pnpm release`.
- **Never skip the changeset.** A PR without a changeset is by definition not user-visible — if it IS user-visible, the changeset is non-negotiable.
- **Never edit a published `CHANGELOG.md` entry.** Add a corrective entry in the next release instead.
- **Never publish from a feature branch.** Releases come from `main` after the Version Packages PR merges.

## Next

- [Conventions](./conventions.md) — changelog discipline alongside other rules
- [Setup](./setup.md) — `pnpm validate` is the pre-flight check before `pnpm release`
