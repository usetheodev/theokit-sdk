---
"@theokit/sdk": patch
---

Per-subagent config (M33) review fixes.

- **Sandbox is no longer default-open.** A delegated child of a sandboxed parent now inherits the parent's shell-sandbox posture unless its role opts out; `AgentDefinition.sandbox` absent ⇒ inherit (as documented), `sandbox: false` explicitly confines-off, `sandbox: true` confines-on. Previously a child ran unsandboxed whenever its role omitted `sandbox` — a default-open the wiring exists to prevent.
- **`model: inherit` + `reasoning_effort` is now a typed load error** instead of silently dropping the effort (the inherited model id is unknown at load, so the `thinking` param has nothing to attach to).
- **`tools` and `sandbox` now survive persist→resume** for inline subagents (`serializeAgents`); dropping them was a default-open on resume (a confined child came back unconfined). The model's reasoning `params` are persisted too. `mcpServers` stays stripped (may carry secrets).
- **Quoted `model`/`reasoning_effort` scalars are stripped** (`model: "openai/gpt-4o"`), which previously passed validation and failed only at the provider.

Note on the 4.6.0 loader: rejecting unknown/unsupported frontmatter fields is a fail-closed **contract narrowing** (pre-4.6.0 silently dropped them), not a pure addition. Every subagent role in the ecosystem uses only accepted fields, so there is no known real-world break, and the failure is a diagnosable typed `ConfigurationError` — but downstreams pinned to `^4.5` whose roles carried extra keys should be aware.
