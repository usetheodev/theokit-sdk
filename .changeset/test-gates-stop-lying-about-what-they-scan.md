---
"@theokit/sdk": patch
---

Repairs four quality gates that were measuring something other than what they claimed.

**The Portuguese-language lint no longer scans files git does not track.** It walked the tree with
`readdir` and skipped only dot-directories, so it flagged untracked files CI never sees — going red
on a developer's machine while CI stayed green — and simultaneously missed `.github/workflows/`,
which CI very much does have. A red that CI cannot reproduce is what teaches people to reach for
`--no-verify`. The scan is now driven by `git ls-files`, which fixes both halves at once: untracked
files disappear by construction, and tracked dot-directories come into scope. Portuguese text the
lint could not previously see in the CI workflow is translated as part of the change.

**The pre-push Biome gate has the same repair.** `biome check .` walked everything on disk;
`biome.json`'s `vcs.useIgnoreFile` skips gitignored files but not untracked-but-unignored ones, which
is exactly the class that broke the gate. Measured: the tracked-only scan and the walk-everything
scan process the same 1686 files on a clean tree, so scoping to tracked files costs no coverage.

**The pre-commit typecheck no longer typechecks all fifteen packages on every commit.** It is scoped
to the packages the diff actually touches, with a guard the item this came from insisted on: the run
reports how many packages it selected, and a selection of zero fails loudly instead of exiting 0.
That silent-zero case is real — a stale or unfetched ref makes the scoped filter select nothing while
turbo reports success — and swapping an expensive honest gate for a cheap silent one would have
reproduced the defect being repaired. The full unscoped verdict still runs at pre-push and in CI.

**Dead Vitest 4 settings are removed rather than migrated.** The config carried a `poolOptions` block
that Vitest 4 no longer reads, printing a deprecation warning on every run. Migrating those keys
would not have revived the knob they configured: `fileParallelism: false` overwrites the worker count
unconditionally, so the `SDK_TEST_MAX_FORKS` environment variable was inert by two independent paths.
The block and the variable are deleted, `fileParallelism: false` is kept (test-order safety currently
depends on it), and Vitest 4's actual replacement for the isolation setting is declared explicitly.
