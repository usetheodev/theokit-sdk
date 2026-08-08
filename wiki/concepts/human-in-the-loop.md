---
type: Pattern
title: Human in the loop
description: The two HITL seams in this SDK, the durability difference between them, and the approval screen that makes the decision informed rather than a rubber stamp.
tags: [hitl, permissions, workflow, durability, ux]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 2.6, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 2.6 — where the loop stops and the human decides
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: gaps
    resource: ROADMAP.md § Capability Gap Register, gap G4
    title: Durable typed HITL approval state — declared as not shipped
---

# The scenario

Not the human driving (turn-based) nor the human absent (closed loop) — the human as a
**gate on one irreversible action** inside a loop that stays autonomous otherwise.

A support agent resolves tickets on its own: looks up the order, computes eligibility,
replies to the customer. One of its tools **issues a refund** — it moves money, it is
irreversible, and policy says anything above R$ 500 needs an approver.

Translated to engineering: `issue_refund` must not execute without a human decision when
`amount > 500`; the rest of the loop stays autonomous.

# Two seams, different guarantees

The SDK offers two stopping points. **They are not interchangeable**, and the difference is
what causes incidents:

| | **Tool gate** | **Workflow suspend** |
| --- | --- | --- |
| Where it stops | before dispatching the tool | at a step boundary |
| Survives a restart? | **NO** — lives in memory | **YES** — writes a snapshot |
| What waits | a `Promise` pending in the process | nothing pending; the process may die |
| Realistic window | seconds to minutes | hours to days |
| How the human answers | same instance, over a live channel | any instance, via `runId` |
| Cost of getting it wrong | approval lost on deploy | — |

> **The rule:** if the approval can take longer than the life of your process, the tool gate
> is the wrong choice — no matter how convenient it looks.

# Seam A — tool gate (approval in seconds)

```typescript
import { Agent, PermissionEngine, PermissionPlugin, Tool } from "@theokit/sdk";
import { z } from "zod";

const issueRefund = Tool.create({
  name: "issue_refund",
  description: "Issue a refund for an order. Irreversible.",
  inputSchema: z.object({
    orderId: z.string().describe("Order id, e.g. 'ORD-12345'."),
    amount: z.number().positive().describe("Refund amount in BRL."),
  }),
  async handler({ orderId, amount }) {
    await payments.refund(orderId, amount); // already authorized by the time we get here
    return `refunded ${amount} on ${orderId}`;
  },
});

// 1) The policy is deterministic and testable WITHOUT an LLM.
const engine = new PermissionEngine([
  { tool: "issue_refund", action: "ask" },  // "ask" = needs a decision
  { tool: /^(get|list)_/, action: "allow" },
]);

// 2) The gate resolves the "ask". No gate on an "ask" ⇒ fail-closed block.
const gate = PermissionPlugin.create(engine, {
  mode: "default",
  canUseTool: async (toolName, input, ctx) => {
    const amount = Number(input.amount ?? 0);
    if (amount <= 500) return { behavior: "allow" };   // policy decides alone below the limit

    const decision = await approvals.request({
      toolName, input, mode: ctx.mode, timeoutMs: 120_000,
    });

    return decision.approved
      ? { behavior: "allow" }
      : { behavior: "deny", message: `Refund denied by ${decision.by}: ${decision.reason}` };
  },
});
```

Three properties worth more than the code:

1. **The `deny` message goes back to the model.** It is not a log — it is the loop's next
   observation. "Denied by João: customer was already refunded in March" makes the agent
   explain that to the customer; a mute `deny` makes it try again.
2. **`deny` does not kill the run.** The loop continues with that information. It is policy,
   not error — see [loop terminals](/concepts/loop-terminals.md).
3. **Without a gate, an `ask` blocks.** The default is deny, not pass. A system that "opens
   up when the UI is down" is not a gate.

Observe it out of band with the typed event:

```typescript
const run = await agent.send("Customer wants a refund on ORD-991", {
  onRunEvent: (ev) => { if (ev.type === "permission_denied") audit.record(ev); },
});
```

# Seam B — workflow suspend (approval in hours or days)

If the manager only approves tomorrow, nothing may hang in memory. The stop is a step
boundary and the state goes to disk:

