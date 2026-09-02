---
"@theokit/sdk": patch
---

`Agent.batch(prompts, { task })` now rejects when the batch task fails, instead of resolving with an
empty array.

The task-wrapped path assigned its results inside the task's `work` callback and then returned that
variable unconditionally, so three different failures produced one indistinguishable value: the work
threw, the task was cancelled, or a fixed 5000-iteration poll budget elapsed. Each returned `[]` on
a **resolved** promise — which a caller cannot tell apart from `Agent.batch([])` on empty input.
Nothing threw and nothing was logged, and the registry's own `{ code, message }` for the failure was
discarded by a loop that read only the task's `state`.

The poll is gone. The wait is now the task's terminal event, which carries the failure detail:

- work threw → rejects with `code: "batch_task_failed"`, the registry's code on `protoErrorCode`
- cancelled → rejects with `code: "batch_task_cancelled"` and the reason, when one was given

The removed budget was not a safety net: 5000 iterations of a 5 ms sleep is roughly 25 seconds, so a
batch legitimately longer than that would trip it and return `[]`. The bound generated the failure
it appeared to guard against.

If you were checking `results.length === 0` to detect a failed batch, catch the rejection instead —
an empty array now means only what it says.
