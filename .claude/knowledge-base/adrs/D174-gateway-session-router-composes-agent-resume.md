# D174 — `SessionRouter` composes `Agent.resume`; never reimplements session storage

**Date:** 2026-05-21
**Status:** Accepted

## Decision

`SessionRouter.resolveAgentId(event) → string` is pure routing logic (build a deterministic key from `MessageEvent`). The resolved id is handed to `Agent.resume(agentId, options)` for actual session continuity — the SDK owns persistence.

## Rationale

The SDK already owns session persistence (ADR D17, D18 — `agent-registry.ts`, session JSONL, hydration). Reimplementing this in the gateway would either drift or duplicate. The gateway's job is **how to compute the key**, not **where to store the session**.

## Consequences

- **Enables:** session resume works identically whether driven by a slash command, a webhook, or a cron job. Zero new persistence code in the gateway.
- **Constrains:** the gateway cannot introduce session features the SDK doesn't have (e.g., gateway-only "ephemeral" sessions). Future PRs needing this must add the feature to the SDK first.
