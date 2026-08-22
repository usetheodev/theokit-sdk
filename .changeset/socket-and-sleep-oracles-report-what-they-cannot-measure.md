---
"@theokit/sdk": patch
---

Test-harness repairs: an unmeasurable socket probe now reports as skipped instead of passing, and a
fixed sleep is replaced by polling the real value.

The CLOSE_WAIT socket monitor returned a bare `null` when it could not measure — off Linux, or when
`ss` was unavailable — and the caller treated that as a pass. An environment where the probe could
not run was therefore indistinguishable from one where the assertion held. It now returns an explicit
unavailable result with a reason, the caller reports the case as skipped and names that reason, and
the assertion helper refuses an unavailable result rather than quietly doing nothing.

The same test slept a fixed 500ms to let the operating system finish tearing sockets down. The OS
decides that timing, not the test process, so the wait is now a poll against the real count with a
deadline. The threshold moves to the value the harness's own docblock documents; the number at the
call site had never matched it and never explained itself.

A shared polling helper replaces three more fixed sleeps in the semaphore tests, where the queue
depth is a real signal that can be waited on, and absorbs one hand-rolled poll loop that had already
been written by hand elsewhere.

Every change is verified by mutation rather than by construction: mutating the production semaphore's
pending-count turns the converted tests red, and three mutants of the socket monitor each kill the
test named for them.

Honest limit, recorded in the test and tracked separately: the CLOSE_WAIT assertion still cannot
detect a real leak. Removing the driver's own socket cleanup entirely leaves the count at zero,
because Node completes the FIN handshake on its own and the fixture server closes idle sockets. This
change makes the test honest about what it cannot measure; it does not give it detection power.
