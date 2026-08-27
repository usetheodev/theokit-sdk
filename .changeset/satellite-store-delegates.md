---
"@theokit/sdk-memory": minor
---

Installing this package no longer makes the memory store unreadable.

`Memory.runDreamingSweep` in `@theokit/sdk` replaces its own store with this package's whenever this
package is installed. This package carried a full copy, and the copy stayed on the layout that
predates the file-per-memory format — so it could not read anything the SDK had written. The sweep
reported `factsBefore: 0`, a number indistinguishable from an empty store (#430). Nothing threw.

The store is now imported from `@theokit/sdk/internal/memory-store` rather than copied, which is why
the `@theokit/sdk` peer floor rises to `>=4.60.0`: that is the version the sub-path first ships in,
and importing a path an admitted version does not export is a load-time crash, not a type error.

The exported signatures are supersets of what this package exposed before — the added parameters are
optional — so existing calls are unaffected. What changes is that `appendFactToMarkdown` now writes a
file per memory with `MEMORY.md` as its index, instead of a bullet under `## Facts`. Bullets written
by earlier versions are still read.

The promise this broke — *"the fallback is not a degraded mode"* — now has a test. It had none, which
is why the two copies drifted for two format changes without anything going red.
