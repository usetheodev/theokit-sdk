---
"@theokit/sdk-memory": patch
---

The memory index moves with a relocated store — the note this package's consumers never got (#562)

This is documentation, not behaviour. The change shipped in `@theokit/sdk@5.0.0` and is already
live for anyone on that version; what did not ship is any way for a `@theokit/sdk-memory` consumer
to find out. Its `0.5.2` section is empty — no dependency lines, no prose — so the release that
carried a privacy-relevant change reached its most directly affected audience with zero signal.

**Why this package's readers are the audience.** `@theokit/sdk-memory` owns the markdown store and
re-exports `memoryIndexRoot` (`src/internal/store/markdown-store.ts`). Someone reading this
CHANGELOG to decide whether a version is safe to take is exactly the person the note was written
for.

## What changed in the behaviour

`memory.directory` now moves the search index with the store, except into the Claude Code CLI's own
directory (#554).

The index is not a pointer. `chunks.text` holds the fact TEXT — FTS5/BM25 needs it to search — and
`files.path` holds the store's absolute path. **A copy of the index is a copy of the memory,
readable with `strings`.**

Leaving it at `<cwd>/.theokit/memory/.index/` while the facts moved meant an operator who pointed
`directory` at one personal store had that store's contents written into *every repository the
agent ran in*, untracked and un-ignored. Recall worked throughout, so nothing looked wrong; what
was wrong was where the data landed.

```
before   /tmp/my-store/fact.md              facts move
         /any-project/.theokit/memory/.index/memory.sqlite    ← and the content follows here

after    /tmp/my-store/fact.md
         /tmp/my-store/.index/memory.sqlite                   ← one store, one index
```

The Claude Code CLI's directory is unchanged, on its own argument: that CLI has no index format, so
a binary there is an artefact the partner does not understand inside a directory it owns
(`docs/memory-decisions.md` § 1). The fix narrows the behaviour to match that argument rather than
reversing the decision.

## What this does not do

**The `0.5.2` section is not edited.** A published entry is a record of what shipped, and rewriting
it would make the record disagree with the tarball on npm. The note arrives in the next version
instead, which is later than it should have been and is the honest way to be late.

If you are on `0.5.2` the behaviour above is already what you have, through the `@theokit/sdk` you
resolve — this entry only tells you so.
