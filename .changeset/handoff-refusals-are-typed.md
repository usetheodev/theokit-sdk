---
"@theokit/sdk-handoff": patch
---

`Handoff.create()` refusals now carry an error class and a stable code.

Both of its guards raised a bare error, so a caller wanting to distinguish "no target given" from
"the target is not an agent" had only the message text to match on — and message text is not a
contract. It changes whenever someone improves the wording, and nothing tells the consumer their
check stopped working.

Each refusal is now a `ConfigurationError` with its own code. The change is additive rather than
breaking: the error class extends `Error`, so anything catching `Error` still catches it, and both
messages are unchanged.
