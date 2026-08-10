---
type: Checklist
title: Pitfalls
description: The recurring traps across the whole agent lifecycle, each paired with its antidote and the concept that explains it.
tags: [review, checklist, anti-patterns]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Appendix C and per-module Armadilhas, absorbed into this bundle 2026-08-06
    title: Agent AI course, Appendix C — pitfalls by module
    author: human:paulohenriquevn
    last_modified: 2026-07-30
---

# The table

Use this in code review. Each row is a real failure, not a hypothetical.

| Pitfall | Antidote | Where it is explained |
| --- | --- | --- |
| An agent where a workflow fit | the determinism ladder | [determinism ladder](/concepts/determinism-ladder.md) |
| Calling everything that uses an LLM an "agent" | the definition table | [what is an agent](/concepts/what-is-an-agent.md) |
| Multi-agent before a single agent works | climb one rung, with justification | [determinism ladder](/concepts/determinism-ladder.md) |
| Treating non-determinism as a bug rather than a property to contain | limits, not hope | [limits and budgets](/sdk/limits-and-budgets.md) |
| Ignoring silent truncation | read `stoppedAtIterationLimit` | [loop terminals](/concepts/loop-terminals.md) |
| Raising `maxIterations` to cure a doom loop | investigate the tool's error message | [doom loop](/concepts/doom-loop.md) |
| Stacking context until it overflows | the four budget operations | [context engineering](/concepts/context-engineering.md) |
| Believing a bigger window replaces curation | quality degrades before the limit | [context engineering](/concepts/context-engineering.md) |
| Putting raw tool output in context "so as not to lose information" | truncate at the source, `toModelOutput` | [tools and ACI](/sdk/tools-and-aci.md) |
| Compacting without preserving the current goal | a confident amnesiac | [context engineering](/concepts/context-engineering.md) |
| A skill description written for a human rather than for the trigger | the description *is* the retrieval mechanism | [context engineering](/concepts/context-engineering.md) |
| Forgetting `dispose()` on a server | `finally` on every exit path | [agent, run and SDKMessage](/sdk/agent-run-sdkmessage.md) |
| Treating `cancelled` as an error | separate the terminals; do not alert | [loop terminals](/concepts/loop-terminals.md) |
| Parsing free text when `agent.generate` + Zod exists | use the schema | [agent, run and SDKMessage](/sdk/agent-run-sdkmessage.md) |
| Assuming cloud supports whatever local supports | consult `supports()` | [agent, run and SDKMessage](/sdk/agent-run-sdkmessage.md) |
| A generic tool name (`process`, `handle`, `do_stuff`) | name the trigger | [tools and ACI](/sdk/tools-and-aci.md) |
| A tool error with no actionable instruction | the message is the next observation | [tools and ACI](/sdk/tools-and-aci.md) |
| Returning giant JSON to the model out of laziness | `toModelOutput` | [tools and ACI](/sdk/tools-and-aci.md) |
| Trusting a prompt to restrict tools | `activeTools` is dispatch-level enforcement | [tools and ACI](/sdk/tools-and-aci.md) |
| Treating tool output as trusted | `toolResultGuard: { delimit: true }` | [attack surface](/concepts/attack-surface.md) |
| Calling the agent loop "durable" | durability only at `suspend()` | [durability boundary](/concepts/durability-boundary.md) |
| A subagent used for a "role" with no context gain | the reason is window isolation | [squad and subagents](/sdk/squad-and-subagents.md) |
| A graph where a list would do | is it a line? then it is a squad | [determinism ladder](/concepts/determinism-ladder.md) |
| Retrying a permanent error | `isTransientError` | [failure taxonomy](/sdk/failure-taxonomy.md) |
| Security by prompt | enforcement at dispatch | [attack surface](/concepts/attack-surface.md) |
| Screening only the first network hop | re-validate at every boundary crossing | [attack surface](/concepts/attack-surface.md) |
| Mixing import entries and breaking `instanceof` | pick one entry for errors, consistently | [failure taxonomy](/sdk/failure-taxonomy.md) |
| A timeout that approves | silence means denied | [human in the loop](/concepts/human-in-the-loop.md) |
| Approving without showing the argument | that trains the human to click yes | [human in the loop](/concepts/human-in-the-loop.md) |
| Memory used as the business database | the source of truth is your database | [state, sessions and memory](/sdk/state-sessions-memory.md) |
| Writing everything to memory "so as not to lose it" | write / correction / expiry policy | [state, sessions and memory](/sdk/state-sessions-memory.md) |
| Assuming local disk in serverless | a port (interface), not a hack | [state, sessions and memory](/sdk/state-sessions-memory.md) |
| Choosing a framework by popularity | the six-axis matrix | [framework comparison](/ecosystem/framework-comparison.md) |
| Eval with only the happy path | negative cases are mandatory | [evaluation](/operations/evaluation.md) |
| Reporting unknown cost as zero | `undefined` is the honest value | [cost management](/operations/cost-management.md) |
| Building what belongs to another layer | ask the layer question first | [the layer question](/operations/layer-question.md) |
