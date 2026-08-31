---
"@theokit/sdk-tools": patch
---

Record that the vitest JSON-report contract `run_vitest` depends on was measured across majors 2, 3 and 4, rather than assumed.

The peer range is unbounded (`vitest >=2.0.0`) and the tool shells out to `npx --no-install vitest run --reporter=json`, reading four fields off the report's top level without validation. Nothing imports vitest, so no compiler notices a renamed field — the docblock warned about that risk and nobody had checked it.

Measured 2026-08-31: the same suite under 2.1.9, 3.2.7 and 4.1.11 emits `numTotalTests`, `numPassedTests`, `numFailedTests` and `success`, correctly, every time. Two majors above the declared floor are published and the promise holds.

Documentation only — no behaviour changes. The docblock now states what was checked, and that the observation expires when vitest 5 ships.
