---
"@theokit/sdk-tools": patch
---

`run_vitest` now reports `no_vitest` when vitest is not installed, as its contract always said.

`npx --no-install` starts, complains on stderr and exits non-zero with nothing on stdout, so the
case reached `unparseable_output` — which reads as "vitest ran and printed something I could not
parse", sending a reader after a reporter or parser problem instead of a missing dependency.
`no_vitest` was reachable only when the `npx` binary itself could not be spawned.

The detection is text matching on npm's complaint, and npm's wording is not a contract: if it ever
changes, the case falls back to the old `unparseable_output` with the real reason in the payload
rather than to a wrong answer.
