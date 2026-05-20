# D102 — `ToolRegistry` is 3-layer (registration → exposure → availability)

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D103, D104

## Decision

Tool surface has three independent layers:
1. **Registration** — `ToolRegistry.register(entry)` (central, dup throws)
2. **Exposure** — `Toolset` (named flat list of tool names)
3. **Availability** — `isToolAvailable` (`requiresEnv` check + TTL-cached `checkFn`)

Compose: `getAvailableTools(resolveToolset(toolset, registry))` produces
the final list shown to the LLM.

## Rationale

Hermes ships 98 tools with this pattern. Each layer mutates
independently — plugins add tools (registration); different agents see
subsets (exposure); tools with external deps filter dynamically
(availability). Single dict doesn't scale to that volume without becoming
a god-object.

## Consequences

- **Enables:** scale to 50+ tools without refactor; filter by toolset
  name; tools with optional deps (playwright, image_generate) stay
  registered but hidden when unavailable.
- **Constrains:** 3 layers vs 1 dict — conceptual overhead mitigated by
  clear module names and JSDoc.
