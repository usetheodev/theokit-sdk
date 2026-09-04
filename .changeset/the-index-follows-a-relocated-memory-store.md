---
"@theokit/sdk": patch
---

**`memory.directory` now moves the search index with the store, except into the Claude Code CLI's own directory** (#554).

The index is not a pointer. `chunks.text` holds the fact TEXT — FTS5/BM25 needs it to search — and `files.path` holds the store's absolute path. So a copy of the index is a copy of the memory, readable with `strings`.

Leaving it at `<cwd>/.theokit/memory/.index/` while the facts moved meant an operator who pointed `directory` at one personal store had that store's contents written into **every repository the agent ran in**, untracked and un-ignored. Recall worked throughout, so nothing looked wrong; what was wrong was where the data landed.

```
before   /tmp/my-store/fact.md              facts move
         /any-project/.theokit/memory/.index/memory.sqlite    ← and the content follows here

after    /tmp/my-store/fact.md
         /tmp/my-store/.index/memory.sqlite                   ← one store, one index
```

## The Claude Code case is unchanged, on its own argument

`docs/memory-decisions.md` § 1 keeps the index in the project store when `directory` names the directory the Claude Code CLI manages: that CLI has no index format, so a binary there is an artefact the partner does not understand inside a directory it owns. That argument reaches **that** directory and no other, and the fix narrows the behaviour to match it rather than reversing the decision. `tests/claude-code-e2e-compat.test.ts` passes unchanged.

`memoryIndexRoot` (`internal/memory/storage/memory-root.ts`) is the single place that decides, using the path-only test `indexBudgetWarning` already relied on — no new heuristic.

## Two things corrected alongside

**The recorded decision said something that had stopped being true.** *"The index is derived data that can be rebuilt from them"* was true of its derivability and false of its contents, and was doing the work of both. § 1 now quotes the schema and dates the narrowed scope.

**A test fixed the behaviour more widely than its own reason supported.** `test_the_index_database_stays_in_the_project_store_even_when_the_facts_move` used a plain `mkdtempSync` tmpdir, not the CLI's directory — so it pinned § 1 for *every* location when § 1 argues for one. That is why the leak stayed invisible: the test read as the decision being enforced. It now covers the plain-directory case, and `tests/memory/index-follows-a-relocated-store.test.ts` pins both halves.
