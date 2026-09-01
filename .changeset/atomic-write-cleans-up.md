---
"@theokit/sdk": patch
---

A failed atomic write no longer leaves its temp file behind.

`replaceFileAtomic` — which backs the agent registry, session transcripts, MCP token storage and
everything else the SDK persists — cleaned up its `.tmp` on a rename failure and on no other. A
failure between the open and the rename, meaning a write error, a full disk, or an fsync failure,
closed the file handle and propagated with the temp still on disk.

Every failure after the open now removes it. A process killed mid-write still leaves one, which no
code inside that process can prevent; `sweepStaleAtomicTemps` reaps those on the next registry load.
