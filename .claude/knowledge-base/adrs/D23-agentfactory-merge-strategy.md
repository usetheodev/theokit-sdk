# D23 — `createAgentFactory` merge strategy

**Status:** Decided
**Date:** 2026-05-17

## Decision

`createAgentFactory(common: Partial<AgentOptions>)` returns an `AgentFactory` handle exposing `forSession(agentId, overrides?)` and `getOrCreate(agentId, overrides?)`. Merge rules between `common` (captured at factory creation) and `overrides` (per-session):

- **Top-level fields**: shallow merge — `overrides` keys win.
- **Deep merge for**: `local`, `memory`, `cloud`. Pattern: `{ ...common.local, ...overrides.local }`. Mirrors what `Agent.resume` already does for `local`.
- **Total replace for**: `mcpServers`, `agents`, `tools`, `providers`, `plugins`, `skills`, `context`. Same semantics as `SendOptions.mcpServers`/`SendOptions.tools`.
- **`agentId`**: the function parameter ALWAYS wins. Both `common.agentId` and `overrides.agentId` are discarded.

## Rationale

Three goals shaped the rule:

1. **Consistency with existing surfaces.** `Agent.resume` already deep-merges `local`; `SendOptions.mcpServers` and `SendOptions.tools` already replace. Following the same pattern means consumers don't learn new rules.
2. **Predictability over flexibility.** Deep-merging arrays and maps (`tools: [t1] + [t2] = [t1, t2]`? or `[t2]`? or `Map.merge`?) creates surprises and ambiguous failure modes (duplicate names? schema conflicts?). Replace is unambiguous.
3. **The 3 deep-merge fields are configuration objects** with non-conflicting flat keys (`cwd`, `sandboxOptions`, `settingSources`; `enabled`, `namespace`, `userId`; `repos`, `autoCreatePR`, `envVars`). Replace would force consumers to repeat all keys per session unnecessarily.

Alternatives considered:
- **Always shallow merge**: rejected because `factory.forSession(id, { local: { cwd: x } })` would clobber the factory's `local.sandboxOptions: { enabled: true }` — invisible regression to unsafe defaults.
- **Always deep merge**: rejected because tools array semantics get confusing (which entries win on name collision?).
- **Let consumer pick via flag**: rejected — flag-driven merge semantics are a known source of bugs; consistency wins.

## Consequences

- Consumers who want session-specific tools must re-supply the full array (replace, not append). Documented in JSDoc.
- Consumers who want to ADD to a memory namespace can pass `overrides.memory = { userId: "...session" }` and inherit `enabled`/`namespace`/`scope` from `common`.
- The factory is by-reference over `common`: post-construction mutation of `common` leaks to subsequent `forSession` calls. Documented as a Riscos table caveat — deep-cloning `common` internally would cost CPU for a non-existent footgun (consumers don't mutate captured config in practice).
- `forSession` always calls `Agent.create` (rejecting on existing IDs). `getOrCreate` calls `Agent.getOrCreate` (resume-first). Two-method API makes the intent explicit at the call site.
