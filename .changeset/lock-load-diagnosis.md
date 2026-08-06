---
"@theokit/sdk": patch
---

The file-lock fallback warning reports the failure it observed, instead of always claiming
`proper-lockfile` is not installed.

`getProperLockfile` wrapped the dynamic import in a bare `catch` that discarded the error, so every
failure — a broken install, a module-format problem, a bundler that rewrote the specifier — surfaced
as "not installed". A consumer whose package was declared, installed and resolvable from the SDK's
own `dist` spent a debugging session re-verifying the one thing that was already correct.

Absence is now the only case that claims absence (`ERR_MODULE_NOT_FOUND` / `MODULE_NOT_FOUND`). Any
other failure reports its code and message and points at bundling and interop. All variants state the
consequence explicitly: concurrent processes over the same file are not serialized.

The warning also no longer fires on top of the structural "does not expose `lock`/`unlock`" warning —
two contradictory diagnoses of one failure left no way to tell which was true.
