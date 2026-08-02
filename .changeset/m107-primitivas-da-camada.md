---
"@theokit/sdk": minor
---

M107 — three additive persistence/registry primitives, plus one concurrency fix.

- `atomicWriteJson` (and `replaceFileAtomic`) accept `{ mode?, exclusive? }`. Omitting them keeps
  today's behaviour byte for byte, including the mode on disk: the mode passed to `open` is filtered
  by the `umask`, so the file is `0o600` under `umask 002`/`022` and `0o400` under `umask 0200`, and
  that is preserved. When you DO pass `mode`, it is reasserted on the descriptor before the rename,
  so the `umask` cannot silently drop a bit you asked for. `exclusive: true` creates the temporary
  with `wx`, turning a leftover temporary into `EEXIST` instead of a silent truncation.

- **Behaviour change on disk:** `forkTranscript` now creates the destination with mode `0o600` by
  default (`mode?` overrides it). Previously no mode was passed at all, so a forked transcript was
  born `0o666 & ~umask` — measured `0o664` (group-writable) on a `umask 002` machine and `0o644` on
  `umask 022`. A transcript holds the conversation, so this is a privacy fix, not a tidy-up. It is
  announced as a behaviour change rather than a silent patch because the change is visible to
  anything that read those files as another user or group. The direction is restrictive only.

- `Agent.list` now READS the `cwd` its type has always advertised. `Agent.list({ runtime: "local",
  cwd })` previously compiled and was silently ignored — it hydrated the process directory and
  returned every agent in memory. Listing is now scoped to the requested workspace, using the same
  "which project owns this entry" rule the persistence layer uses to route it to disk (an entry with
  no `cwd` belongs to the process directory). Calls without `cwd` keep listing the process
  directory. `limit`/`cursor` are still not implemented: a `limit` without a `nextCursor` would be
  silent truncation.

- **Fix:** two concurrent first-time hydrations of the same workspace could make the second caller
  see an empty registry. The hydration guard marked the directory as loaded before awaiting the disk
  read, so the second call returned early. It now awaits the same in-flight read, and a failed
  hydration is no longer memoised as successful.

`AtomicWriteJsonOptions` gained optional fields and `replaceFileAtomic` gained an optional third
parameter; both are additive and every existing call site compiles unchanged.
