# D350 — ACP server-only in v0.1; client deferred to v0.2

- **Status:** Accepted
- **Date:** 2026-05-26
- **Plan:** `acp-server-adapter-plan` (Phase 0)

## Context

ACP has two roles: server (expose our agent) and client (call other ACP agents). Both OpenClaw and Hermes ship server; OpenClaw also ships client.

## Decision

v0.1 ships server only. ACP client (calling external Claude Code/OpenCode/Cursor agents from inside our SDK) is deferred to v0.2.

## Rationale

Server is the high-leverage path — distribution to Zed/Cursor users. Client adds subprocess lifecycle + auth flow complexity and overlaps with our existing `Handoff` primitive (D214-D229). Sequencing avoids landing a half-baked client.

## Consequences

- `theokit acp` only **serves**.
- Calling Zed's Claude Code from inside our agent requires v0.2.
- v0.2 plan will be `acp-client-adapter-plan.md` — likely composes with `Handoff.create()` to wrap an external ACP agent as a peer.
