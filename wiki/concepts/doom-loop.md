---
type: Failure Mode
title: Doom loop
description: Identical tool calls repeated without progress — a terminal state distinct from needing more iterations, and the two-level guard that catches it.
tags: [fundamentals, reliability, cost, failure-mode]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 2.3, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 2.3 — doom loop
    author: human:paulohenriquevn
    last_modified: 2026-07-30
---

# The pattern

A tool fails with the same error; the model retries it **with identical arguments**,
indefinitely. Each attempt costs one LLM call, and each one carries the whole grown context
(see the arithmetic in [the agent loop](/concepts/agent-loop.md)). This is the failure mode
nobody anticipates, because in a demo the tool works.

# Detection and response

Detection is counting consecutive identical calls — name plus arguments. The response has
two levels:

**soft threshold**
: inject a hint ("this already failed, try a different approach") and let the loop continue.

**hard threshold**
: stop, with a no-progress signal.

In this SDK the guard is **on by default** (soft 3 / hard 5) and configurable per send:

```typescript
await agent.send("Investigate the failure", {
  doomLoop: { softThreshold: 3, hardThreshold: 5 },  // or: doomLoop: false
});
```

The terminal is reported as `RunResult.stoppedByDoomLoop === true`.

# Why this matters conceptually

> **"No progress" is a terminal state distinct from "needs more iterations."**

Confusing the two makes you raise `maxIterations` to solve a problem that will only cost
more. The correct response to `stoppedByDoomLoop` is to investigate the *tool*, not the
ceiling — and specifically its error message.

# The root cause is almost always the error message

A tool error is the model's next observation, not a log line. An error that does not suggest
a different action is a doom loop you bought:

```typescript
// Bad — the model has nothing to act on.
throw new Error("failed");

// Good — says what happened AND what to try next.
throw new ToolError(
  "Order 'abc' not found. Order ids look like 'ORD-12345'. Ask the user to confirm the id."
);
```

The full treatment is in [tools and ACI](/sdk/tools-and-aci.md) § tool errors are prompt
content. The same rule applies to a human `deny` in
[human in the loop](/concepts/human-in-the-loop.md): denying silently produces a retry, so a
denial without a reason is a doom loop with human participation.

# Where it hurts most

In a [closed autonomous loop](/concepts/control-cadence.md) nobody is watching, so the guard
is the only thing between a bad tool and an unbounded bill. That is why it defaults to on
rather than off.

Related containment: [limits and budgets](/sdk/limits-and-budgets.md) covers the ceilings
that do not depend on the model cooperating.[^course]

[^course]: Agent AI course, Module 2.3
