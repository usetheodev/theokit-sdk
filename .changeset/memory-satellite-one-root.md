---
"@theokit/sdk-memory": minor
---

The satellite follows the SDK's single memory-root resolver (#463).

`Memory.runDreamingSweep` routes through this package whenever it is installed, so a satellite that
kept deriving `<cwd>/.theokit/memory` on its own would have reverted `memory.directory` to the
default for exactly the consumers who installed it — the failure this package's own store shim was
written to end, one release later.

Its path helpers now take a resolved `MemoryRoot` like the SDK's: `sessionsDir`, `wikiDir`,
`diaryPath`, `defaultIndexPath`, `lanceStoragePath`, `collectMarkdownFiles`, `discoverSessionFiles`,
`discoverWikiFiles`, `persistActiveMemoryTranscript` and `createMemoryGetTool` (`cwd` → `root`).
`SessionSummaryInput.cwd` becomes `memoryRoot`. `memoryDir` and `memoryWriteDir` are gone from the
re-export; `resolveMemoryRoot`, `projectMemoryDir`, `memoryReadRoots`, `asMemoryRoot` and
`MemoryRoot` replace them. `migrateSqliteToLance` and the Lance index accept the root.

Two more copies of the layout literal were found the same way the SDK's were — by the type error,
not by a search: `index-db.ts` and `lance-index.ts` each spelled `.theokit/memory` out again
instead of calling the shared helper.
