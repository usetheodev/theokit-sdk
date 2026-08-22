---
"@theokit/sdk": patch
---

A run that exhausts its iteration budget now says so (#338 item 4). It reported
`status: "error"` with an empty result and no error detail — byte-for-byte the
shape a provider rejection produces, so a caller could not tell "the model ran out
of turns" from "the provider refused the request". `RunResult.error` now carries
`code: "iteration_limit_reached"`, the limit that was hit, and the name of the
option that raises it.

`LocalOptions` documents two behaviours that were reported as surprises: a `shell`
tool is registered on every local agent even when you pass `tools: []`, and a
finished run writes a transcript with the full prompt and reply to
`.theokit/memory/sessions/` under the workspace. Behaviour unchanged; both now
appear where a consumer meets them.
