---
"@theokit/sdk": minor
---

Observability is now trustworthy (#64). (1) **Nested spans:** `startChildSpan` used to discard its parent and start a flat sibling, so a trace backend could not reconstruct the causal tree; it now links the child to the parent via an explicit OTel parent context (`llm.call` / `tool.call` nest under `agent.send`). (2) **EventBus fails loud:** a throwing subscriber used to vanish into an empty `catch {}`; `publish` now logs the error (event key + message) to stderr and increments an observable `handlerErrorCount`, while preserving the EC-2 contract that sibling handlers still fire. (3) **Metrics:** tool-call / LLM-call durations + LLM token throughput — previously measured but only attached as span attributes — are now emitted as dedicated metrics via the existing `recordHistogram` path.
