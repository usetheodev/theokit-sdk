---
type: API Guide
title: Agent, Run and SDKMessage
description: The three core objects, their lifecycles, the three ways to invoke, and the Run surface including the capability query that keeps local and cloud honest.
tags: [api, agent, run, lifecycle, streaming]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 4, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 4 — Agent, Run, SDKMessage
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: types
    resource: packages/sdk/src/types/
    title: Exported types — verified at @theokit/sdk@4.36.0 on 2026-07-30, not re-verified since
---

# The three concepts

| Concept | What it is | Lifecycle |
| --- | --- | --- |
| **Agent** | durable container: configuration, tools, session, memory | lives across many prompts; needs `dispose()` |
| **Run** | one prompt submission | has its own stream, status, result and cancellation |
| **SDKMessage** | a normalized stream event | discriminated union on `type` |

Mental model: **the Agent is the process; the Run is the request.**

# The minimal path

```typescript
import { Agent } from "@theokit/sdk";

const agent = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  name: "explainer-bot",
  systemPrompt: "You are a concise assistant. Answer in at most two sentences.",
  local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
});

const run = await agent.send("What is an AI agent? Answer for a developer.");
const result = await run.wait();

console.log(result.status, result.result);

await agent.dispose();

// A run that did not finish is a failure — do not treat it as green.
if (result.status !== "finished" || typeof result.result !== "string" || result.result.length === 0) {
  console.error("run did not finish:", JSON.stringify(result.error ?? result.status));
  process.exit(1);
}
```

Three things in that snippet are **discipline**, not ceremony:

1. `await agent.dispose()` — the agent holds resources (MCP clients, session handles).
   Leaking that in a long-running server is a process leak. Put it in a `finally`.
2. The final validation — `status: "finished"` is the **only** success condition. Code that
   just does `console.log(result.result)` lies when the run fails. See
   [loop terminals](/concepts/loop-terminals.md).
3. `sandboxOptions: { enabled: false }` — explicit. In production you make that decision
   consciously.

# The three ways to invoke

```typescript
// (a) One-shot: create, run, discard. For scripts and CI.
const text = await Agent.prompt("Summarize this repository", {
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  local: { cwd: process.cwd() },
});

// (b) Conversational: the agent retains context between sends.
const run1 = await agent.send("Find the bug in src/auth.ts");
await run1.wait();
const run2 = await agent.send("Fix it and add a regression test"); // context retained
await run2.wait();

// (c) Structured output: tool loop + final schema coercion via Zod.
import { z } from "zod";
const { object } = await agent.generate("Extract the PR data", {
  output: z.object({ title: z.string(), risk: z.enum(["low", "high"]) }),
});
```

**When to use which:** `Agent.prompt` for a single task with no continuity; `send` when there
is a conversation or multiple turns; `generate` when the output feeds code — never parse free
text when a schema exists.

# The Run surface

```typescript
interface Run {
  readonly id: string;
  readonly agentId: string;
  readonly status: "running" | "finished" | "error" | "cancelled";
  readonly result?: string;
  stream(): AsyncGenerator<SDKMessage, void>;
  wait(): Promise<RunResult>;
  cancel(): Promise<void>;
  conversation(): Promise<ConversationTurn[]>;
  supports(operation: RunOperation): boolean;
  unsupportedReason(operation: RunOperation): string | undefined;
  onDidChangeStatus(listener: (status: RunStatus) => void): () => void;
}
```

`supports()` / `unsupportedReason()` deserve attention: they exist because local and cloud
**do not have the same capability**. It is the honest alternative to two worse options —
lying (accept and ignore) or exploding without explanation.

> **Reusable pattern:** when a contract spans heterogeneous runtimes, expose the capability
> query **and** a readable reason for the absence.

The same reasoning explains why `runUntil`, `runToCompletion`, `fork`, `streamToCompletion`,
`invalidateCache` and `usePersonality` are declared **optional** on `SDKAgent` and appear
with `?.` throughout this bundle — see [precision notes](/project/precision-notes.md).

# Streaming

```typescript
const run = await agent.send("Tell a story in two sentences.");

for await (const msg of run.stream()) {
  switch (msg.type) {
    case "assistant":
      for (const block of msg.message.content) {
        if (block.type === "text") process.stdout.write(block.text);
        else if (block.type === "tool_use") console.log(`\n[tool_use] ${block.name}`);
      }
      break;
    case "tool_call":
      console.log(`\n[calling tool] ${msg.name}`);
      break;
    default:
      break; // "system" | "user" | "thinking" | "status" | ...
  }
}

// After draining the stream, wait() resolves the terminal RunResult.
const result = await run.wait();
```

Reading shortcut, so you do not walk blocks by hand:

```typescript
import { assistantText, extractToolUses, costAmountUsd } from "@theokit/sdk/messages";

for await (const msg of run.stream()) {
  const text = assistantText(msg);
  if (text !== undefined) process.stdout.write(text);
}
```

> `costAmountUsd` returns `undefined` when cost is unknown — **never `0`**. That is an
> honesty decision: unknown cost reported as zero corrupts every financial dashboard. Worth
> copying into your own code; the principle is developed in
> [cost management](/operations/cost-management.md).

`run.stream()` is one of three observation channels, and picking the wrong one is a design
error that shows up in production — see [observation channels](/sdk/observation-channels.md).

# Mastery criterion

You can explain to a colleague why three observation channels exist, and give an example of a
bug that appears when the wrong one is used.[^course]

[^course]: Agent AI course, Module 4
