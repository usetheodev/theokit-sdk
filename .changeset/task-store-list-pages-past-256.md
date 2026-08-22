---
"@theokit/sdk": patch
---

`JsonFileTaskStore.list()` no longer hides tasks past the 256th file.

The 256-entry cap was applied to the raw directory listing, before `state`, `kind` and the
`submittedBefore` / `submittedAfter` window were considered — so past 256 task files the visible
set was an arbitrary, readdir-ordered subset, `submittedBefore` narrowed within that subset instead
of paging beyond it, and `evictTerminalOlderThan()` left eligible handles behind however many times
it was called.

The cap is now a bound on concurrent file reads, which is the cost it was meant to control, and
results come back newest-first so `submittedBefore` works as a cursor. Eviction sweeps the whole
directory: one call now means everything eligible is gone.
