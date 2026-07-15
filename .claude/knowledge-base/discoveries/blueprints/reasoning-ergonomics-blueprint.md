---
version: 1.0
slug: reasoning-ergonomics
milestone: SE37
cycle: discover (blueprint — output of discover-execute)
created: 2026-07-14
---

# Blueprint — Reasoning ergonomics (SE37)

Answers the 6 discovery-plan questions with concrete patterns + citations, mapped to the exact
`@theokit/sdk` integration point. Sources: Anthropic "think" tool (external doc), Agno
ReasoningTools + reasoning=True (user-provided doc), crewAI reasoning concept
(`.claude/knowledge-base/reference/crewAI/docs/en/concepts/reasoning.mdx`), mastra loop/tools
(`.claude/knowledge-base/reference/mastra/packages/core/src/{loop/loop.ts,tools/tool.ts}`), and the
own `@theokit/sdk` surface.

## Q1 — Think/scratchpad tool schema (Techniques)

**Pattern (Anthropic "think" tool + Agno `ReasoningTools`):** a no-side-effect tool the model calls to
externalize a reasoning step. Canonical shape:

- `think` — input `{ thought: string }`; description steers the model: *"Use this to think step by
  step before answering or acting. Nothing else happens — it's your scratchpad."*; handler **echoes**
  the thought back as the tool result (so it enters the transcript as an observation).
- `analyze` (Agno) — input `{ title: string, result: string, analysis: string, next_action: "continue"|"validate"|"final_answer" }`; same no-op echo; steers the model to review a prior result before proceeding.

**Why echo:** the value is not the handler — it's forcing the model to emit structured reasoning as
tool-call args, which the ReAct loop then feeds back as an observation (reason→act→observe).

**Own integration:** ships as `ReasoningTools.create()` from `@theokit/sdk-tools` (SE36 `X.create`
surface — Q5), returning `[think, analyze]` `CustomTool`s built with the existing tool factory.

## Q2 — CoT preamble / prompt shape (Techniques)

**Pattern (crewAI `reasoning.mdx`):** when reasoning is on, before executing the agent (1) reflects and
creates a plan, (2) evaluates readiness, (3) refines until ready or `max_reasoning_attempts`, (4)
**injects the plan into the task/description before execution**. Crucially: **fail-soft** — "If an
error occurs during reasoning, the agent will proceed with executing the task without the reasoning
plan."

**SE37 lightweight adaptation (owner decision: prompt + tool, same model — NOT crewAI's separate
plan-refine loop):** `reasoning: true` prepends a compact CoT **preamble** to the assembled system
prompt:

> "Think step by step before answering. Break the problem into steps, use the `think` tool to work
> through each step, validate your own reasoning and check for mistakes, then give the final answer.
> For factual/'compare two things' questions, reason explicitly before concluding."

This reuses the existing ReAct tool loop (think → observe → continue) instead of a bespoke
reflect-refine loop. `max_reasoning_attempts` is **out** for the lightweight version (documented; the
iteration ceiling already bounds the loop).

