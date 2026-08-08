# SDK

The primitives in practice. Every API here was verified against `packages/sdk/src/types/` at
`@theokit/sdk@4.36.0` on 2026-07-30 and has not been re-verified since — the exported types
remain the canonical contract, and where these pages disagree with them, they are the defect.

# Core surface

* [Agent, Run and SDKMessage](agent-run-sdkmessage.md) - The three core objects, their lifecycles and the three ways to invoke.
* [Observation channels](observation-channels.md) - Why messages, deltas and events are three separate channels.
* [Run signals](run-signals.md) - Every terminal and out-of-band signal a run reports.
* [Import map](import-map.md) - All ~30 sub-entries in one place, grouped by task.

# Tools

* [Tools and ACI](tools-and-aci.md) - Designing a tool surface a strange user gets right on the first try.
* [MCP integration](mcp-integration.md) - When not to write the tool yourself, and the lifecycle trade-off.

# Orchestration

* [Workflow](workflow.md) - Deterministic steps that may call an LLM, and the only durable execution here.
* [Squad and subagents](squad-and-subagents.md) - Sequential teams and delegation for context isolation.

# Reliability and security

* [Failure taxonomy](failure-taxonomy.md) - Six failure classes and the right response to each.
* [Limits and budgets](limits-and-budgets.md) - Ceilings that do not depend on the model cooperating.
* [Permissions](permissions.md) - First matching rule wins, fail-closed, evaluated without an LLM.
* [Guardrails](guardrails.md) - Input and output processors, and the accounting asymmetry between them.

# State

* [State, sessions and memory](state-sessions-memory.md) - Four kinds of state and the right mechanism for each.
