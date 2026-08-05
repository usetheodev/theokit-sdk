---
"@theokit/sdk": minor
---

New `workflow.describe()` — a committed workflow can report its own shape (theokit#161).

Returns `{ name, steps }`, each step carrying its `id` and `kind` and recursing into `parallel`,
`branch`, `foreach` and `dowhile`. Executables a step holds — predicates, conditions, agents, prompt
templates — are omitted: they cannot cross a process boundary and say nothing about shape.

There is deliberately **no** `Workflow.list()`. A workflow is a value the caller constructs and
holds, so the caller already knows which ones exist; what it lacked was a way to describe one. A
registry would have added process-global state that nothing releases in order to re-answer a
question the host can answer itself, and coupling workflows to `AgentOptions` would tie together two
things that are independent today — a workflow runs perfectly well without an agent.

A reflection endpoint maps over its own workflows and calls this.
