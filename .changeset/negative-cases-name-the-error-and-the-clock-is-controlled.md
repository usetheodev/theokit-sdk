---
"@theokit/sdk": patch
"@theokit/sdk-tools": patch
"@theokit/sdk-handoff": patch
---

Seventeen more negative-case tests now identify which failure they caught, and a registry test suite
stops sleeping to make timestamps differ.

Most of those assertions turned out to be under-asserting rather than untestable: twelve of them sat
on errors that were **already typed**, and simply checked that something threw. They now name the
class, the stable code and a message fragment — which means a change that swaps one failure for
another is caught, where before any error at all satisfied the test.

Four remain matched on a message fragment because the underlying error genuinely has no type yet, and
one of those is filed separately: a public entry point throwing a plain error gives callers nothing to
branch on but a string that changes whenever someone improves the wording.

Four more were reclassified out of scope after reading the source rather than the name: they raise
errors owned by Node, by the schema library, or by a database driver, and pinning a third-party class
buys little.

Separately, the live-agent-registry tests slept thirteen times — some to force last-used timestamps
apart so eviction ordering could be asserted, others to let fire-and-forget cleanup finish. Both are
now driven by the test clock, a mechanism this same file already used elsewhere and which needed no
production change. The file runs in a fraction of the time and no longer depends on how busy the
machine is.
