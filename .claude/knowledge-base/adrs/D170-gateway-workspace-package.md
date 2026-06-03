# D170 — `@theokit/gateway` is a workspace package separate from `@theokit/sdk`

**Date:** 2026-05-21
**Status:** Accepted

## Decision

The multi-platform messaging gateway ships as `packages/gateway/` (a new workspace package), NOT inside `packages/sdk/src/gateway/`.

## Rationale

The pillar narrative in the root `CLAUDE.md` is "SDK = harness, TheoKit = framework". A multi-transport messaging layer is framework-territory, not harness-territory. Putting it under the SDK would (a) bloat the SDK's API surface, (b) drag transport peer deps (grammy, discord.js) into the SDK's dependency graph even for users who never touch bots, and (c) blur the pillar boundary. The same logic justified the `@theokit/memory-*` split (ADR D143).

## Consequences

- **Enables:** independent versioning, opt-in install (`pnpm add @theokit/gateway @theokit/gateway-telegram`), clean SDK boundary.
- **Constrains:** consumers who want both the SDK and the gateway install two packages — same as memory adapters. Acceptable.
