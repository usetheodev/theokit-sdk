---
'@theokit/sdk': minor
---

`classifySessionArtifact(name, isDirectory)` — what a file in a project directory is, when this SDK
wrote it.

Four kinds get created here and reasoned about nowhere: `<id>.jsonl` (`transcriptPath`),
`<id>.jsonl.writer.lock` (the writer lease), `<id>.jsonl.lock` (`withFileLock`, a DIRECTORY since it
locks by `mkdir`), and `<file>.<pid>.<hex>.tmp` (`replaceFileAtomic`, left behind by a crash between
the open and the rename). There is no retention, no collector, and there was no way even to ask what
an entry is — so a consumer reclaiming disk had to re-derive the suffixes from this source, and a
suffix changing here would have left its classifier mislabelling files on a path that deletes them.

Deliberately NOT a garbage collector. Retention is policy — how many days, how many to keep, which
session is live, whether to delete at all — and the application is the only one that can answer that.
What belongs here is the half only the SDK can: what did I write, and what is it.

`undefined` means "not written by this SDK", which is the answer that matters most — a caller
deleting what it does not recognise is how someone's editor swap file gets collected. The `temp` case
defers to `atomicWriteTempTarget` rather than matching `.tmp`, for that reason.
