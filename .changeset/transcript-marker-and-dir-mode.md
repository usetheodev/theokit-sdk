---
"@theokit/sdk": minor
---

Two fixes on the transcript persistence path.

`readJsonlTail`'s `sinceMarker` matched the marker as a substring of the raw line, so a
transcript entry whose own text contained the marker word truncated the read there. The
caller asks for everything after the last compaction and silently got less. The marker is
now matched as a record FIELD (`subtype`, then `type`), which is what it always meant.

`appendJsonl` created the transcript directory with the umask, so under `umask 002` it was
born `0775` — group-writable — while the file inside it was carefully pinned to `0600`. A
private file in a directory others can write can be replaced wholesale. The directory is now
created `0700`, matching the file, and matching what `assertSecureModes` demands of the
shared `~/.theokit` tree.
