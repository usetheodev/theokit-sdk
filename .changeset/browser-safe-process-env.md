---
"@theokit/sdk": patch
---

Fix `ReferenceError: process is not defined` in the browser, which blanked every page of any app built on `theokit@0.48.x` (usetheokit/theokit#317).

`errors.ts` is imported by the client bindings framework consumers ship to the front end, and it pulls in the redaction and retry modules with it. Two of them read a bare `process.env` — one at module scope, in `internal/security/redact.ts` — so the read threw while the module graph was still evaluating, before a single component rendered. The page went blank with one console error naming no cause.

Environment reads on that path now go through `readEnv()`, which resolves `globalThis.process?.env?.[name]`: unchanged on the server, `undefined` in a browser, and still replaced at build time by bundlers that inline `process.env.X`. Redaction stays **enabled** when the flag cannot be read, since unreadable must mean unset rather than disabled.

`diagFailure` no longer relies on a `try/catch` swallowing the same ReferenceError to reach its fallback.

`tests/security/browser-safe-env.test.ts` walks the import graph reachable from `errors.ts` and fails on any bare `process` in it — a stronger guard than the two modules that happened to break this time.