**Own integration:** the preamble enters via the system-prompt assembly
(`packages/sdk/src/internal/runtime/system-prompt/local-assembly.ts`), prepended before the user's
`systemPrompt` — additive, fail-soft (a preamble string can't throw).

## Q3 — Loop integration point (Techniques)

**Reference (mastra `loop/loop.ts`):** the loop receives `tools` + system context as inputs
(`loop({ tools, … })`, line 11-20) — tools and the system prompt are assembled *before* the loop, not
inside it. Same in our SDK.

**Own integration (two seams, both pre-loop):**
1. **Tool** — the reasoning tool is merged into the effective toolset at the same place subagent/
   memory/plugin tools are merged: `buildCustomToolsInput` in
   `packages/sdk/src/internal/runtime/local-agent/real-local-run.ts` (the seam SE-fixed for
   file-based subagents). `reasoning: true` appends `ReasoningTools.create()` to `agentOptions.tools`.
2. **Preamble** — prepended in `local-assembly.ts` during system-prompt assembly.

No new runtime, no new loop — exactly the "lightweight" scope.

## Q4 — Double-reasoning guard (Techniques)

**Problem:** a native reasoning model (`model.params: [{ id: "thinking", value: "high" }]`) already
reasons internally; layering `reasoning: true` (preamble + think tool) wastes tokens and can degrade
output. Our `strip-think.ts` already shows native `<think>` output is a first-class, handled path.

**Precedence rule (blueprint decision):**
- If the resolved model config carries a thinking/reasoning param → **native wins**: `reasoning: true`
  emits a one-time `warnOnce` ("native reasoning detected; `reasoning: true` skipped to avoid
  double-reasoning") and does NOT inject the preamble or the tool.
- Else → `reasoning: true` injects preamble + tool.
- Detection: inspect `ModelSelection.params` for an id in `{ "thinking", "reasoning", "reasoning_effort" }`.

## Q5 — Tool-factory surface (Tools)

**Own (`packages/sdk/src/define-tool.ts` + `packages/sdk-tools/src/index.ts`):** tools are `CustomTool`
values; per SE36 the canonical form is `X.create()`. So SE37 ships `ReasoningTools.create(opts?)` (a
namespace class with a static `create`) from `@theokit/sdk-tools`, returning the `think`/`analyze`
`CustomTool[]`. Consumers: `tools: [...ReasoningTools.create()]` OR `reasoning: true` (auto).

## Q6 — Deterministic testing (Integration tests)

**Per `rules/testing.md` (§ test the mechanism, not model output) + `rules/real-llm-validation.md`:**
- **Deterministic unit tests** (no LLM): `ReasoningTools.create()` returns think+analyze with correct
  schema; the think handler echoes its input; `reasoning: true` ⇒ the assembled system prompt contains
  the preamble AND the toolset contains `think`; `reasoning` absent ⇒ prompt + toolset byte-identical
  (no-op guarantee); native-thinking model + `reasoning: true` ⇒ preamble/tool NOT injected + warn.
- **One real-LLM E2E** (OpenRouter, per the rule): a `reasoning: true` agent answers the "9.11 vs 9.9"
  trap correctly AND `onToolStart` shows the `think` tool was called — proving the mechanism drives a
  correct answer, not a brittle text match.

## Dependencies corner (ADR-D4 — deferred = the finding)

SE37 adds **zero** new runtime dependencies: the tools are `Tool.create` over stdlib; the preamble is a
string; the guard is a branch. Recorded as the Dependencies-corner answer.

## ADRs (blueprint)

- **ADR-B1 — Lightweight over crewAI's reflect-refine loop.** We adopt prompt-preamble + think-tool
  (Agno-style, same model) rather than crewAI's separate plan-generate-evaluate-refine loop with
  `max_reasoning_attempts`. Rationale: owner decision (2026-07-14) for a non-invasive flag that reuses
  the existing ReAct loop; the heavier loop is deferred (can be added later as `maxReasoningAttempts`).
- **ADR-B2 — Native reasoning wins.** `reasoning: true` is inert (with warn) when a native thinking
  model is configured — prevents double-reasoning. Precedence is model-param detection.
- **ADR-B3 — Fail-soft, additive, byte-identical when off.** Mirrors crewAI's fail-soft: reasoning is
  purely additive; unset ⇒ zero behavior change (the no-op test is a DoD gate).

## Mapping to SE37 DoD

Every SE37 DoD bullet has a cited pattern + integration point above:
`ReasoningTools.create()` (Q1/Q5) · `AgentOptions.reasoning` preamble+tool (Q2/Q3) · double-reasoning
guard (Q4) · deterministic + real-LLM tests (Q6) · docs (`/theokit/reasoning`, three approaches) ·
zero new deps (ADR-D4).
