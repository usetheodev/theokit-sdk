---
"@theokit/sdk": patch
---

`migrateSqliteToLance` now rejects a `batchSize` its loop cannot advance with,
before touching the workspace.

A `0` or a negative made the migration spin forever, calling `addFacts([])` and
logging a progress line every iteration. `NaN` — which `Number("abc")` produces —
made it migrate nothing and report "Validation FAILED. SQLite preserved.",
blaming the migration for a typo. Both now raise a `ConfigurationError` with code
`invalid_batch_size`, naming the value received.
