---
"@theokit/sdk": patch
---

Remove four unused internal exports surfaced once the dead-code gate stopped
skipping `src/internal/` — `isSqliteVecLoaded`, `listNotes` (with its `NoteFile`
type), `MemoryFileEntry`, and the derived `SpanName` union. None had a caller;
all four lived behind `@internal`, so no public export changes.

Two docblocks corrected in the process. `session-loader` claimed to return
`MemoryFileEntry`-shaped records against a two-field type where the interface had
four, with the path field named differently. `span-names` described the removed
union as the mechanism preventing span-name drift; the `as const` map is what
does that, and emitters read keys off it.

The HITL approval middleware is now documented as not wired — it is constructed
nowhere outside its own test file — with the timeout-versus-denial semantics
pinned by characterization tests. Behaviour unchanged.
