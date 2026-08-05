---
"@theokit/sdk": minor
---

Every SDK diagnostic now goes through the interceptable channel (theokit#147).

`setDiagnosticsSink` let a TUI host keep the SDK's warnings out of its alternate screen, but the
original migration only covered `internal/`. Six sites in the package's own modules — `batch.ts`,
`event-bus.ts`, `compaction.ts` and the Workflow branch step — still wrote straight to
`process.stderr` / `console.warn`, so a host could install a sink and still have its frame corrupted
by a batch run or a failed summarizer. Those are routed through the channel, and a lint gate now
fails the build if a new direct write appears in `src/`.

The remaining allowlisted writers are seams whose destination the caller already chooses
(`opts.warn`, `opts.logger`, the Workflow logger), each listed with its reason.

`setDiagnosticsSink` is now exported from the package barrel. It previously existed only on an
internal path no consumer could import, so the channel these six fixes route into could not actually
be installed by a host — the reported blocker survived a green suite.

**Diagnostics are now silent by default.** With no sink installed the SDK writes nothing to the
terminal — a library does not own the host's screen. Installing a sink is how you see them:

```ts
import { setDiagnosticsSink } from "@theokit/sdk";
setDiagnosticsSink((message) => myLogger.warn(message));
```

This is a behaviour change for anyone who relied on reading SDK warnings from stderr. Restore the
old behaviour in one line: `setDiagnosticsSink((m) => process.stderr.write(m))`.
