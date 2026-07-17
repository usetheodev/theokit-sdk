---
user-invocable: false
paths:
  - "**/*persist*"
  - "**/*Persist*"
  - "**/*.jsonl"
  - "**/*sqlite*"
description: TheoKit SDK persistence primitives — atomic writes, JSONL persist/resume, resilient SQLite, cross-process locks
---

# TheoKit Persistence

Durable, crash-safe persistence helpers on the STABLE `@theokit/sdk/persistence`
sub-path. Do NOT import them from `@theokit/sdk/internal/persistence` (semver-exempt).

```ts
import {
  // atomic writes
  replaceFileAtomic, atomicWriteText, atomicWriteJson,
  // jsonl persist/resume
  appendJsonl, loadJsonl, readJsonlIds, JsonlParseError,
  // resilient sqlite
  openSqliteResilient, applyWalWithFallback, isCorruptionError, sanitizeFts5Query,
  // locks
  withFileLock, withCwdMutex,
  // misc
  PersistenceSchema, transcriptPath, encodeProjectDir,
} from "@theokit/sdk/persistence";
```

## Atomic writes

Crash mid-write leaves either the old file intact or the new file complete —
never a half-written file (temp + fsync + rename). `atomicWriteJson` /
`atomicWriteText` auto-`mkdir` the parent dir; `replaceFileAtomic` does not.

```ts
await replaceFileAtomic("/data/config.md", markdown);         // (filePath, content)
await atomicWriteText("/data/notes.txt", text);               // + auto-mkdir
await atomicWriteJson("/data/state.json", { runs: 3 });        // default indent 2, trailing \n
await atomicWriteJson("/data/state.json", data, { indent: 0, trailingNewline: false });
```

## JSONL persist / resume

`appendJsonl` writes one `\n`-terminated line per record (synchronous, interleave-safe
within a process). Resume a crashed batch by reading already-persisted keys.

```ts
appendJsonl("/data/results.jsonl", { id: "task-1", status: "passed" });

// Skip rows already done (partial trailing line tolerated; missing file -> empty set)
const done = readJsonlIds("/data/results.jsonl", (row) =>
  row.status === "passed" ? String(row.id) : undefined,
);

// loadJsonl throws JsonlParseError (with 1-based .line) on a malformed line
const rows = loadJsonl<{ id: string }>("/data/results.jsonl");
```

## Resilient SQLite

`openSqliteResilient` loads the driver, applies WAL (with DELETE fallback), and
recovers from corruption by renaming the file aside. Apply schema in `onOpen`.

```ts
const db = await openSqliteResilient({
  filePath: "/data/index.db",
  label: "memory-index",
  onOpen: (db) => db.exec("CREATE TABLE IF NOT EXISTS docs (id TEXT PRIMARY KEY)"),
});
applyWalWithFallback(db, "memory-index");        // { mode: "wal"|"delete", fellBack }
const q = sanitizeFts5Query("error-code");        // "" means caller must short-circuit
```

## Locks

`withFileLock` takes a cross-process lock (needs the `proper-lockfile` peer dep;
falls back to in-process `withCwdMutex` with a warning). `withCwdMutex` serializes
by key within one process.

```ts
await withFileLock("/data/state.json", async () => { /* exclusive section */ });
await withCwdMutex("migrate-config", async () => { /* in-process critical section */ });
```
