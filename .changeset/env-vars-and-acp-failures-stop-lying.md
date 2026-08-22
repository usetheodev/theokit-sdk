---
"@theokit/sdk": patch
"@theokit/acp": patch
---

Three places where a value was reported that nobody had actually selected.

**An empty `POSTHOG_API_KEY` no longer masks a valid `POSTHOG_PROJECT_API_KEY`.** The adapter read
`POSTHOG_API_KEY ?? POSTHOG_PROJECT_API_KEY`, and `??` treats `""` as present. Leaving a variable
blank in a `.env` or a CI config is the ordinary way to say "unset", so a blank primary key silently
disabled telemetry while a working key sat in the sibling variable — and telemetry going quiet is the
one failure that reports itself as nothing at all. Empty and whitespace-only values now fall through.
The same trap on `POSTHOG_HOST` is closed with it.

**The provider inspector reports the model the route resolves to.** `extractModelName` documented
itself as surfacing the name from the prefix split and instead returned a hard-coded default, so a
route configured as `anthropic:claude-opus-4` with no explicit `route.model` reported
`claude-3-7-sonnet`. That field exists to let a caller confirm which model a route resolves to; a
wrong answer there is worse than no answer, because it is indistinguishable from a right one. The
name is now derived from the model id the route actually carries, and the default-model lookup that
produced the literal is deleted rather than left as a decoy.

**An errored ACP run no longer reaches the client as `end_turn`.** The stop-reason mapping fell
through to `end_turn` for any run status it did not recognise, so a failure was reported over the
wire as an ordinary completed turn — invisible to every ACP client, which is the swallowed-error
shape the project's error-handling rules forbid by name. The protocol's `StopReason` has no error
value, so an unmapped status now surfaces through the JSON-RPC error channel the handler already uses
for every other failure, with a message naming the status that was not mapped. A dead branch
returning `end_turn` twice is removed in the same pass.
