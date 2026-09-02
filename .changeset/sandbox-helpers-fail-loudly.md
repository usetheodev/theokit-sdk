---
"@theokit/sdk": minor
---

`SandboxBackend`'s derived `glob`, `grep` and `listDir` now throw when the command could not run.

They returned `[]` on any non-zero exit, so a search that could not execute reported the same thing as
a search that found nothing — opposite facts, one normal and one meaning the agent is looking at a
filesystem it cannot read. That is the failure a backend whose `execute` is not a POSIX shell hits,
which the class docblock warns about in prose and could not enforce.

A genuine no-match still returns `[]`, and the distinction is the one the tools themselves draw:
`grep` exits 1 for no match and ≥2 for an error, `find` exits 0 with empty output.

If you have a custom backend that is not a POSIX shell and relied on these silently returning nothing,
they now throw a `ConfigurationError` with code `sandbox_derived_helper_failed`, telling you to
override them — which the docblock already asked for.
