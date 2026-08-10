---
type: Design Guide
title: Tools and ACI
description: Designing a tool surface for a consumer that reads fast, never asks, and hallucinates on ambiguity — including the model-facing / app-facing split almost nobody makes.
tags: [api, tools, aci, design, zod, security]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 5, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 5 — tools and ACI
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: types
    resource: packages/sdk/src/types/ (DefineToolSpec, SendOptions)
    title: Tool and SendOptions types — verified at @theokit/sdk@4.36.0 on 2026-07-30
---

# ACI is interface design — for a strange user

You design UI for humans. Now design for a consumer that reads fast, never asks a question,
has no memory between sessions, and hallucinates when a description is ambiguous.

> **Every tool failure is, first, a hypothesis of interface failure.**

Before blaming the model, check:

| Symptom | Likely cause in the interface |
| --- | --- |
| Never calls the tool | the description does not describe the trigger ("when to use") |
| Calls the wrong one | two semantically adjacent names |
| Invalid arguments | schema with no `.describe()`, no example, or loose types |
| Repeats the same call | the error message does not say **what to do differently** |
| Ignores the result | verbose return with the answer not at the front |

# The minimal tool

```typescript
import { Agent, Tool } from "@theokit/sdk";
import { z } from "zod";

const getWeather = Tool.create({
  name: "get_weather",
  description: "Look up the current weather in a given city.",
  inputSchema: z.object({
    city: z.string().describe("City name, e.g. 'Tokyo' or 'Brasília'."),
  }),
  async handler({ city }) {
    const mock: Record<string, string> = { Tokyo: "18°C, cloudy", London: "12°C, raining" };
    return mock[city] ?? `No weather data for ${city}.`;
  },
});
```

Zod is not decoration: the schema becomes JSON Schema for the model **and** runtime
validation before the handler. An invalid argument never reaches your code — it reaches the
model as `tool_result(isError)`, which the model can correct.

# The split almost nobody makes: model-facing vs app-facing

The full `DefineToolSpec`:

```typescript
Tool.create({
  name: string,
  description: string,
  inputSchema: ZodType,          // → JSON Schema for the model + runtime validation
  outputSchema?: ZodType,        // validates the handler's return
  handler: (input, ctx?) => ..., // ctx: { signal?, context?, threadId? }
  toModelOutput?: (output) => string | ToolResultContentBlock[],
  sanitize?: boolean | SanitizeOptions,
});
```

`toModelOutput` is the most underrated member of that set:

```typescript
const fetchOrder = Tool.create({
  name: "fetch_order",
  description: "Fetch an order by id. Returns status and total.",
  inputSchema: z.object({ orderId: z.string() }),
  outputSchema: z.object({
    id: z.string(),
    status: z.string(),
    total: z.number(),
    lineItems: z.array(z.object({ sku: z.string(), qty: z.number(), price: z.number() })),
    auditTrail: z.array(z.string()),
  }),
  async handler({ orderId }) {
    return await db.orders.findFull(orderId); // full object — the app needs it
  },
  // The MODEL only needs the essentials. 200 line items do not help it decide.
  toModelOutput: (o) => `order ${o.id}: ${o.status}, total ${o.total}, ${o.lineItems.length} items`,
});
```

One handler execution, **two destinations**: the model's `tool_result` gets the compact line;
observability (`onToolEnd.result`) gets the full object. Without this you choose between
polluting context and losing data in the application — and teams normally choose to pollute
context, then pay for it on every subsequent iteration (see the cost arithmetic in
[the agent loop](/concepts/agent-loop.md)).

> **Framework-independent principle:** *what the model sees and what the application stores
> are different requirements; a design that fuses them forces a false trade-off.*

The same principle produces three separate
[observation channels](/sdk/observation-channels.md).

# Tool errors are prompt content

```typescript
import { ToolError } from "@theokit/sdk";

// Bad — the model has nothing to do with this.
throw new Error("failed");

// Good — says what happened AND what to try next.
throw new ToolError(
  "Order 'abc' not found. Order ids look like 'ORD-12345'. Ask the user to confirm the id."
);
```

Rule: **every tool error message is an instruction for the next iteration.** If it does not
suggest a different action, you just bought a [doom loop](/concepts/doom-loop.md).

# Restricting the toolset at runtime

An agent with 40 tools chooses badly and pays for all 40 schemas on every iteration. Controls
available per send:

```typescript
await agent.send("Only read and summarize; do not modify anything.", {
  activeTools: ["read_file", "search_text"], // vetoed at dispatch, not "requested" in the prompt
  toolChoice: "auto",                        // "none" forces text; "required" forces a tool
  perToolTimeoutMs: 15_000,                  // a stuck tool does not stall the run
  toolResultGuard: { delimit: true },        // mitigates injection via tool output
  maxIterations: 12,
});
```

A distinction worth a code-review note: `activeTools` is **enforcement at dispatch**; asking
in the prompt is a **suggestion**. Security that depends on the model obeying is not security
— see [attack surface](/concepts/attack-surface.md), where `toolResultGuard` gets its own
treatment as the indirect-injection mitigation.

# Mastery criterion

You audit a tool's interface and produce a prioritized fix list — separating what is a
*description* problem, a *schema* problem, a *return* problem and an *error message*
problem.[^course]

[^course]: Agent AI course, Module 5
