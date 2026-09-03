---
"@theokit/sdk": patch
---

`Cron.create()` now reports when the job will actually next fire.

It reported `now + 1 hour` for every expression. The function behind it read neither the cron
expression nor the timezone — a `@yearly` job said it would run within the hour, and so did a
`*/5 * * * *` one. Its own docstring scoped it to fixture mode ("real scheduling uses a proper
evaluator wired in by the local scheduler"), and its only caller was `Cron.create()`.

The local scheduler overwrote the value for jobs it picked up, which is why this survived: the wrong
number was visible between creating a job and the scheduler reaching it, and permanently for a job
the scheduler never runs — a job created against a cloud runtime, or created while the scheduler is
stopped.

`nextRunAt` is now computed with croner, which was already a dependency and already doing exactly
this inside the scheduler. When an expression has no next run — `0 0 30 2 *`, a date that never
occurs — the field is absent rather than filled with a number, which is what the optional
`CronJob.nextRunAt` already meant.