```typescript
import { Workflow, fn } from "@theokit/sdk/workflow";

const refundFlow = Workflow.create({ name: "refund-approval" })
  .then(fn("evaluate", async (ticket: { orderId: string; amount: number }) => ticket))
  .then(
    fn("gate", async (ticket, ctx) => {
      const t = ticket as { orderId: string; amount: number };
      if (t.amount <= 500) return { approved: true, by: "policy", automatic: true };

      // Writes a snapshot and STOPS. `suspend` returns Promise<never>: nothing below runs.
      await ctx.suspend({ awaiting: "human-approval", ...t });
      return { approved: false }; // unreachable — the sentinel ends the step
    }),
  )
  .then(
    fn("execute", async (decision) => {
      const d = decision as { approved: boolean; by?: string };
      return d.approved ? "refund issued" : `refund denied by ${d.by ?? "human"}`;
    }),
  )
  .commit();

// --- process 1: the ticket arrives ---
const run = await refundFlow.run({ orderId: "ORD-991", amount: 1200 });
console.log(run.status); // "suspended"
await approvalQueue.enqueue({ runId: run.id, orderId: "ORD-991", amount: 1200 });

// --- hours later, ANOTHER process (a deploy in between, doesn't matter) ---
const resumed = await Workflow.resume({
  runId: request.runId,
  workflow: refundFlow,
  payload: { approved: true, by: "manager@company.com" },
});
console.log(resumed.status, resumed.output); // "completed" · "refund issued"
```

The `runId` is the **entire contract** between the agent and the human interface. It is what
you enqueue, show on screen and receive back — not a live object, not a callback: an
identifier that survives a restart.

> **Honesty about the guarantee (gap G4).** The suspend is durable, but the payload is
> `unknown` — there is no **typed** approval state (`pending`/`approved`/`denied`/
> `invalidated`) maintained by the SDK. You model that in your own table. And the Seam A gate
> **is not durable**: it dies with the process. Describing the tool-gate HITL as durable is
> the error this project's `CLAUDE.md` explicitly forbids. See
> [capability gaps](/project/capability-gaps.md) and
> [durability boundary](/concepts/durability-boundary.md).[^gaps]

# The human interface

What the SDK delivers is the stopping point. The bridge to the screen is yours, and it has a
different shape per seam.

**Seam A** — a `Promise` is waiting in *this* process, so the channel must be live and the
same instance must receive the answer:

```
[agent]  canUseTool()  ─── request ──▶  [server]  ── SSE/WebSocket ──▶  [UI]
                                            ▲                            │
   pending Promise                          └────── POST /approve ───────┘
   (same instance, with a timeout)
```

**Seam B** — nothing is pending. The UI reads your table and calls `resume`; any instance
will do:

```
[workflow] ──▶ status "suspended" + runId ──▶ [approvals table] ──▶ [UI lists pending]
                                                     ▲                       │
                                        Workflow.resume({runId, payload}) ◀───┘
```

What the screen must show, in both cases — and each item exists for a reason:

| Element | Why |
| --- | --- |
| **The exact action** (`issue_refund`, ORD-991, R$ 1,200) | approving without seeing the argument is rubber-stamping |
| **Why it stopped** (`ask` rule + amount over R$ 500) | the human needs to know which policy fired |
| **Agent context** (what it concluded so far) | without this the decision is blind |
| **Approve / Deny + a reason field** | the reason goes back to the model on `deny` and becomes the audit trail |
| **Time remaining** (Seam A) | makes it explicit that silence means denied |
| **Who decided and when** | audit; mandatory in a financial flow |

Three traps that always appear on this screen:

- **A timeout that approves.** If nobody answers, the answer is *no*. A gate that opens out
  of fatigue is not a gate — and the SDK's internal `HitlMiddleware` follows the same rule
  (failure ⇒ deny).
- **Approving without showing the argument.** A card saying "the agent wants to use
  `issue_refund`" without the amount trains the human to click yes.
- **A button that returns no reason.** On `deny` the `message` is the model's next
  observation. Denying silently produces a retry — you just bought a
  [doom loop](/concepts/doom-loop.md) with human participation.

# Choosing the seam

| Situation | Seam | Why |
| --- | --- | --- |
| Operator watching live, decides in seconds | **A** — gate | simplest, no persistence |
| Asynchronous approval (manager, compliance, another shift) | **B** — suspend | survives restart and deploy |
| Serverless / multi-pod | **B** | no stable process to hold the Promise |
| The action is reversible and cheap | **neither** | a deterministic rule settles it |
| Need both (auto to R$ 500, human above) | A **or** B with the cut in the gate | the threshold is policy, not HITL |

**Rule of thumb:** the tool gate is for *interrupting*; the workflow suspend is for
*scheduling a decision*. Confusing them is like using an in-memory variable where the
requirement asked for a database.

[^course]: Agent AI course, Module 2.6
[^gaps]: ROADMAP.md § Capability Gap Register, G4
