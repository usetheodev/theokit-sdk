---
"@theokit/sdk": patch
---

An unrecognised key under `local` is now reported on the diagnostics channel instead of being
accepted in silence.

Measured before this: `Agent.create({ local: { compatSourcess: [...] } })` — one letter wrong —
created the agent with no throw, no warning, and nothing anywhere. That made two very different
failures identical: a typo and an SDK too old to know the option both produced the default
behaviour and no complaint.

It is the reason `usetheokit/theokit#634` is blocked rather than merely unimplemented — a forward
of `compatSources` written against a published SDK would be inert, and no consumer could tell.
The same shape produced the `$CLAUDE_PROJECT_DIR` defect and motivated the `compatSources` opt-in:
a surface that accepts input and does nothing with it, where the absence of a complaint reads as
acceptance.

The message names the key and the nearest known one, so one letter wrong is one line to read
rather than a trip to the documentation. It is a warning, never a refusal: rejecting an unknown key
would break every consumer passing a forward-compatible extra — the ordinary way to write code that
runs against two SDK versions — and turn a diagnostic problem into an outage. A correct
configuration emits nothing, and there is a test for that, because a warning that fires on valid
input stops being read.
