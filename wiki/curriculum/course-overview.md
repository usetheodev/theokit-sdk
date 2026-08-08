---
type: Curriculum
title: Course overview
description: Who the Agent AI course is for, its honesty contract, its structure, and the setup smoke test everything else depends on.
tags: [curriculum, teaching, onboarding, setup]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), section 0, absorbed into this bundle 2026-08-06
    title: Agent AI course, § 0 — how to use this course
    author: human:paulohenriquevn
    last_modified: 2026-07-30
---

# What this is

A 12-module curriculum — from the first LLM call to Staff-Engineer level in Agent AI. Theory,
practice, ecosystem comparison and seniority criteria.

| Item | Value |
| --- | --- |
| Document version | 1.0 |
| Written | 2026-07-30 |
| Reference SDK | `@theokit/sdk@4.36.0` (verified against `packages/sdk/src`) |
| Estimated duration | 40–60 h intensive · 8–12 weeks part-time |
| Prerequisites | intermediate TypeScript · Node ≥ 22.12 · async/await · Git · HTTP basics |
| Lab language | TypeScript (ESM) |

**Teaching material, not an API contract.** Where it disagrees with the exported types, the
types win.

# Who it is for

It assumes you **already know how to program** and want to stop "using an LLM" and start
**engineering agentic systems** — things that run on their own, in production, with
predictable cost, handled failures, and evidence that they work.

| Profile | Where to start | What to skip |
| --- | --- | --- |
| Never wrote an agent | [what is an agent](/concepts/what-is-an-agent.md), in order | nothing |
| Already uses LangChain/CrewAI/LangGraph | skim the fundamentals → [agent, run and SDKMessage](/sdk/agent-run-sdkmessage.md) → **[framework comparison](/ecosystem/framework-comparison.md) first** | the loop anatomy if you already know it |
| Deciding architecture or stack | [what is an agent](/concepts/what-is-an-agent.md), [the agent loop](/concepts/agent-loop.md), [framework comparison](/ecosystem/framework-comparison.md), [governance](/operations/governance.md) | labs are optional |

# The honesty contract

A course on agents that promises more than the tool delivers produces engineers who discover
the limit in production. So, explicitly:

1. **Every API shown was verified** against the exported types in `packages/sdk/src/types/`
   and the runnable `examples/`. The source of truth for the public contract is the TypeScript
   types — not this material. If they diverge, **the types win**.
2. **What the SDK does not do is written down**, in [capability gaps](/project/capability-gaps.md).
   Durability that does not exist is not sold here.
3. **The ecosystem comparison is dated** — July 2026. The *decision axes* age slowly, the
   *version numbers* age in weeks. Treat the table as method, not permanent truth.
4. **The cloud runtime is pre-release.** Every example runs on the local runtime, which is the
   tested path.
5. **Where the author did not know, the material says so.** Points where the code comment and
   observable behavior diverge are collected in [precision notes](/project/precision-notes.md).

# Structure

```
PART I   — Fundamentals (theory that survives a framework change)  → /concepts/
PART II  — The SDK in practice                                      → /sdk/
PART III — Landscape                                                → /ecosystem/
PART IV  — Staff level                                              → /operations/
CAPSTONE — Graded final project                                     → /curriculum/capstone.md
RUBRIC   — Competency levels (Junior → Staff)                       → /curriculum/competency-rubric.md
```

Each original module had: **objectives → theory → labs → exercises → pitfalls → mastery
criterion.** In this bundle the theory lives in the concept pages, the labs are collected in
[labs](/curriculum/labs.md), the pitfalls in [pitfalls](/concepts/pitfalls.md), and each
concept keeps its own mastery criterion.

# Setup

```bash
node --version          # must be >= 22.12.0
corepack enable
mkdir agent-course && cd agent-course
npm init -y
npm pkg set type=module
npm install @theokit/sdk zod
npm install -D typescript tsx @types/node

# provider key — the course uses OpenRouter because one key reaches many models
export OPENROUTER_API_KEY=sk-or-...
```

Smoke test (`smoke.ts`):

```typescript
import { Agent } from "@theokit/sdk";

const result = await Agent.prompt("Reply with exactly: ready.", {
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
});

console.log(result);
```

```bash
npx tsx smoke.ts
```

If that does not run, **do not go further** — everything else depends on this path.

# Closing line of the original

*The hard part is not building the agent — it is proving that it works and admitting where it
does not.*[^course]

[^course]: Agent AI course, § 0
