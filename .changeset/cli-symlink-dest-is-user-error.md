---
"@theokit/cli": patch
---

`theokit init` now exits 2 for a symlinked destination, not 1.

`theokit --help` publishes `0=success · 1=unknown error · 2=user error`, and a CI job branching on
that pair routed a plain user mistake to the branch that pages someone. Four of the scaffolder's
five coded refusals mapped to 2; `dest_is_symlink` was missing from the hand-written copy of that
list and fell through.

The list now lives with the scaffolder as a typed union, so adding a refusal without deciding its
exit code does not compile.
