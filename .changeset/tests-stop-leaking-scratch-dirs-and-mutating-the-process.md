---
"@theokit/sdk": patch
---

Test-suite hygiene: scratch directories are cleaned up, the working directory is no longer mutated
process-wide, and the agent registry starts empty in every test.

Fifty-nine test files created temporary directories and never removed them, so a full run left its
debris behind on every machine that executed it. Each now removes its directory when the test
finishes, through the same retry-hardened helper the workspace fixture already used — the retries
matter because a directory holding a file another handle has open cannot be removed on the first
attempt.

Three tests changed the process's working directory to exercise code that reads it. `process.chdir`
is process-wide, so a test doing that mutates the environment of every other test sharing the worker,
and the two production paths involved hardcode the current directory with no override to pass. They
now replace the reader rather than the process state. A lint test bans any future live `chdir` under
the test tree, so this does not return for a fourth time.

The agent registry is a process-wide map that does not follow the per-test home directory, so entries
accumulated across tests and individual files had taken to clearing it by hand — which only works for
the files that remember. It is now cleared by the shared setup, unconditionally.

One test file was removed rather than repaired: it exercised a locally-declared copy of a concurrency
helper instead of the real one, so nothing it asserted could fail when production changed. Its one
genuinely distinct assertion — that three tasks overlap under a barrier — moved to a test that drives
the real function, and was verified by stubbing that function to return nothing and watching four
tests die.
