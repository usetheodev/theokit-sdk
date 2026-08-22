---
"@theokit/sdk": patch
---

A real cloud run now reports a `RunStatus` the public type actually declares
(#341). The SSE transport cast the server's terminal token straight into
`RunStatus`, and the server sends `FINISHED` while `RunStatus` is lowercase — so
`result.status === "finished"` never fired on a successful cloud run, and
`throwOnError`, which keys on `"error"`, never fired on a failed one. Silently,
on the primary cloud path.

Server tokens are now mapped case-insensitively onto `RunStatus`, and an
unrecognised one fails the run with an actionable message instead of defaulting
to `"finished"`. `EXPIRED` settles as `"error"`: a run that expired did not
finish. The wire-level `SDKStatusMessage.status` stays uppercase — that is its
declared union — but is validated rather than cast.
