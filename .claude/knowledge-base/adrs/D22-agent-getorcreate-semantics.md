# D22 — `Agent.getOrCreate` semantics

**Status:** Decided
**Date:** 2026-05-17

## Decision

`Agent.getOrCreate(agentId, options)` is a public static method on `Agent` that consolidates the resume-or-create dance into a single call. Internally:

1. Try `Agent.resume(agentId, options)`. Return on success.
2. On `UnknownAgentError`, fall through to `Agent.create({ ...options, agentId })`.
3. On `ConfigurationError(code: "agent_already_exists")` during create (same-process race), retry `Agent.resume(agentId, options)` once and return that handle.
4. Re-throw any other error verbatim — never silenced.

The method is NOT atomic across processes. Documented behavior, mirroring D17 ("one SDK process per cwd").

## Rationale

Six examples (`telegram-pro`, `telegram-bot`, `resume-agent`, `agent-management`, `error-handling`, `error-handling-full`) replicate the same try/catch boilerplate by hand. Extracting the pattern eliminates ~30 LoC per example and removes a class of bugs where developers forget to re-throw non-`UnknownAgentError` exceptions.

The race-retry branch handles the realistic case of concurrent messages to the same chat agent (two Telegram updates from the same user arriving within ms): without it, the second call would surface a `ConfigurationError` to the user. Cross-process race is out of scope — covered by D17's per-cwd limitation.

Considered alternatives:
- **Atomic resume-or-create with a mutex**: rejected because the existing per-cwd mutex (D19) protects sends, not registration. Adding a registration mutex would slow the cold path and conflicts with the documented "one SDK process per cwd" constraint.
- **Make `Agent.create` upsert-by-default**: rejected because consumers benefit from the explicit "already exists" error in non-chat use cases (CLI tools, batch jobs).

## Consequences

- Enables 1-to-1 migration of the 6 existing examples without behavior change.
- Public API surface grows by exactly one method. No new types, no new errors.
- Race-retry adds <1ms latency only on the race path; happy path unaffected.
- Cross-process race continues to surface as `ConfigurationError(agent_already_exists)` — consumers running multiple SDK processes per cwd must catch it themselves (consistent with D17).
- Subsequent helpers (`createAgentFactory`, `Agent.builder()`) compose on top of `getOrCreate` rather than re-implementing the dance.
