---
"@theokit/cli": major
"@theokit/sdk": minor
---

Two `theokit` flags that were advertised in `--help` and read by nothing now behave.

`tasks cancel --reason <r>` records the reason: `TaskHandle` gains a `cancelReason` field, written
alongside `cancelledAt` for a queued task and alongside `cancelRequested` for a running one. A task
that is already terminal is left untouched, reason or not.

**Breaking:** `theokit init --here` is removed. It never scaffolded into the current directory, and
the writer cannot honour it — the tree is built in a temp directory and moved into place with `rm` +
`rename`, so a destination equal to `cwd` would mean deleting the directory the process is running
in. An unknown-option error is immediate and clear where silence was not.
