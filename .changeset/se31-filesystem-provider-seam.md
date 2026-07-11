---
"@theokit/sdk": minor
"@theokit/sdk-tools": minor
---

**SE31 — `Filesystem` provider seam (`@theokit/sdk/filesystem`).**

A pluggable filesystem *storage* provider, the storage-side twin of `@theokit/sdk/sandbox`. `FilesystemBackend` is an abstract class with four methods (`readFile` / `writeFile` / `stat` / `list`), an `exists()` derived on the base, a boundary `basePath`, a `readOnly` flag, structured `stat().mtimeMs` (the read-before-write oracle for SE32), and typed errors (`FileNotFoundError` / `FilesystemSecurityError` / `FilesystemReadOnlyError` / `StaleFileError`). `LocalFilesystem` is the local-process implementation, boundary-enforced by reusing the core path-guard (traversal + symlink escape → `FilesystemSecurityError`). `FilesystemProvider` + `resolveFilesystem` support a per-request resolver `(ctx) => FilesystemBackend` for multi-tenant roots.

Unlike `SandboxBackend` (whose file ops shell out via `execute`, require command execution, and give no structured `stat`), a `FilesystemBackend` serves a filesystem-only workspace with no sandbox — see ADR 0011 for why file ops are NOT routed through `SandboxBackend`. `@theokit/sdk-tools`' `createWriteFileTool` now accepts an optional `filesystem` backend (writes route through it; omitted ⇒ identical local-`projectRoot` behavior). This is the backend seam, NOT a bundled `Workspace` and NOT a new toolset — bring-your-own-tools stands; `mounts`/FUSE, S3/GCS, and LSP remain out of core. From the a peer framework Workspaces comparison (SDK Evolution roadmap SE31).
