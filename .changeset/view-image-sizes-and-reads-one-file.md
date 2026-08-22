---
"@theokit/sdk-tools": patch
---

`view_image` checked a file's size with one path lookup and read its bytes with another. Between
the two, the path could resolve to something else — so the size cap, which is the only thing
keeping an unbudgeted image out of an LLM's context, described a file that was not the one
returned.

It now opens the file once and both sizes and reads through that descriptor. A descriptor cannot
be swapped, so the two operations describe the same file by construction rather than by a check
that can be outrun.

The descriptor is closed on every path, including the early return when the image is over the cap.
