---
type: API Guide
title: MCP integration
description: When not to write the tool yourself, and the mcpLifecycle trade-off presented as a template for how to write an explicit architectural decision.
tags: [api, mcp, tools, integration, trade-off]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 5.6, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 5.6 — MCP, when not to write the tool
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: mcp-client
    resource: packages/sdk/src/internal/mcp/client.ts
    title: MCP client — session lifecycle and initialize idempotence
---

# What it is

MCP (Model Context Protocol) is the standard protocol for out-of-process tool servers. Using
one is [parsimony ladder](/concepts/parsimony-ladder.md) rung 4 applied to tools: before
writing an integration, check whether one already exists.

# The choice

| Situation | Choice |
| --- | --- |
| Your logic, in your process, typed | `Tool.create` |
| Ready third-party integration (GitHub, Slack, DB) | MCP server |
| You need process or permission isolation | MCP server |
| Latency-critical, trivial call | `Tool.create` |

```typescript
const agent = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  mcpServers: { github: { /* ... server config ... */ } },
  mcpLifecycle: "session", // pool per session; "run" (default) reconnects per send
  local: { cwd: process.cwd() },
});
```

# `mcpLifecycle` as a template for an explicit trade-off

This option is a textbook case of how to write a decision down, and it is worth copying into
your own ADRs:

| Option | Cost | Failure mode |
| --- | --- | --- |
| `"run"` (default) | pays a handshake per turn — the code's own docs record ~134–193 ms measured | simple: each send starts clean |
| `"session"` | eliminates the per-turn cost | **introduces a new state**: a server that dies mid-session |

Note the shape of the decision: **measured cost on one side, a new failure mode on the other,
and the default on the safe side.** That is what an
[architecture decision](/operations/architecture-decisions.md) should look like — not a
preference dressed as a conclusion.

The `"session"` failure mode is not hypothetical in this repository: a review found that
`initialize()` idempotence keyed on child liveness rather than handshake completion, so a
failed handshake under `'session'` left a spawned-but-uninitialized client that turn 2 never
retried. See finding H3 in
[review: issue-sweep 2026-08](/project/review-issue-sweep-2026-08.md) — closed, with a
regression test.[^mcp-client]

# What MCP does not change

An MCP tool is still a tool. Everything in [tools and ACI](/sdk/tools-and-aci.md) applies to
it, with one difference you do not control: **you did not write the description.** A
third-party server with a vague tool description produces the same "never calls the tool" and
"calls the wrong one" symptoms, and your only levers are `activeTools` and the system prompt.

And it is still untrusted output. An MCP server that fetches web content carries the same
indirect-injection risk as a local tool doing the same thing — see
[attack surface](/concepts/attack-surface.md).[^course]

[^course]: Agent AI course, Module 5.6
[^mcp-client]: `packages/sdk/src/internal/mcp/client.ts`
