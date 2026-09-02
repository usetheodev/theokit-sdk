---
"@theokit/sdk": patch
---

Embedding requests now retry with the same jittered exponential backoff the rest of
the SDK uses, and honour the provider's `Retry-After` header.

They used to back off linearly at `50ms * attempt` and ignore `Retry-After`, so two
clients hitting a rate-limited embedding endpoint retried in lockstep and neither
waited as long as the provider asked. The delay is tuned tighter than the LLM
transport's — 250ms base, 4s cap rather than 500ms/32s — because an embedding retry
sits inside a memory write on the run's critical path.
