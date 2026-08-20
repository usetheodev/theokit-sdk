---
"@theokit/sdk": patch
---

The "Missing API key" refusal now names the provider credential you actually have
(#338 item 5). With `OPENROUTER_API_KEY` exported and `THEOKIT_API_KEY` unset,
the old three-word message named neither — while the SDK consults that exact
variable a moment later to decide whether to drive a real runtime, so the
environment looks configured to whoever set it up. Reported as three hours of
diagnosis on the wrong cause.

Resolution is unchanged: a provider key is still not adopted from the
environment, because with two of them exported there is no non-arbitrary answer
to which one was meant. The message says where to put it instead. Names the
variables, never their values.
