---
"@theokit/sdk": patch
---

SE40 cleanup — remove the dead `GoalOptions.threadId` option. It resolved the goal from the SE33 durable thread-scoped objective, which was removed in v4.0; the field was left in the public type but is no longer read by `runUntil` (a no-op in 4.0.0). Removing it completes the "no legacy kept" contract of the v4.0 virada. `runUntil(goal, options)` is unaffected — pass an explicit goal (a call with no goal pauses).
