---
"@theokit/sdk": minor
---

`discoverSubagents` can read a declared foreign dialect, closing an asymmetry against the agent's own registry

`#524` made foreign configuration opt-in and reached the agent's subagent registry — which resolves
through `settingSources` + `compatSources` — but not `discoverSubagents`, the public selector over
the same material. The reader underneath already accepted `compatSources`; this entry point simply
never passed it.

Measured by the `theocode` session on `5.0.1`, both arms in fresh trusted directories with the same
task:

```
roles in .theokit/agents/            delegate_to_team works
the SAME files in .claude/agents/    "the `explorer` role is not configured"
```

So a repository adopting the product could **delegate to** a `.claude/agents/` subagent by name and
could **not define its team's roles** there. One dialect, two answers, depending on which selector
asked.

```ts
await discoverSubagents(cwd, { compatSources: ["claude-code"] });
```

`compatSources` is a **separate option from `settingSources`**, deliberately. That one answers
*which sources* (project, and one day user or team); this one answers *which dialects* within them.
Folding `"claude-code"` into `SubagentSource` would conflate two orthogonal axes, and the internal
loader has kept them apart since `#524` for exactly that reason.

**The opt-in still holds**: with nothing declared, `.claude/agents/` is not read. That is covered by
a test whose only job is to fail if the option ever became a no-op.

`CompatSourceDeclaration` is re-exported from `@theokit/sdk/subagents-loader` for the same reason
`AgentDefinition` is — an option whose type is unreachable is an option only `any` can call.
