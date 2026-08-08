---
type: API Guide
title: Squad and subagents
description: Sequential teams and declarative delegation — and the correction that the real reason for a subagent is context isolation, not role-play.
tags: [api, multi-agent, orchestration, context, delegation]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 6.4 and 6.5, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 6 — Squad and subagents
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: types
    resource: packages/sdk/src/types/
    title: Squad and subagent surface — verified at @theokit/sdk@4.36.0 on 2026-07-30
---

# Squad — a sequential team

```typescript
import { Agent, Squad } from "@theokit/sdk";

const brainstormer = await Agent.create({ /* ... */ });
const picker = await Agent.create({ /* ... */ });

const squad = Squad.create({ agents: [brainstormer, picker] });
const run = await squad.run("a focus timer app for developers");

console.log(run.status, run.steps.length, run.result);
```

Each agent's output is the next one's input. It is the cheapest form of multi-agent — and
frequently sufficient. Before building graph topology, ask: **is it a line?** If so, it is a
squad.

# Subagents — declarative delegation

```typescript
const supervisor = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  systemPrompt:
    "You have no translation ability of your own. For ANY translation you MUST delegate to the translator subagent.",
  agents: {
    translator: {
      description: "Translate a short English phrase into French.",
      prompt: "You translate English to French. Reply with only the French translation.",
    },
  },
});
```

Each entry in `agents` becomes a delegation tool. The child inherits `apiKey` / `model` from
the parent.

# The correction that matters

> **The real reason to use a subagent is not "specialization" — it is context isolation.**

The child works in its own window and returns only the result. The parent does not pay for
the child's 30 turns of investigation. Anyone using a subagent purely for "roles" pays the
orchestration cost without collecting the benefit — the model already plays roles via the
prompt.

This is the same budget reasoning as
[context engineering](/concepts/context-engineering.md), applied one level up: the child's
transcript is a cost the parent would otherwise carry on every subsequent iteration.

The measurement that proves it: run the same heavy task with and without a subagent and
compare the **parent's** tokens. That is where the gain appears — nowhere else.

# Tool scope is enforced, not suggested

```typescript
import { withSubagentToolScope } from "@theokit/sdk/subagents";
const readOnly = withSubagentToolScope(agentDef, ["read_file", "search_text"]);
```

Same principle as `activeTools` in [tools and ACI](/sdk/tools-and-aci.md) and as
[permissions](/sdk/permissions.md): enforcement at dispatch, not a request in a prompt.

# Reflection surface

`Agent.describe(id)` returns `{ agentId, runtime, model?, tools, subagents }` — a projection
in which tool handlers and subagent prompts never leave the process. Useful for showing a
host what a given agent can actually call.

One honest caveat: `describe()` projects declaration-time options, so disk-discovered
subagents (`.theokit/agents/*.md`) and plugin or reasoning tools are absent from what it
calls the live registry. Recorded as finding M3 in
[review: issue-sweep 2026-08](/project/review-issue-sweep-2026-08.md).

# Where this sits

Subagents and squads are rungs 3 and 4 of the
[determinism ladder](/concepts/determinism-ladder.md). Climbing to free multi-agent because
"we want a multi-agent system" is the row in that table that says *go back and justify*.[^course]

[^course]: Agent AI course, Module 6
