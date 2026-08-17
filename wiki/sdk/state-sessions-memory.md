---
type: API Guide
title: State, sessions and memory
description: The four kinds of agent state and the right mechanism for each, the native Claude Code transcript format, the pluggable SessionStore, and memory hygiene.
tags: [api, state, sessions, memory, persistence, interop]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 8, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 8 — state, sessions and memory
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: types
    resource: packages/sdk/src/types/session-store.ts
    title: SessionStore contract — verified at @theokit/sdk@4.36.0 on 2026-07-30
---

# Four kinds of state

The map that prevents most architecture errors in this area:

| Kind | Scope | Mechanism here | Lost on restart? |
| --- | --- | --- | --- |
| **Run state** | one submission | loop variables | yes — and that is fine |
| **Conversation** | many turns, one agent | session transcript | **no** |
| **Memory** | many agents / sessions | `memory: { ... }` | no |
| **Business state** | your domain | **your database** | no |

> **The classic architecture error:** using agent memory as the business database. Memory is
> approximate recall optimized for relevance — it is not a system of record. Account balance,
> order status and user permission live in your database. **If the right answer must be
> *exact*, it does not come from semantic recall: it comes from a tool that queries the source
> of truth.**

Row 1 is also the [durability boundary](/concepts/durability-boundary.md): run state dies,
conversation survives, and nothing in between resumes an execution.

# Sessions — the native transcript

Every local agent writes a transcript in Claude Code's native format:

```
<sessionDir>/projects/<encoded-cwd>/<agentId>.jsonl  # default sessionDir: ~/.theokit
```

```typescript
const agent = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  local: {
    cwd: process.cwd(),
    sessionDir: "~/.claude", // writes where the Claude Code CLI can --continue it
  },
});
```

This is an **exit-cost reduction** play: the conversation your agent produced can be continued
in another tool. An open format is an architectural property, not an implementation detail —
the kind of thing a Staff engineer weighs when choosing a stack. It is axis 6 in
[framework comparison](/ecosystem/framework-comparison.md).

Resume and external store:

```typescript
const same = await Agent.resume(agentId, { apiKey, model: { id: "openai/gpt-4o-mini" } });

// Serverless / multi-host: the local FS is not a resume source.
const agent2 = await Agent.create({
  apiKey, model: { id: "openai/gpt-4o-mini" },
  local: { cwd: process.cwd(), sessionStore: myPostgresSessionStore },
});
```

The pluggable `SessionStore` is the answer to the real case "my pod does not have the previous
pod's disk". Recognize the pattern: **when a mechanism assumes local disk it breaks in
serverless — and the fix is a port (an interface), not a hack.** The record stays in the
native format, so interoperability survives the substitution.

Maintenance operations: `Agent.compact(...)` compacts the transcript;
`Agent.injectSessionTurn(...)` inserts a synthetic turn, useful for context seeding and tests.

Re-rendering a resumed session as tool **cards** rather than prose uses `Agent.transcript(id)`,
whose `parts` keep the call id, tool name, arguments and the `toolUseId` correlating a result
back to its call.

# Memory

```typescript
const agent = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  local: { cwd: "./.memory" },
  memory: {
    enabled: true,
    namespace: "support",
    userId: "user-42",
    scope: "user",           // "agent" | "user" | "team"
    autoInject: true,        // injects a <memory> block into the system prompt
    index: {
      tools: true,           // registers memory_search / memory_get for the model
      backend: "sqlite-vec", // or "lance" for scale
      embedding: { provider: "openai" },
    },
  },
});
```

Two recall modes, and the difference is architectural:

* **automatic** (`autoInject`) — the SDK injects relevant facts before the call. Fixed cost
  per turn; the model need not know memory exists.
* **by tool** (`index.tools`) — the model decides to search. Variable cost; depends on the
  model remembering to search.

Choose by access profile: a small, almost-always-relevant fact ⇒ inject. A large, occasional
body ⇒ tool. This is exactly the inject-vs-retrieve reasoning from
[context engineering](/concepts/context-engineering.md), applied to another substrate — which
is how theory becomes a decision.

# Memory hygiene — the part tutorials omit

Memory grows, and **wrong memory is worse than absent memory, because it is confidently
wrong.** A system with memory needs three policies:

- [ ] **Write** — what deserves to be remembered?
- [ ] **Correction** — how do you fix a fact that became false?
- [ ] **Expiry** — when does a fact stop counting?

Without them, in six months the agent acts on something that stopped being true. Note that
this is the same lifecycle discipline this bundle applies to its own concepts via
`stale_after`.

# Mastery criterion

You design a production agent's state by classifying each piece of information into the four
kinds and justifying the mechanism — **including what must not live in memory**.[^course]

[^course]: Agent AI course, Module 8
