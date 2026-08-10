---
type: API Guide
title: Guardrails
description: Input and output processors that may block, the tripwire signal, and the accounting asymmetry that keeps a blocked output honest about cost.
tags: [security, guardrails, policy, pii, accounting]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 7.4, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 7.4 — guardrails
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: types
    resource: packages/sdk/src/types/ (inputProcessors, outputProcessors, RunResult.tripwire)
    title: Guardrail surface — verified at @theokit/sdk@4.36.0 on 2026-07-30
---

# The two edges

```typescript
const agent = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  inputProcessors: [/* normalize, validate, block before the LLM */],
  outputProcessors: [/* redact PII, block before it reaches the caller */],
  local: { cwd: process.cwd() },
});

const result = await run.wait();
if (result.tripwire !== undefined) {
  // Blocked by policy. status === "cancelled", NOT "error".
}
```

They sit on the two edges of [the agent loop](/concepts/agent-loop.md): input processors on
the entry edge, output processors on the exit edge.

Shipped in the tree: `UnicodeNormalizer` (normalization — mitigates homoglyphs and encoding
tricks) and `TokenLimiter`.

# A tripwire is not an error

`RunResult.tripwire` reports a policy block, and `status` is `cancelled`, never `error`.
Alerting on it is the same mistake as alerting on a user cancelling — see
[loop terminals](/concepts/loop-terminals.md). It is also available out of band as the
`RunEvent` type `tripwire`.

# The accounting asymmetry

This is the detail that reveals design care, and it is worth understanding rather than
memorizing:

| Blocked at | Was the model called? | `usage` / `cost` | `result` |
| --- | --- | --- | --- |
| **output** | yes | **preserved** — you were billed, the finance report must say so | suppressed |
| **input** | no | absent — nothing was spent | never produced |

Honesty is built into the type. It is the same principle as `costAmountUsd` returning
`undefined` rather than `0` — see [cost management](/operations/cost-management.md). A
guardrail that zeroed out `usage` on a block would make every spend dashboard quietly wrong.

# Where guardrails fit in the defense

Guardrails are one of six containments, not the whole story:

| Concern | Mechanism |
| --- | --- |
| Direct injection, PII on the way out | guardrails (this concept) |
| Indirect injection via tool output | `toolResultGuard: { delimit: true }` |
| Which tools may run at all | [permissions](/sdk/permissions.md), `activeTools` |
| Network, shell, filesystem | `screenedFetch`, `catastrophicShellReason`, `safePathJoin` |

The full map is [attack surface](/concepts/attack-surface.md). A guardrail is a *policy*
layer; it does not replace dispatch-level enforcement, and treating it as the only defense
leaves four of the six vectors open.

# Bring your own classifier

The SDK ships the seam, not the moderation model. A PII or moderation guardrail is a
processor you write over a classifier you choose — which is the correct split, since the
classifier is a commodity and the policy is yours. That distinction is buy-vs-build applied
here: buy the mechanism, build the policy. See
[architecture decisions](/operations/architecture-decisions.md).[^course]

[^course]: Agent AI course, Module 7.4
