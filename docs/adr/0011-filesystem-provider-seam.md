# ADR 0011 — A dedicated `FilesystemBackend` provider seam (SE31)

- **Status:** Accepted (2026-07-11)
- **Milestone:** SE31 (SDK Evolution — a peer framework Workspaces parity)
- **Relates:** `SandboxBackend` (ADR D1 — execution seam), SE32 (read-before-write safety), the `@theokit/sdk-tools` file factories

## Context

The a peer framework Workspaces comparison surfaced two runtime-legitimate primitives the
SDK lacked: a pluggable *filesystem provider* (Local / S3 / GCS + per-request
resolver) and read-before-write safety (SE32). The `@theokit/sdk-tools` file
factories (`createReadFileTool` / `createWriteFileTool` / …) operate directly on
the local process filesystem via a passed `projectRoot`; there is no provider
abstraction, no `readOnly`, and no per-request root.

The SDK already ships a `SandboxBackend` (ADR D1) — an *execution* seam whose base
class DERIVES `readFile` / `writeFile` / `glob` / `grep` / `listDir` by shelling
out through the one abstract `execute` method (`cat`, `find`, `ls`). The obvious
question the SE31 milestone flagged: **do we need a dedicated filesystem seam, or
can file operations route through the existing `SandboxBackend`?**

## Decision

**Ship a dedicated `FilesystemBackend` abstract class** (`@theokit/sdk/filesystem`),
the storage-side twin of `SandboxBackend`, with four abstract methods
(`readFile` / `writeFile` / `stat` / `list`), an `exists()` derived on the base, a
boundary `basePath`, a `readOnly` flag, typed errors, and a `FilesystemProvider`
resolver type. `LocalFilesystem` is the local implementation. **Do NOT route file
operations through `SandboxBackend`.**

The `@theokit/sdk-tools` file factories accept an OPTIONAL `filesystem` backend
(default = local `projectRoot` — fully back-compatible). This is the backend
*seam*, not a bundled `Workspace` and not a new toolset: bring-your-own-tools
stands, and the bundled `Workspace` class / `mounts`/FUSE / LSP / tool-config
layer remain explicitly out of scope (ROADMAP § Explicitly out of scope).

## Rationale — why NOT route through `SandboxBackend`

1. **A filesystem-only workspace needs no sandbox.** `SandboxBackend`'s file ops
   require command execution (`execute`). a peer framework's "filesystem only" pattern (read
   /write with no shell) cannot be served by a seam whose every operation shells
   out. Forcing a sandbox to read a file couples storage to execution.
2. **SE32 needs a structured `stat().mtimeMs`.** Read-before-write compares the
   file's modification time. Deriving mtime through a shell (`stat -c %Y` on GNU vs
   `stat -f %m` on BSD) is platform-divergent AND racy (the value is parsed from
   stdout, not read atomically). A first-class `stat(): FileStat` on the backend is
   the only clean, portable oracle — impossible to model cleanly on `execute`.
3. **Future providers have no shell at all.** S3 / GCS / in-memory backends cannot
   implement `execute`; they implement the four file methods natively. A seam built
   on `execute` would be un-implementable for exactly the cloud providers that
   motivated the milestone.
4. **Security surface is smaller.** A filesystem backend never interpolates a path
   into a shell command string; boundary enforcement is direct path resolution
   (reusing the core `internal/security/path-guard` primitives — `safePathJoin` +
   `assertNoSymlinkEscape`), with no shell-metacharacter escape hatch.

## Consequences

- **Method set is the CRUD-ish four, not "1 abstract + derived."** Unlike
  `SandboxBackend` (whose Turing-complete `execute` derives everything), a storage
  provider has no single primitive that derives the rest — S3 implements each
  natively. So the abstract set is `readFile` / `writeFile` / `stat` / `list`;
  `exists()` is the only derived helper.
- **`writeFile` carries `expectedMtime` from day one** (SE31 implements the compare
  → `StaleFileError`) so the param is never a latent silently-dropped option; SE32
  adds the tool-layer `requireReadBeforeWrite` tracker on top.
- **Cloud backends (S3/GCS) + `mounts` stay OUT of core** — separate opt-in
  packages or deferred, mirroring how sandbox backends beyond `LocalSandbox` live
  outside core.
- **Boundary reuse, not reinvention** — `LocalFilesystem` reuses the core
  path-guard (Unbreakable Rule 9), remapping `PathTraversalError` →
  `FilesystemSecurityError`.

## Alternatives considered

- **Route file ops through `SandboxBackend`.** Rejected for reasons 1-4 above —
  chiefly the missing structured `stat` (blocks SE32) and un-implementability for
  shell-less cloud providers.
- **Put the seam in `@theokit/sdk-tools`** (next to the consumers). Rejected: the
  seam is a runtime primitive like `SandboxBackend`, which lives in `@theokit/sdk`
  core; keeping the twins together (`./sandbox` + `./filesystem`) is the coherent
  surface. sdk-tools consumes it via the public subpath.
- **Auto-inject a bundled `Workspace`.** Rejected — app/framework glue, not runtime
  (ROADMAP cross-check 2026-07-11 reaffirmed BYO-tools + no-bundled-`Workspace`).
