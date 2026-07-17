---
user-invocable: false
paths:
  - "**/*filesystem*"
  - "**/*Filesystem*"
description: TheoKit SDK filesystem seam — FilesystemBackend, LocalFilesystem, boundary-enforced storage with read-before-write safety
---

# TheoKit Filesystem

A pluggable, boundary-enforced file *storage* provider for agent file tools —
the storage-side twin of the sandbox seam. Ship a `FilesystemBackend` (default
`LocalFilesystem`) with an optional `readOnly` flag and a per-request resolver.

```ts
import {
  LocalFilesystem, FilesystemBackend, resolveFilesystem,
} from "@theokit/sdk/filesystem";
import type {
  FilesystemProvider, FilesystemConfig, FileStat, WriteFileOptions,
} from "@theokit/sdk/filesystem";
import {
  FileNotFoundError, FilesystemError,
  FilesystemReadOnlyError, FilesystemSecurityError, StaleFileError,
} from "@theokit/sdk/filesystem";
```

## LocalFilesystem

Boundary-enforced over `node:fs/promises`. Every path resolves within `basePath`;
traversal / symlink escapes are rejected with `FilesystemSecurityError`. NOT an
isolation boundary — run untrusted code inside a container/VM.

```ts
const fs = new LocalFilesystem({ basePath: "/workspace", readOnly: false });

const stat: FileStat = await fs.writeFile("notes.md", "# hello"); // returns FileStat
const text = await fs.readFile("notes.md");
const names = await fs.list(".");            // entry names, not recursive
if (await fs.exists("notes.md")) { /* … */ }
```

## Read-before-write safety (SE32)

`stat().mtimeMs` is the oracle. Pass `expectedMtime` so a concurrent change makes
the write fail with `StaleFileError` instead of silently clobbering.

```ts
const before = await fs.stat("notes.md");
try {
  await fs.writeFile("notes.md", updated, { expectedMtime: before.mtimeMs });
} catch (err) {
  if (err instanceof StaleFileError) { /* someone changed it — re-read + merge */ }
}
```

## Per-request provider (multi-tenant)

A `FilesystemProvider` is a backend OR a resolver `(ctx) => backend` run at
tool-execution time, giving each request its own root. `resolveFilesystem`
collapses either form to a concrete backend.

```ts
const provider: FilesystemProvider<{ tenant: string }> = (ctx) =>
  new LocalFilesystem({ basePath: `/data/${ctx.tenant}` });

const backend = await resolveFilesystem(provider, { tenant: "acme" });
```

## Custom backend

Extend `FilesystemBackend` and implement `readFile` / `writeFile` / `stat` /
`list`; `exists()`, `readOnly`, and `basePath` derive on the base class. Map raw
Node errors to the typed errors above (`FileNotFoundError`, `FilesystemError`).
