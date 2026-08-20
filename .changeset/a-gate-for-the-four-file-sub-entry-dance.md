---
"@theokit/sdk": patch
---

Adding a published sub-entry to the SDK now fails fast and names every file still missing, and the
ACP smoke test actually sends the request its name promises.

Thirty-four sub-entries are published, and adding one required editing four files that nothing forced
to agree: the package's `exports`, the bundler's entry list, the declaration-build include, and the
declaration-mirroring script's target list. Only the first omission failed quickly. Skipping the last
two broke nothing visible — output was emitted, typechecking passed, the whole suite passed — and the
only gate that noticed ran at pre-push, about ten minutes in, where the error surfaces on whoever
pushes next rather than on whoever caused it. A consistency check now derives the expected set from
`exports`, the file that decides what is actually published, and reports every place that disagrees.
It runs at the front of the validation chain, not at the end of it.

Separately, the ACP smoke test was named for initializing a session, prompting, cancelling and
shutting down, and its docblock promised a response with a stop reason. It never sent a prompt. Two
defects in one: a name that tells the reader a path is covered, and a real gap on the protocol's main
path. It now sends the request over the wire and asserts the stop reason it gets back — verified by
mutating the handler to return a different reason and watching the test fail.
