---
"@theokit/sdk": patch
---

An unrecognised key under `local` is now reported on the diagnostics channel instead of being
accepted in silence.

Measured before this: `Agent.create({ local: { settingSourcess: [...] } })` — one letter wrong —
created the agent with no throw, no warning, and nothing anywhere. That made two very different
failures identical: a typo and an SDK too old to know the option both produced the default
behaviour and no complaint. The second half is the expensive one, because it is invisible from
inside a correct-looking call site.

The message names the key and the nearest known one, so one letter wrong is one line to read
rather than a trip to the documentation. It is a warning, never a refusal: rejecting an unknown key
would break every consumer passing a forward-compatible extra — the ordinary way to write code that
runs against two SDK versions — and turn a diagnostic problem into an outage. A correct
configuration emits nothing, and there is a test for that, because a warning that fires on valid
input stops being read.

The original of this change is on the 5.x line, where it was measured against `compatSources`, an
option this line does not have. What is backported here is the behaviour, over the options that do
exist on 4.x.
