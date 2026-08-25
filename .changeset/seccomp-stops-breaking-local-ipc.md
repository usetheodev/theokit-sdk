---
"@theokit/sdk": patch
---

A confined command that spawns a child no longer loses its output.

The restricted-network seccomp filter denied `getsockname`, `getpeername`, `setsockopt` and
`getsockopt`. Those four take an already-open fd, and cBPF cannot dereference one to learn its
address family — so they were denied on AF_UNIX too, which is what libuv uses for a child's IPC
channel. Any command that spawned a child died, and the parent's buffered stdout died with it:
`node --test` returned zero lines through `shell_exec`, and an agent reading test output saw an
empty string.

The four leave the denied set. Everything that takes an address or changes an fd's role —
`connect`, `bind`, `listen`, `accept`, `accept4`, `sendto`, `sendmmsg`, `recvmmsg`, `shutdown` —
stays denied, and `socket()` still refuses every family but AF_UNIX. Measured across the fix: an
AF_INET socket is `EPERM` before and after.
