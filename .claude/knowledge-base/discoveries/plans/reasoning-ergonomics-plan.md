---
version: 1.0
slug: reasoning-ergonomics
milestone: SE37
owner: harness
created: 2026-07-14
cycle: discover (phase 1 — plan)
---

# Discovery Plan — Reasoning ergonomics (SE37)

## Context

SE37 ships two reasoning "sugar" gaps found in the 2026-07-14 Agno cross-check: (a) a
`think()`/`analyze()` reasoning tool, and (b) a lightweight `AgentOptions.reasoning` flag that wraps
a non-reasoning model in a structured chain-of-thought ReAct loop using the SAME model. Native
reasoning models are already first-class in `@theokit/sdk` (`model.params: [{ id: "thinking" }]` +
streamed thinking + `usage.reasoningTokens`), so this discovery targets ONLY the two missing sugars.

**Honesty note (sources).** The authoritative patterns for this feature are *documented*, not cloned:
Anthropic's "think" tool guidance and Agno's `ReasoningTools`/`reasoning=True` (both external docs).
Of the reference clones, only **crewAI** carries a first-class reasoning concept doc and **mastra**
carries a mature agentic loop + tool/processor surface worth studying for the integration shape.
`openai-agents-python/src` has no reasoning-tool implementation (grep-empty) and is therefore NOT
cited. This plan does not fabricate reference coverage where none exists.

## Objective

Extract the exact tool schema, prompt shape, loop-integration point, and double-reasoning guardrail
needed to implement SE37 in `@theokit/sdk` such that the resulting blueprint answers every SE37 DoD
design question with a cited pattern (real reference path OR a named external doc).

**Success criteria for the blueprint:** every one of the 6 questions below answered with (i) a
concrete pattern, (ii) a citation (verified `.claude/knowledge-base/reference/...` path or a named
external doc), and (iii) a mapping to the exact `@theokit/sdk` integration point.

## In-scope / Out-of-scope

| Project | In scope | Out of scope |
|---|---|---|
| `.claude/knowledge-base/reference/crewAI` | `docs/en/concepts/reasoning.mdx`, `docs/en/guides/agents/crafting-effective-agents.mdx` | everything else (Python impl, other docs langs) |
| `.claude/knowledge-base/reference/mastra` | `packages/core/src/loop/loop.ts`, `packages/core/src/tools/tool.ts`, `packages/core/src/processors/index.ts` | `agent/agent.ts` body (8914 lines — skim signatures only), UI/playground/deployer |
| `@theokit/sdk` (own) | `packages/sdk-tools/src/index.ts`, `packages/sdk/src/define-tool.ts`, `packages/sdk/src/internal/tool-dispatch/strip-think.ts`, `packages/sdk/src/internal/runtime/system-prompt/local-assembly.ts` | rest of the runtime |
| External docs | Anthropic "think" tool pattern; Agno ReasoningTools + reasoning=True (user-provided) | — |

## ADRs (how to investigate)

- **ADR-D1 — Documented-pattern primacy.** The think-tool + reasoning-flag patterns are sourced from
  Anthropic/Agno *docs*, cited as named external sources (not clone paths). Rationale: no clone
  implements them; forcing a `references/` citation would be fabrication (violates the golden rule).
- **ADR-D2 — Skim the 8914-line mastra Agent.** We read only the `reasoning`/`think`/tool-attach
  signatures in `agent/agent.ts`, not the whole file. Rationale: time budget; the loop + tool +
  processor files carry the relevant shape.
- **ADR-D3 — Own-codebase is a first-class source.** The integration points (`define-tool`,
  `strip-think`, `local-assembly`, `sdk-tools`) are studied as primary material, since SE37 is an
  additive change to an existing surface, not a greenfield build.

## Research questions

| # | Corner | Question | Method | Expected answer shape |
|---|---|---|---|---|
| Q1 | **Techniques** | What is the exact schema + handler contract of a "think"/scratchpad tool (input field, no-side-effect echo, description that steers the model to use it)? | Read Agno docs (provided) + Anthropic think-tool pattern; compare with mastra `packages/core/src/tools/tool.ts` tool shape | A tool spec: `{ name, description, inputSchema:{thought/analysis}, handler → echoes }` |
| Q2 | **Techniques** | What CoT preamble / prompt shape turns a non-reasoning model into a reason→act→observe loop, and how is self-validation encoded? | Read `.claude/knowledge-base/reference/crewAI/docs/en/concepts/reasoning.mdx` + `crafting-effective-agents.mdx`; cross-ref Agno reasoning=True | A prompt template + the ReAct step contract |
| Q3 | **Techniques** | Where in the agent loop is the reasoning tool offered + the preamble injected, without a new runtime? | Read mastra `packages/core/src/loop/loop.ts` (how tools + system context enter the loop); map to our `packages/sdk/src/internal/runtime/system-prompt/local-assembly.ts` | The exact hook: preamble → system-prompt assembly; tool → toolset builder |
| Q4 | **Techniques** | How to avoid double-reasoning when a native thinking model (`model.params:[{id:"thinking"}]`) is ALSO configured — precedence + guard? | Read our `packages/sdk/src/internal/tool-dispatch/strip-think.ts` (how native `<think>` is already handled) + reason about precedence | A precedence rule + a warn/guard when both are set |
| Q5 | **Tools** | What is the canonical tool-factory surface the reasoning tool must ride on, and how are tools exported from `@theokit/sdk-tools`? | Read `packages/sdk/src/define-tool.ts` + `packages/sdk-tools/src/index.ts` | The `Tool.create`/`X.create` shape + export site |
| Q6 | **Integration tests** | How does a mature framework test a reasoning/CoT feature deterministically (mechanism, not model output)? | Read mastra `packages/core/src/processors/index.ts` test-adjacent patterns + crewAI reasoning doc's testing notes; map to `rules/testing.md` (§ mechanism-not-output) + `rules/real-llm-validation.md` | Deterministic assertions (tool offered / preamble present / tool called) + 1 real-LLM E2E |

## Coverage Matrix (100%)

| Corner | Questions | Method present? | Deferred (ADR)? |
|---|---|---|---|
| Techniques | Q1, Q2, Q3, Q4 | ✅ all mapped | — |
| Tools | Q5 | ✅ | — |
| Integration tests | Q6 | ✅ | — |
| Dependencies | — | Deferred | **ADR-D4:** SE37 adds ZERO new runtime deps (reasoning tool is `Tool.create` over stdlib; preamble is a string; guard is a branch). The "no new dependency" is itself the finding — a Dependencies corner question would be answered "none by design". Recorded per Quality Rule 6. |

## Halt-loop checkpoints (for /discover-execute)

- A sub-task is DONE only when its question has: a concrete pattern + a resolvable citation + the
  `@theokit/sdk` integration point named.
- Q4 (double-reasoning guard) MUST produce a precedence rule, not a vague "document it".

## Acceptance Criteria

- All 6 questions answered; every citation resolves (`Path.exists` for clone paths; named doc for
  external); Dependencies deferral carries ADR-D4.
- Blueprint has the 4 coverage corners populated (Dependencies = the "zero new deps" finding).
- ≥ 1 ADR section in the blueprint.

## Global Definition of Done

Per `.claude/rules/discover-blueprint-golden-rule.md` + `discover-plan-thresholds.txt`: no fabricated
citation, all four corners present (or ADR-deferred), verdict ≥ SHIPPABLE_WITH_CAVEATS from
`/discover-confidence`.
