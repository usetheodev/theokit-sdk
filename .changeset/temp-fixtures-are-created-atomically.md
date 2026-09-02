---
"@theokit/sdk": patch
---

Test-only: the MCP token-store fixtures create their temporary directories atomically.

CodeQL reported an insecure temporary file at high severity, and the report was right. The
directories were built from a predictable name — `theokit-mcp-tokens-${hrtime}` under a
world-writable `/tmp` — and one of them was created world-writable and populated afterwards. On a
shared machine another local user can predict the path, win the race to create it, and plant a file
the test is about to trust; the restrictive mode passed to `mkdirSync` arrives after the name has
already been claimed.

`mkdtempSync` creates with a random suffix and mode 0700 in one atomic step. The one fixture whose
loose modes ARE the subject — the case proving the gate refuses a world-writable store — creates
restricted and loosens with `chmod`, so the state under test is identical and the window is closed.

No production code is affected and no assertion changed.
