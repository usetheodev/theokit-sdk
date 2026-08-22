---
"@theokit/sdk": patch
---

Breaking out of a subscription now closes the underlying connection instead of leaving it open.

`Theokit.subscribe`'s SSE transport released its stream reader on exit but never cancelled it. Per
the Streams specification those are different operations: releasing detaches the reader and leaves
the stream — and therefore the `fetch` response and its socket — open until something else cancels it
or reads it to completion. So the ordinary consumer shape, breaking out of the loop early, left a
connection dangling every time. The WebSocket transport already closed its socket correctly; only the
SSE half was affected.

The reader is now cancelled on early exit, best-effort and skipped on natural completion, where the
stream is already finished and cancelling would only risk surfacing a spurious rejection.

This is the leak a load test in this repo has claimed to detect for some time and never could. That
test drove raw sockets with no SDK code in the path at all, and passed whether or not anything
cleaned up — measured by deleting its own cleanup call and watching the count stay at zero, twice.
Its claim is now withdrawn in the test itself and in that directory's README, and the real property
is asserted where the code actually lives: a test that drives the SSE and WebSocket transports
through injected mocks, with no network and no operating-system probing, and that fails when either
transport stops cleaning up.

Also included: the plugin manager's seven manifest-validation errors now each have a test asserting
the specific error class, code and message, plus cases each guard must accept — a guard tested only
on what it rejects cannot be told apart from one that rejects everything.
