---
"@theokit/sdk": patch
"@theokit/sdk-tools": patch
---

Fourteen negative-case tests now identify which guard fired, and a scheduled job keeps test-order
independence honest.

Assertions that only checked "something threw" now assert the error class, its stable code and a
message substring — for concurrency validation, retry configuration, path traversal, filename
validation and credential loading. Each conversion was verified by mutating the production error's
code and watching the corresponding test fail, so the assertions are pinned to the real constants
rather than to a copy of them.

Forty-five remaining sites are deliberately left alone and grouped with reasons: ten raise validation
errors owned by a third-party schema library, thirteen surface Node's own errors, and twenty-two are
plain untyped errors in our code where there is no class or code to assert yet.

Separately, the suite runs one file at a time, and a comment in the configuration said that was
covering up a leak. Measured: with file-level parallelism restored the suite is fully green, twice
over — the two leaks that comment named have since been fixed. Restoring *within-file* concurrency
plus randomised order does still fail, reproducibly, in one file that shares a mutable counter
between its cases; that is filed on its own and is not fixed here.

The default gate is unchanged. A separate weekly job runs the suite in shuffled order so the
remaining coupling keeps surfacing instead of staying suppressed by the serial default.

Also documented for contributors: what makes a wait trustworthy, and why a premise that justifies
deleting something needs checking in a way that a premise justifying keeping something does not.
