---
"@theokit/acp": patch
"@theokit/cli": patch
"@theokit/memory-honcho": patch
"@theokit/memory-mem0": patch
"@theokit/memory-supermemory": patch
"@theokit/sdk-budget": patch
"@theokit/sdk-cache": patch
"@theokit/sdk-handoff": patch
"@theokit/sdk-memory": patch
"@theokit/sdk-pty": patch
"@theokit/sdk-tools": patch
"@theokit/sdk": patch
---

Test runs no longer claim every core on the host.

None of the package configs capped `maxWorkers`, so vitest's default applied: `os.availableParallelism()`,
one fork per core, each booting a full test environment. The repo's `test` script is
`turbo run test --filter='./packages/*'`, so that default is paid once per package *concurrently* —
nproc forks times turbo's concurrency, on nproc cores. Measured on a 12-thread machine during an
unrelated investigation, two vitest pools alone were enough to reach load average 33.89 with the
desktop unusable; a full fan-out is several times that.

`@theokit/sdk` is the interesting case. B-104 recorded on 2026-08-19 that the `poolOptions.forks.*`
block was 100% dead in Vitest 4, deleted it, and noted that `fileParallelism: false` was forcing
`maxWorkers` to 1 unconditionally, so a fork-count knob could not act. B-059 then flipped
`fileParallelism` to `true` on 2026-08-20, which made the knob able to act again — and nothing
reintroduced one, so the package silently went back to the uncapped default. That comment has been
corrected along with the config; it claimed no knob existed, which is no longer true.

The cap leaves 4 cores free (`Math.max(2, cpus().length - 4)`), scaling with the runner rather than
hard-coding one machine's core count. It costs no wall-clock: measured in `theokit-ui`, the full
suite ran 73.96s at 4 workers against 74.36s at 12, so the parallelism above the cap was already
noise. Verified as resolved config rather than as file contents — `createVitest` reports
`maxWorkers: 8` on a 12-thread host, which is the formula, not the default.

This changes no published behaviour; it is test tooling only. Refs usetheokit/theokit-ui#51.
