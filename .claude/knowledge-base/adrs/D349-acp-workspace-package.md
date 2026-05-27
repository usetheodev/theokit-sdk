# D349 — `@usetheo/acp` ships as separate workspace package

- **Status:** Accepted
- **Date:** 2026-05-26
- **Plan:** `acp-server-adapter-plan` (Phase 0)

## Context

Need to expose `@usetheo/sdk` `SDKAgent` as an Agent Client Protocol (ACP) server so Zed/Cursor/Claude Desktop users can drive it.

## Decision

ACP support ships as a new `@usetheo/acp` workspace package, NOT folded into `@usetheo/sdk`.

## Rationale

Same precedent as `@usetheo/gateway-*`, `@usetheo/memory-*`, `@usetheo/skills-google-workspace`: protocol adapters live outside core SDK. Consumers who never need ACP pay zero bundle cost. Peer-dep model lets the user pin their own `@agentclientprotocol/sdk` version when they need to.

## Consequences

- One more npm artifact to maintain (`@usetheo/acp@0.x.y`).
- Peer dep: `@usetheo/sdk@workspace:^` + `@agentclientprotocol/sdk@^0.22`.
- Pre-1.0 version per D181 pattern until upstream protocol stabilizes.
- Distribution: published to npm + listed in ACP registry via `agent.json`.
