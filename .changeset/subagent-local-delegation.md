---
"@theokit/sdk": minor
---

Subagent delegation now works end-to-end on the local runtime.

- **Declarative `agents: { name: AgentDefinition }` are wired locally.** Each definition is exposed to the supervisor as a delegation tool (previously honored only by the cloud/fixture runtimes). `def.prompt` becomes the child's instructions, `def.model` (or `"inherit"`) selects its model, and `def.tools` scopes it to that subset of the parent's tools.
- **Subagents inherit the parent's credentials automatically.** A delegated child now inherits the supervisor's `apiKey` and model, so it authenticates without repeating them. Previously `runChildAgent` created the child with no `apiKey`, so any parent using an explicit key (not `THEOKIT_API_KEY`) hit `AuthenticationError: Missing API key`. The parent's key is threaded only to first-party subagent tools — it never reaches third-party tool `ctx`.
- **Fixed the subagent tool schema.** `SubAgent.create` exposed a raw Zod object as its `inputSchema`; the LLM received a malformed parameter schema and emitted input that failed validation, so the delegation never ran. It now exposes a proper Draft-7 JSON Schema (validation still uses Zod internally).
