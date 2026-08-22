---
"@theokit/sdk": patch
---

The `tests/chaos` and `tests/load` families no longer report resilience coverage they do not have.

Every file in both directories exercised `node:fs`, `node:http` and `node:child_process` without
importing a single line of SDK source, and two of their assertions could not fail at all:
`result.code !== undefined || result.signal !== null` is always true when `code` is `number | null`,
and `typeof process.uptime === "function"` cannot be false in a process alive enough to run the
assertion. The directory names promised that OOM, SIGKILL-mid-stream, filesystem partition and
generator leaks were covered against the product. They were not.

The OOM test now asserts what it observes: that the heap-capped child aborts rather than exiting
cleanly, and that its allocation loop never printed `survived`. Measured — V8's out-of-memory is a
fatal process abort, not a catchable exception, so the child's own `catch`/`exit(7)` never runs and
the assertion does not pretend otherwise. Verified to go red when the heap cap is raised so the child
survives.

The generator-leak test is rewritten against real SDK code. It previously asked
`FinalizationRegistry` whether a generator had been collected, behind a `globalThis.gc` guard nothing
in the repository satisfied, so it reported a pass without executing its assertion for its entire
life; supplying the flag makes it fail, and no window can fix that, because the specification gives
`FinalizationRegistry` no timing guarantee at all. It now asserts cleanup through the task event
stream's own subscriber count — deterministic, no GC and no timers — and it is verified by mutation:
removing the iterator's `return()` turns it red.

That rewrite also corrects the premise it was built on. Breaking out of a `for await` loop does not
leak a generator; the iteration protocol calls `.return()` on your behalf, on `break` and on `throw`
alike. Only an iterator taken by hand and abandoned escapes cleanup, and that is the shape now
asserted.

The scaffolds that remain unwired each carry a todo naming the SDK path they stand in for, an owner
and a sunset date, and each directory carries a README stating plainly what it does and does not
cover.
