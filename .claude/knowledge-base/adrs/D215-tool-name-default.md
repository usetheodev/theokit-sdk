# D215 — Default handoff tool name = `transfer_to_<receiver.name>`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

The default name for a handoff's synthetic tool is `transfer_to_<receiver.name>`.
`<receiver.name>` is the agent's `name` field, falling back to a short
`agentId` slug when unset. Overridable via `Handoff.create(target, { toolName })`.

## Rationale

- OpenAI Agents convention; LLMs across providers (Anthropic, OpenAI, Google,
  Mistral) reliably invoke `transfer_to_X`-named tools.
- Cross-provider portability matters: switching from OpenRouter to Anthropic
  shouldn't break handoff behavior.

## Consequences

- Enables cross-provider portability without prompt tuning.
- Constrains: receivers MUST have unique resolved `name` per sender (Zod
  refinement at `Agent.create`); collision throws `HandoffNameCollisionError`.
