---
"@theokit/sdk": patch
---

The Lance memory backend now honours `SearchOptions.vectorWeight` and
`textWeight`. It blended hits with hard-coded 0.7 / 0.3 literals and never read
the options, so a caller that tuned the weights had its tuning applied on the
SQLite backend and silently dropped on Lance.

Unweighted Lance results shift slightly as a consequence: the shared defaults are
0.6 / 0.4, and one of the two hard-coded numbers was never the contract's.

Workflow step logging (`ctx.log.debug` / `.info` / `.warn`) now goes through the
SDK's diagnostics channel instead of `console`, so a host that installs a
diagnostics sink — a TUI, for instance — receives it instead of having its frame
written over.
