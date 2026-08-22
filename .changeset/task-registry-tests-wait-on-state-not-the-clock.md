---
"@theokit/sdk": patch
---

The task-registry tests wait for the state they need instead of sleeping.

Twelve waits in that suite were fixed sleeps between 10ms and 200ms, each chosen to be "long enough"
for the registry's fire-and-forget work to reach a state. The state is observable — the registry can
be asked for it — so the sleep was guessing at something the test could simply read. Under load those
guesses stop being long enough, which is how a suite acquires flakes that only appear on a busy
machine or a slow runner.

Each now polls the real state with a deadline. A passing run is never slower than the sleep it
replaced, because it returns the moment the state arrives; a state that genuinely never arrives fails
with the state it was waiting for, rather than an assertion on stale data.

The shared polling helper was widened to accept an asynchronous condition rather than growing a
second near-identical copy for the case where the value has to be awaited.
