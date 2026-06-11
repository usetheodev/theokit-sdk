# D349 — `@theokit/acp` ships as separate workspace package

- **Status:** Accepted
- **Date:** 2026-05-26
- **Plan:** `acp-server-adapter-plan` (Phase 0)

## Context

Need to expose `@theokit/sdk` `SDKAgent` as an Agent Client Protocol (ACP) server so Zed/Cursor/Claude Desktop users can drive it.

## Decision

ACP support ships as a new `@theokit/acp` workspace package, NOT folded into `@theokit/sdk`.

## Rationale

Same precedent as `@theokit/gateway-*`, `@theokit/memory-*`, `@theokit/skills-google-workspace`: protocol adapters live outside core SDK. Consumers who never need ACP pay zero bundle cost. Peer-dep model lets the user pin their own `@agentclientprotocol/sdk` version when they need to.

## Consequences

- One more npm artifact to maintain (`@theokit/acp@0.x.y`).
- Peer dep: `@theokit/sdk@workspace:^` + `@agentclientprotocol/sdk@^0.22`.
- Pre-1.0 version per D181 pattern until upstream protocol stabilizes.
- Distribution: published to npm + listed in ACP registry via `agent.json`.
