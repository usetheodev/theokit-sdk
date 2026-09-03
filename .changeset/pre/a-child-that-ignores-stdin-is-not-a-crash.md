---
"@theokit/sdk": patch
---

A hook or lifecycle command that exits without reading its stdin no longer raises an uncaught
`EPIPE` in the SDK's own process.

`spawnAndCollect` writes the JSON payload to the child's stdin. A child that never reads it —
`exit 1`, a hook that only inspects the environment, any command that ignores the payload — closes
the pipe first, and the write then raises `EPIPE` on a stream with no `error` listener, which Node
promotes to an uncaught exception. The child was behaving perfectly legitimately; the host process
took the fault.

The error is swallowed rather than surfaced: the child's exit code and stderr are the result, and
both are collected either way. A payload nobody read is not a failure of the spawn.
