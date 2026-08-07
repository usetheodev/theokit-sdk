---
'@theokit/sdk-tools': patch
---

`interactive_shell` no longer flattens a session-cap error into
`interactive_unavailable`.

`toErrorJson` matched `InteractiveUnavailableError` first, so `MaxSessionsError` — which extends it —
took that branch and lost `max` and `liveSessionIds`. Those are the only actionable fields in the
error: without them the model cannot tell a missing backend from a session cap it could clear by
reusing one of the open sessions, which is exactly what `@theokit/sdk-pty`'s docblock says those
fields exist for.

The check is structural rather than `instanceof`, because the class lives in `@theokit/sdk-pty` and
this package does not depend on it — and the tool takes an injected backend, so any provider
reporting the same two fields gets the same treatment.

Measured from a consumer that had forked this tool's entire schema and handler to recover the fields,
since there is no error seam to override.
