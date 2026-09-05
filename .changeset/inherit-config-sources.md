---
"@theokit/sdk": patch
---

`local.compatSources` survives delegation and resume (#578)

`#524` added `compatSources` to `AgentOptions["local"]`, so a project can declare that `.claude/`
hooks, skills, subagents and plugins may be read. Two places carry a parent's `local` config across
a hop, and **neither was updated**:

| Carrier | Was missing |
|---|---|
| `buildChildCreateOptions` — parent → delegated child | `settingSources`, `compatSources` |
| `serializeLocal` — agent → registry → resumed agent | `compatSources` |

So a parent declaring `compatSources: ["claude-code"]` read `.claude/agents/` and its delegated
child did not: a team could delegate TO a role by name while the child could not resolve the rest of
the team. And an agent resumed from the registry silently stopped reading the surfaces it was
created to read.

Both the field and the code that carries it landed on the same day, which is what an omission looks
like rather than a decision — and `serializeLocal` documents the one inclusion that *was* decided,
right beside the gap.

**Inheriting is safe here, and it is the opposite direction from every other inherited field.** The
others hand down a restriction (the sandbox posture, the permission plugins) and the hazard is a
child escaping it. Here the child is *more* restricted than its parent, so the failure is a missing
capability rather than an open door. Inheritance cannot widen: the child gets what the parent
already resolved and runs in the parent's cwd, so it reaches no directory the parent could not. A
role's explicit value still wins.

**The one hazard in the fix, since it is the kind that trades a bug for a worse bug:**
`buildChildCreateOptions` used to write `local` whole from the sandbox posture alone, so adding a
second `local` spread beside it would have silently dropped that posture — turning a
missing-capability defect into a default-open one. `local` is now accumulated once from all three
contributors, and a test asserts the sandbox posture survives inheritance.

Reported by the `theocode` session. Its measurement also narrowed who is affected: a consumer that
rebuilds agent options per invocation never reaches `serializeLocal` and is exposed only to the
delegation half.
