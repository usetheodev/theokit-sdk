# Changesets

In-flight changesets for `@usetheo/sdk` and other workspace packages.

## Quickstart

```bash
pnpm changeset            # create a new changeset for your change
pnpm version-packages     # bump versions, collapse changesets into CHANGELOG.md
pnpm release              # build and publish to npm
```

## What gets versioned

Only packages under `packages/*` are versioned and published. The vendored `pi/packages/*` (`@earendil-works/*`) are ignored — they carry upstream lineage and are not part of our publish surface.

## Changeset format

Each changeset is a markdown file with frontmatter:

```markdown
---
"@usetheo/sdk": minor
---

Short description of the user-visible change.
```

See [intro to changesets](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md) for the full format.
