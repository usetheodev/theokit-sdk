---
"@theokit/sdk-tools": patch
---

When a tool's output exceeds its budget, the full untruncated output is written to an overflow
file. That file's name was `overflow-<timestamp>-<8 hex characters>.txt`: eight characters is 32
bits, and the rest of the name is a clock reading anyone can predict. The write itself followed
symlinks, so a guessed name planted ahead of time would have received the content — and by
construction that content is the largest thing the tool produced.

The name now carries a full UUID, and the file is created exclusively (`O_CREAT|O_EXCL`), which
POSIX requires to fail when the path already exists, symlinks included. There is no longer a window
between deciding a path is safe and writing to it.

No behaviour changes for any caller: the overflow path is still returned in the truncation trailer,
and it is still unique per truncation.
