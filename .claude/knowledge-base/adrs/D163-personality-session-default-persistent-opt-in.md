# D163 — Active personality is session-scoped by default; persistence is opt-in

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`PersonalityStore` tracks the active slug per `agentId` in memory. The
state is process-local by default — restarting the process clears it.
Callers pass `{ save: true }` to `usePersonality(...)` to persist the
choice to `$THEOKIT_HOME/personality.json` (`{ version: 1, agents: {
"agent-id": "slug" } }`).

**EC-B invariant:** `setActive(agentId, undefined, { save: true })`
DELETES the key from the `agents` map. Never writes `"agent-id": null`.
"Key absent === no active personality" is the single canonical
representation.

## Rationale

Most users want ephemeral per-session voice changes (chat assistant,
quick experiment). Persistent state is the opt-in escape hatch for bots
and deployed agents that must survive restarts. Two-step API
(`{ save: true }` flag) is simpler than two methods. The delete-key
invariant keeps hydration logic trivial: read the JSON, look up the
agentId, missing-key === no preset.

## Consequences

- **Enables:** simple per-process default + explicit durability.
- **Constrains:** cross-agent shared state is out of scope — each
  `agentId` has its own active preset.
