---
"@theokit/sdk-tools": minor
---

**SE32 — read-before-write safety (`requireReadBeforeWrite` + `ReadTracker`).**

An opt-in guard on `createWriteFileTool` that refuses to blindly overwrite a file the agent has not seen. A per-run `ReadTracker` (exported from `@theokit/sdk-tools`) records each file's mtime when `createReadFileTool` reads it; when `createWriteFileTool` is created with `{ requireReadBeforeWrite: true, readTracker }`, a write is refused with `read_required` if the existing file was never read, or `stale_file` if it changed on disk since it was read. A NEW file writes freely (nothing to clobber). Default OFF — omitting the flag preserves current behavior exactly.

Works on both the local `projectRoot` path and the SE31 `filesystem` backend path (the backend also gets `expectedMtime` forwarded so it re-checks at write time — TOCTOU defense). The tracker is deliberately per-instance, not a global singleton, so state never leaks across runs. `edit_file` already has implicit read-before-write safety via `old_string` content matching, so the guard targets the blind-overwrite path (`write_file`). Mirrors Mastra Workspaces' read-before-write (`FileReadRequiredError` / `StaleFileError`). From the Mastra Workspaces comparison (SDK Evolution roadmap SE32).
