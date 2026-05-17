# D26 — Cloud agent parity for the 4 DX helpers

**Status:** Decided
**Date:** 2026-05-17

## Decision

All four DX helpers — `Agent.getOrCreate`, `createAgentFactory`, `defineTool`, `Agent.builder()` — work identically for local and cloud agents. None of them introduces new cloud-specific validation, persistence, or transport logic. Cloud-runtime constraints (e.g., "custom tools are local-only", `cloud_custom_tools_rejected`) continue to be enforced by `validateAgentOptions` and `LocalAgent.send` / `CloudAgent.send` — the existing single point of truth.

Specifically:

- `Agent.getOrCreate` calls `Agent.create` and `Agent.resume`, which already route to `CloudAgent` or `LocalAgent` based on `options.cloud`.
- `createAgentFactory` delegates terminal construction to `Agent.create` / `Agent.getOrCreate`, inheriting cloud routing.
- `defineTool` produces a `CustomTool`. If the consumer passes it to a cloud agent (`AgentOptions.cloud` set), `validateCustomTools` (called by `validateAgentOptions`) rejects with `cloud_custom_tools_rejected`. No new code path.
- `Agent.builder().cloud(...)` builds a cloud-flavored `AgentOptions`; `.create()` / `.getOrCreate()` honor it via the same routing.

## Rationale

DRY enforcement of cloud constraints. The "custom tools are local-only" rule lives in exactly one place (`validateCustomTools` in `validate-agent-options.ts`) and is reused across creation, resume, per-call `SendOptions.tools`, and now all four helpers. Duplicating the rule in any helper would create a second source of truth that drifts.

Alternatives considered:
- **Cloud-specific helper variants** (e.g., `createCloudAgentFactory`): rejected. Doubles the public API surface for zero functional gain — the routing is already automatic via `options.local` vs `options.cloud`.
- **Helpers that pre-validate before delegating**: rejected. Pre-validation duplicates `validateAgentOptions`, and the existing error path already produces tightly-typed `ConfigurationError` codes that consumers can catch.

## Consequences

- Same public API for local and cloud — consumers don't learn two patterns.
- Cloud-incompatible options (`tools` on a cloud agent) fail consistently at the same surface (`ConfigurationError(cloud_custom_tools_rejected)`) regardless of which helper produced them.
- New cloud-runtime rules (if added in future) only need to live in `validateAgentOptions`; all helpers inherit automatically.
- `defineTool` output is serializable up to the validation gate — useful for testing tool definitions against cloud configs without spawning a real cloud agent.
- Cloud-only feature gaps (e.g., `task` tool dispatch is pre-release) remain pre-release; helpers don't paper over them.
