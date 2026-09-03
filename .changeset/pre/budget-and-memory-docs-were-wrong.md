---
"@theokit/sdk": patch
---

Corrected the published JSDoc for `AgentOptions.budgetTracker` and `AgentOptions.memoryProvider`,
which told consumers the opposite of what the SDK does.

Both carried a paragraph stating the option was "wired to the type surface only" and that a consumer
supplying one "gets the type guarantee but NOT runtime enforcement". Neither has been true for some
time. `budgetTracker` is read by the agent loop before every iteration (`evaluateBudgetGate`),
advanced with `nextIteration()`, and charged with `track(...)` after each completion.
`memoryProvider` has its full lifecycle driven — `init`, `buildTools`, `runActivePass`, `sync`,
`dispose`.

No behaviour changes here; the code was already correct. What changes is what the published `.d.ts`
tells you, and it was wrong in the expensive direction: a consumer reading it was told the SDK would
not enforce their cost ceiling, so the rational response was to build a second control outside the
SDK, or to stop passing the option at all.

Six occurrences of the claim were corrected across `types/agent.ts`, `index.ts` and the loop's own
input types, and a lint now requires any "not implemented yet" note to carry a tracking reference and
a date, so the next one expires instead of outliving the work it describes.
