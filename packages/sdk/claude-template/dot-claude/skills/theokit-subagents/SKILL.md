---
user-invocable: false
paths:
  - "**/*subagent*"
  - "**/*a2a*"
  - "**/*delegat*"
description: TheoKit SDK subagents — @theokit/sdk/a2a (SubAgent.create, AgentMailbox, MessageBus, delegation hooks) and @theokit/sdk/subagents (subagentToolWhitelist, withSubagentToolScope)
---

# TheoKit SubAgents

Two subpaths cover delegation. `@theokit/sdk/a2a` builds a child agent invocable as
a tool plus the in-process message bus; `@theokit/sdk/subagents` scopes which tools a
subagent may call.

```typescript
import {
  SubAgent,
  AgentMailbox,
  MessageBus,
  MaxDelegationDepthError,
  type SubAgentSpec,
} from "@theokit/sdk/a2a";
import { subagentToolWhitelist, withSubagentToolScope } from "@theokit/sdk/subagents";
```

## `SubAgent.create` — delegation as a tool

`SubAgent.create(spec, parentDepth?)` returns a `CustomTool`. When the LLM invokes it,
a child agent runs the input as a message. Depth is tracked — exceeding
`maxDelegationDepth` throws `MaxDelegationDepthError`.

```typescript
const researcher = SubAgent.create({
  name: "researcher",
  description: "Delegate research questions to a focused child agent",
  instructions: "You research topics and return a concise summary.",
  model: "google/gemini-2.0-flash-001",
  tools: [],                 // CustomTool[] the child may use
  maxDelegationDepth: 3,
  onDelegationStart: (ctx) => {
    if (ctx.iteration > 5) return { proceed: false, rejectionReason: "too many calls" };
    return { proceed: true };
  },
  onDelegationComplete: (ctx) => {
    if (ctx.result) return { feedback: "(reviewed)" };
  },
});

const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
  tools: [researcher],
});
```

`SubAgentSpec` also supports `messageFilter` (opt-in parent-context forwarding, off by
default so memory isolation stays the default) and `includeToolResults` (append the
child's tool results, otherwise text-only).

## Inline subagents on `Agent.create`

Simple cases need no `SubAgent.create` — declare them inline:

```typescript
const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
  agents: {
    reviewer: {
      description: "Reviews code for bugs",
      prompt: "You are a strict code reviewer.",
      model: "google/gemini-2.0-flash-001",
    },
  },
});
```

## Tool scoping — `withSubagentToolScope`

`subagentToolWhitelist(definition)` derives the allowed tool-name `Set` (or `undefined`
when unscoped) from `definition.tools`. `withSubagentToolScope` runs a fn under that
whitelist so a `tools: ["read_file"]` subagent provably cannot call `write_file`.

```typescript
const whitelist = subagentToolWhitelist({ tools: ["read_file"] }); // Set(["read_file"])

await withSubagentToolScope({ tools: ["read_file"] }, async () => {
  // dispatch veto enforces the whitelist here
});
```

## Agent-to-agent messaging

```typescript
const bus = new MessageBus();
const alice = new AgentMailbox("alice", bus);
const bob = new AgentMailbox("bob", bus);

bob.onMessage(async (msg) => ({ type: "ack", payload: { ok: true } }));

await alice.send("bob", { type: "greet", payload: { text: "hi" } });
const reply = await alice.request("bob", { type: "ping", payload: null }, { timeoutMs: 1000 });

alice.dispose();
bob.dispose();
```
