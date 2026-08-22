---
"@theokit/sdk": patch
---

Remove three unused error classes from the internal iteration-budget module
(`IterationBudgetExhaustedError`, `CompressionExhaustedError`,
`CompressionIneffectiveError`). They were never thrown: the budget reports
exhaustion by return value (`recordCompression()` answers
`{ allowed: false, reason }`), which is the shape the agent loop actually reads.
They were left over from an earlier exception-based design and advertised a
contract the module does not honour. No public export changes — all three lived
behind `@internal`.
