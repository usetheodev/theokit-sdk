---
type: Concept
title: Context engineering
description: The context window as a budgeted scarce resource — the four sources competing for it, the four operations on it, and why a bigger window does not help.
tags: [fundamentals, context, cost, quality]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 3, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 3 — context engineering
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: compaction
    resource: packages/sdk/src/compaction (public sub-entry @theokit/sdk/compaction)
    title: Compaction primitives — verified at @theokit/sdk@4.36.0 on 2026-07-30
---

# The thesis

> **Context engineering is the discipline of deciding what the model sees on each call.** It
> is where most of an agent's quality lives — more than the choice of model, more than the
> wording of the prompt.

Four sources compete for the same space:

| Source | Nature | Cost | Control |
| --- | --- | --- | --- |
| **System prompt / instructions** | static | paid always | total |
| **Project context** (files, rules) | semi-static | paid always | high |
| **Conversation history** | growing | paid always, grows | medium (compaction) |
| **Tool results** | explosive | paid always once it enters | high (truncate at the source) |

The fourth is the one that ruins systems, because it looks free at the moment it enters. The
containment is `toModelOutput` — see [tools and ACI](/sdk/tools-and-aci.md).

# Degradation before overflow

The common conceptual error is "I have a 200k window, so it fits". Quality drops **long
before** the limit:

* relevant information in the middle of a long context is used less reliably than at the
  start or the end;
* noise (logs, HTML, verbose JSON) competes with signal for attention;
* contradictory instructions accumulated across turns produce erratic behavior.

**Practical rule:** treat roughly 50% of the nominal window as the comfortable working
budget. The rest is slack for the worst case.

# The four operations

```
1. INJECT   — put in something static and always relevant (instructions, conventions)
2. RETRIEVE — fetch on demand what is large and sometimes relevant (RAG, memory, skills)
3. SUMMARIZE — trade N old turns for 1 summary (compaction)
4. DISCARD  — cut what is no longer needed (checkpoints, truncation at the source)
```

Choosing wrong has a name:

* injecting what should be retrieved = **obese prompt** (always paying for something rarely
  useful);
* retrieving what should be injected = **latency and recall failure** (the model does not
  know it needs to search);
* summarizing too early = **loss of detail** the agent needed;
* never discarding = **guaranteed overflow**.

The same reasoning applies one substrate down, to memory recall — see
[state, sessions and memory](/sdk/state-sessions-memory.md).

# Compaction mechanics

When history approaches the budget:

```
[t1][t2][t3][t4][t5][t6][t7][t8][t9][t10]
                            └─ keepRecent: 4 ─┘
[SUMMARY of t1..t6        ][t7][t8][t9][t10]
```

Three design decisions, each with a real trade-off:

1. **When to compact** — before the call (preventive) or on overflow (reactive). Reactive is
   cheaper and more fragile.
2. **What to preserve** — recent turns, decisions, the current goal. A summary that loses the
   goal turns the agent into a confident amnesiac.
3. **Who summarizes** — a cheap model (risks losing nuance) or the same model (costs more).

The SDK exposes this as pure primitives in `@theokit/sdk/compaction`:

```typescript
import {
  estimateTokens, shouldCompact, compactTranscript,
  buildCheckpoint, filterFromLatestCheckpoint, isContextOverflowError,
} from "@theokit/sdk/compaction";

if (shouldCompact({ estimated: estimateTokens(joined), contextWindow: 200_000, buffer: 20_000 })) {
  messages = await compactTranscript(messages, { keepRecent: 6, summarize });
}
```

These are independently testable functions — **you can write a context-policy test without
calling an LLM**, which is rare and valuable. It is also the broad base of the test pyramid
in [evaluation](/operations/evaluation.md).

# Skills: retrieving instruction, not data

Classic RAG retrieves **data**. Skills retrieve **capability/instruction**: a procedure
package ("how to do X in this project") that enters context only when relevant.

| | Document RAG | Skills |
| --- | --- | --- |
| Retrieves | facts | procedures |
| Key | semantic similarity | name + description (the model chooses) |
| Typical failure | irrelevant chunk | skill not triggered by a bad description |
| Optimization | chunking, reranking | **writing the description for the trigger** |

Practical consequence: a skill's description is an **engineering artifact**, not a comment.
It *is* the retrieval mechanism.

# Mastery criterion

Given an agent that blows its context at turn 12, you produce a diagnosis in terms of the
four operations — saying which to apply, where, why, and with an estimated token impact.[^course]

[^course]: Agent AI course, Module 3
[^compaction]: `@theokit/sdk/compaction`
