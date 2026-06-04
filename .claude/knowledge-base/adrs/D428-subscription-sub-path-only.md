# D428 — `subscribe` client lives at `@theokit/sdk/subscription` sub-path only

- **Status:** Accepted
- **Date:** 2026-06-04
- **Plan:** `g8-streaming-websocket-sse-resume-plan`
- **Supersedes (partial):** original plan v1.0 proposal D427 to promote `Theokit.subscribe` onto the `Theokit` static class

## Decision

`subscribe(name, input, opts)` is exported from `@theokit/sdk/subscription` ONLY. NOT promoted onto the `Theokit` static class on the main `@theokit/sdk` entry.

```ts
import { defineSubscription, tracked, subscribe } from "@theokit/sdk/subscription";
```

## Rationale

Pulling the subscription module into `src/index.ts`'s DTS bundle reactivates the pre-existing `types/agent.ts ↔ fork-agent.ts` cycle that rollup-plugin-dts trips on (documented in tsup.config.ts header). Same isolation pattern as `path-safety` (ADRs D79-D85) — sub-path keeps the main DTS bundle decoupled from `internal/runtime`.

## Consequences

Consumer-facing API is `import { subscribe } from "@theokit/sdk/subscription"` instead of `Theokit.subscribe(...)`. Once the agent.ts ↔ fork-agent.ts cycle is broken (separate refactor), `Theokit.subscribe` can be promoted without breaking the sub-path import (additive). Mirrors the SDK's established pattern for `@theokit/sdk/path-safety`, `/tools`, `/workflow`, `/eval`.
