# Component Map — `internal/persistence/` (BASELINE 2026-05-25)

12 files of cross-cutting state primitives (ADR D59).

| File | Purpose | Used by |
|---|---|---|
| `atomic-write.ts` | `replaceFileAtomic` write-rename | agent-registry-store, conversation compact |
| `cwd-mutex.ts` | In-process per-cwd mutex | credential pool |
| `exclusive-create.ts` | O_EXCL create (D82) | various |
| `file-lock.ts` | Cross-process lock (D61, optional `proper-lockfile`) | various |
| `fts5-sanitize.ts` | SQLite FTS5 sanitizer (D64) | memory adapters |
| `index.ts` | Barrel | — |
| `markdown-config-loader.ts` | YAML frontmatter loaders (D74) | skills, personality |
| `paths.ts` | `getTheokitHome` (D60) | many |
| `schema-version.ts` | SQLite user_version (D62) | sqlite users |
| `sqlite-cas.ts` | Compare-and-swap (D83) | credential pool |
| `sqlite-wal.ts` | WAL mode (D63) | sqlite users |

## What Phase 1 adds here

- `conversation-storage-fs.ts` — class adapter wrapping `agent-session-store.ts` functions
- `conversation-storage-memory.ts` — in-memory adapter
