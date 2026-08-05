---
"@theokit/sdk": minor
---

New `Agent.describe(agentId)` — read-only introspection of a registered agent (theokit#123).

`Agent.list()` / `Agent.get()` enumerate agents and `agent.skills.list()` covers skills, but a
registered agent's tools and subagents were reachable only through the internal registry record. A
reflection endpoint — theokit-studio's `theokit dev` — had no way to report them, so it degraded to
`tools: []` / `workflows: []` with an `unavailable_reason`.

`describe` returns `{ agentId, runtime, model?, tools, subagents }`. Tools carry `name`,
`description` and the `inputSchema` the model is sent; subagents carry `name`, `description`, their
`model` and their tool whitelist.

It is a projection, not the options object: tool handlers and subagent prompts are stripped. A
handler is an executable that cannot cross a process boundary, and a prompt is the agent's
instructions rather than its signature — a reflection endpoint serializes whatever it is handed.

`tools` and `subagents` are always arrays, so a caller can distinguish "this agent has none" from
"the SDK did not say". An unknown agent throws `UnknownAgentError` rather than returning an empty
description, which would be indistinguishable from a real agent with nothing registered.

`AgentDescription`, `AgentToolDescription` and `AgentSubagentDescription` are exported from the
package barrel.
