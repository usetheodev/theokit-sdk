---
"@theokit/sdk": minor
---

The markdown memory store is now importable by `@theokit/sdk-memory` instead of copied into it.

`@theokit/sdk-memory` carries its own copy of the store, and `Memory.runDreamingSweep` replaces this
implementation with the peer's whenever the peer is installed — so the copy that runs is not the copy
anyone maintains. It stayed on the layout that predates the file-per-memory format, which means
installing `@theokit/sdk-memory` today makes every memory this SDK has written unreadable. Nothing
throws: the sweep reports `factsBefore: 0`, a number indistinguishable from an empty store (#430).

This release ships the half that has to exist first — the `@theokit/sdk/internal/memory-store`
sub-path, semver-exempt like `internal/persistence` and `internal/memory-adapters`. The satellite
cannot declare a floor on a version that is not published yet, so its delegation follows in the next
release rather than riding along with a floor nobody can install.

theokit#160 fixed this exact shape for the embedding runtime, in this same package pair. Re-syncing a
copy fixes today's divergence and leaves tomorrow's free to happen.
