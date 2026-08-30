---
"@theokit/sdk": minor
---

**BREAKING (narrow):** `local.sessionDir` no longer decides where memory is written. Use the new
`memory.directory` option. Facts already recorded are not moved and stay readable — the Claude Code
store is a read root unconditionally — so a consumer who relied on the old coupling gets their new
facts in the project store until they set `memory.directory`.

Memory now has ONE answer to "where does this agent's memory live?", and every path derives from it.

Fourteen places computed a memory path from `cwd`, and one of them computed a different one.
`appendFact` relocated when `local.sessionDir` was set; the indexer, the `memory_get` path guard,
`MEMORY.md`, `sessions/`, `notes/`, `wiki/`, the dream diary and the index database did not — the
last of those spelled the default layout out again as a string literal, so no search for the shared
helper would have found it. A relocated fact was therefore written, never indexed, unreadable by the
tool whose job is reading memory, and shadowed by a second `MEMORY.md` in the store it had left.

- **New `memory.directory`.** Absolute or `~/`-prefixed. Point it at
  `~/.claude/projects/<encoded-cwd>/memory` to write where the Claude Code CLI reads. A relative
  value is refused with `invalid_memory_directory` rather than resolved: the workspace and the
  process cwd are both plausible bases, and picking one silently is how a store ends up split
  across both.
- **One resolver.** `resolveMemoryRoot` is the only producer of a root, and it returns a branded
  `MemoryRoot` that every path helper now requires. The brand is STRUCTURAL rather than a
  `unique symbol`: the d.ts bundler inlines a `unique symbol` declaration into every package that
  re-exports it, so `@theokit/sdk-memory` ended up with a `MemoryRoot` its own compiler rejected
  against the SDK's, on values that were the same string. A structural tag refuses a bare `string`
  exactly as well and survives the package boundary. A cwd and a root are both strings, so the brand
  is what makes "every path derives from one resolution" a compiler rule instead of a convention —
  and it is what surfaced the three call sites that were silently reading the wrong directory.
- **`local.sessionDir` means one thing again:** where session transcripts go.
- **Unchanged:** WRITE ONE, READ ALL. Recall still covers the configured root, the project store and
  the CLI's store, so relocating the write orphans nothing.

Everything under the root follows it: `MEMORY.md`, the per-memory files, `notes/`, `sessions/`,
`wiki/`, `transcripts/`, `dream-diary.md`, `.index/memory.sqlite` and the Lance store. Two of those
were found by the brand rather than by reading — `index-db.ts` and `lance-index.ts` each spelled
`.theokit/memory` out again as a string literal, so no search for the shared helper would have
reached them.

`Memory.runDreamingSweep` and the SQLite→Lance migration take a `directory` for the same reason: a
sweep that consolidated notes into the default store while the facts lived elsewhere would be the
same defect one function over.

`internal/memory/storage` (semver-exempt sub-path) drops `memoryDir` and `memoryWriteDir` and gains
`resolveMemoryRoot`, `projectMemoryDir`, `memoryReadRoots`, `asMemoryRoot` and `MemoryRoot`.
`RecordSessionSummaryArgs` gains a required `memoryRoot`, supplied by the kernel — an implementor
consumes those args and never constructs them.

**The `MEMORY.md` budget is a statement about the interop partner, and only that.** The Claude Code
CLI loads the first 200 lines / 25 KB of an index into every session and drops the rest in silence.
This SDK never loads the index at all — the `<memory>` block is built from the per-memory FILES,
ranked and capped — so our recall does not degrade as the index grows. `indexBudgetWarning` therefore
speaks ONLY when `memory.directory` points at the store the CLI reads, says what is true (the CLI
drops entries) rather than what is not (memory stops working), and never throws: the fact file and
the index rewrite are one atomic operation, so refusing the second would lose the first.

One path deliberately does NOT follow the option: `legacyMemoryJsonPath`, which locates the
pre-#389 JSON store. That store was written before the option existed, so pointing it at a
configured root would look for a legacy file where a legacy file cannot be.
