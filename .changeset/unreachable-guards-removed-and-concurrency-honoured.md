---
"@theokit/sdk": patch
---

Removes two guards no caller could reach, makes `Batch`'s `concurrency` option actually bound
`onResult`, and stops three `Agent` APIs from accepting documented options they discarded.

**`concurrency` now bounds `onResult`.** The semaphore slot was released before the result callback
ran, so a batch configured with `concurrency: 2` could have any number of `onResult` callbacks in
flight at once. Callers using that option to protect a rate-limited downstream — the reason to set it
at all — were not protected. The callback now runs inside the slot it belongs to. A test that had
pinned the old behaviour as a contract is inverted, because it documented the bug as a promise.

**Three `Agent` APIs honour their options or stop accepting them.** `Agent.get` and `Agent.listRuns`
took a `cwd` and ignored it, so they answered about the wrong workspace; `Agent.list` took
`includeArchived`, `limit` and `cursor` and ignored all three. Each is now wired, with pagination
opt-in so the default ordering is unchanged. Two options are removed rather than half-implemented:
`prUrl`, which would need the on-disk registry to retain per-repo URLs, and `ListRunsOptions.runtime`,
which is redundant once an `agentId` pins the runtime. Silently discarding a documented option is
worse than not offering it, because the caller has no way to detect it.

**Two unreachable guards are deleted.** The Vertex client's fetch wrapper branched on `URL` and
`Request` input forms its only caller never produces, and on a URL condition that caller always
satisfies. Separately, `plugins.paths` was validated in two places while being undeclarable in the
option type, so nothing could ever supply it. Both are removed rather than annotated: a defensive
branch nothing can reach is a decoy that reads like working machinery, and this project has now spent
real time on three of them.
