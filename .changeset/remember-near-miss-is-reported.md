---
"@theokit/sdk": patch
---

A `Remember` phrase that stores nothing now says so, instead of looking exactly like success.

`persistMemoryFactIfWritePrompt` had three early returns and a diagnostic on none of them. A phrase
one token from the supported one — `Remember, please:`, `Remember that:`, `Please remember:` — was
answered normally and stored nothing, and the caller could only find out by listing the store
afterwards. The transcript indexer made it worse: the sentence still lands in `sessions/run-*.md` and
is indexed, so a follow-up question comes back with the right answer and the developer concludes
memory is on. What they have is full-text search over transcripts — no `MEMORY.md`, nothing to
commit, nothing a human can edit, nothing that survives transcript pruning.

The gate is unchanged and deliberately so: a heuristic over user text must not capture aggressively,
or an ordinary sentence about remembering becomes a durable fact. What was missing was the signal.

Three paths now report, all through `diagFailure` rather than `diag`, because the user asked for
something durable and did not get it — and `diag` is dropped entirely when the host installed no
sink (`#189`):

- a message that opens with the capture verb and does not match the pattern;
- a match with nothing after the colon;
- the write itself failing, which went through `safeCall` and disappeared with it. The swallow
  stays — one unwritable memory must not abort the turn — but it no longer happens in silence.

The supported forms in the message are interpolated from `MEMORY_KINDS`, never spelled out. The
reported defect is the accepted vocabulary widening between 4.56.0 and 4.57.0 with nothing announcing
it; a hand-written list in the warning could go stale exactly the same way, one layer up from the bug
it explains.
