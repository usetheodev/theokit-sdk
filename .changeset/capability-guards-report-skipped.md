---
"@theokit/sdk": patch
---

Fifteen tests that quietly reported success on machines missing a native dependency now report as
skipped.

Each was shaped `if (!(await probe())) return;` as the first line of the test body. A guard written
that way returns before any assertion runs, and the runner counts the case as passed — so a machine
without `better-sqlite3`, without the vector stack, or running as root was indistinguishable from one
where every assertion held. The skip was invisible in the count, which is the only place anyone would
have looked.

Measured on the same six guards in one package, forced on:

```
old shape   31 passed,  0 skipped
new shape   25 passed,  6 skipped
```

Across all three packages the conversion moves fifteen cases from a silent pass to a reported skip.

A full triage of every occurrence of this shape was done before changing anything, because the shape
alone does not identify the defect. Of thirty-three occurrences, fifteen were silent skips; the other
eighteen are legitimate and untouched — seven are type narrowings placed immediately after an
assertion that has already reported the failure, and eleven are ordinary control flow inside
callbacks, loops and handlers.
