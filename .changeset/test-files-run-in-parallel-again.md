---
"@theokit/sdk": patch
---

The test suite runs its files in parallel again.

It had been pinned to one file at a time, with a comment explaining that the serialisation was holding
back two leaks: tests mutating the home directory environment variable, and a process-wide registry
accumulating entries across tests. Both were fixed elsewhere, and nobody went back to ask whether the
constraint still had a reason. It did not — what actually prevents the home-directory race is that
each file already gets its own subprocess, which is a separate setting and unchanged here.

One genuine coupling had to be removed first: a contract test kept a file-level counter that three of
its cases each expected a specific value from, which only holds if they run in declaration order. Each
case now owns its own identifier, so nothing is shared to race over.

Within-file concurrency stays capped at one, deliberately. The more aggressive configuration —
concurrent cases plus randomised order — remains a separate periodic probe rather than part of the
gate, and a test now pins that split so it cannot drift quietly.
