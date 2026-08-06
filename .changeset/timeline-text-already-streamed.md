---
"@theokit/sdk": minor
---

`run.events()` now states whether a message's text already streamed, so consumers stop inferring it
by comparing text.

Unifying the timeline in 4.38.0 fixed ordering and the `callId` namespace. It did not stop the same
text arriving twice: the run's event log carries the complete assistant message, and the deltas are
additional. A consumer had to relate the two by COMPARING CONTENT — which is where the
`callId`-namespace and timestamp-fallback bugs came from.

The producer knows the answer as a fact. The SDK emits the deltas and emits the message from the
same scope, so `RunTimelineEvent` of kind `message` now carries an optional `textAlreadyStreamed`,
and the consumer's dedup becomes a boolean read instead of a text comparison.

Marked rather than suppressed: the assistant message also carries tool calls and metadata, so
dropping it would trade a duplicate for a hole. The field is optional and absent when the question
does not apply (a message with no text), so no existing `events()` consumer breaks and `stream()` is
untouched.

Closes the contract half of theokit#140.
