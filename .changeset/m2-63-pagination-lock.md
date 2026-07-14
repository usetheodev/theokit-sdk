---
"@theokit/sdk": patch
---

Fix (#63) — pagination now fails fast on invalid cursors. `paginate({ offset, limit })` rejected a `NaN` offset by silently returning the WHOLE list (and negative by returning empty); it now throws `ConfigurationError{code:"pagination_invalid"}` for any non-negative-integer offset/limit. Also adds real cross-process evidence for the conversation-storage file lock: two separate OS processes taking `withFileLock` on the same file are proven to serialize (previously only in-process concurrency was tested).
