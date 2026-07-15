---
slug: reasoning-ergonomics
milestone_id: SE37
created_at: 2026-07-14
goal: Ship a `think()`/`analyze()` reasoning tool + a lightweight `AgentOptions.reasoning` flag (CoT preamble + auto-attached tool, same model, fail-soft, guarded against double-reasoning).
---

# Plan — SE37 Reasoning ergonomics

Consumes `knowledge-base/discoveries/blueprints/reasoning-ergonomics-blueprint.md`.

## Goal

Two additive, opt-in capabilities in `@theokit/sdk` / `@theokit/sdk-tools`, byte-identical when unused:

1. `ReasoningTools.create()` → `[think, analyze]` `CustomTool`s (no-side-effect scratchpad).
2. `AgentOptions.reasoning?: boolean` → prepends a CoT preamble to the system prompt AND auto-attaches
   the reasoning tool; inert-with-warn when a native thinking model is configured.

## Baseline Context (current state)

| File | Role in this change | LoC (approx) |
|---|---|---|
| `packages/sdk-tools/src/index.ts` | export site for `ReasoningTools` | small barrel |
| `packages/sdk-tools/src/reasoning-tools.ts` | NEW — `ReasoningTools.create()` | new |
| `packages/sdk/src/define-tool.ts` | `Tool.create` shape the tools ride on | existing |
| `packages/sdk/src/types/agent.ts` | add `AgentOptions.reasoning?: boolean` | existing (big) |
| `packages/sdk/src/internal/runtime/system-prompt/local-assembly.ts` | inject CoT preamble | existing |
| `packages/sdk/src/internal/runtime/local-agent/real-local-run.ts` | `buildCustomToolsInput` — auto-attach reasoning tool | existing (the SE-fixed seam) |
| `packages/sdk/src/internal/runtime/reasoning/` | NEW — preamble constant + `isNativeReasoning(model)` guard | new |

Native thinking is already shipped (`model.params:[{id:"thinking"}]` + `strip-think.ts` +
`usage.reasoningTokens`) — SE37 must NOT duplicate it.

## Coverage Matrix (SE37 DoD → task)

| DoD bullet | Task |
|---|---|
| `ReasoningTools.create()` shipped from `@theokit/sdk-tools` w/ tests (schema, echo, observability) | T1 |
| `AgentOptions.reasoning` (default off, byte-identical when unset); preamble + auto-tool; no-op test | T2, T3 |
| Native-thinking guard (no double-wrap; warn; test) | T4 |
| `docs.md` + `/theokit/reasoning` page (3 approaches + Agno mapping) | T6 |
| `examples/reasoning` executed REAL on OpenRouter (think called + 9.11/9.9 correct) | T5 |
| CHANGELOG + minor bump (`@theokit/sdk` + `@theokit/sdk-tools`) via Changeset | T6 |

## Tasks (TDD — RED before GREEN)

### T1 — `ReasoningTools.create()` in `@theokit/sdk-tools`
- **RED:** test asserts `ReasoningTools.create()` returns 2 tools named `think`, `analyze`; `think`
  inputSchema requires `thought:string`; `think.handler({thought:"x"})` echoes `x`; `analyze` requires
  `analysis` + `next_action` enum.
- **GREEN:** `reasoning-tools.ts` via `Tool.create` (SE36 surface); export from barrel.
- **Wiring:** exported symbol + used by T3 auto-attach + T5 example.

### T2 — CoT preamble injection (`AgentOptions.reasoning`)
- **RED:** with `reasoning:true`, the assembled system prompt (via the assembly seam) CONTAINS the
  preamble marker; with `reasoning` unset/false, the assembled prompt is byte-identical to baseline.
- **GREEN:** add `reasoning?: boolean` to `AgentOptions`; `local-assembly.ts` prepends the preamble
  constant when on. Fail-soft (string concat, cannot throw).

### T3 — Auto-attach the reasoning tool
- **RED:** with `reasoning:true`, the effective toolset (from `buildCustomToolsInput`) includes a
  `think` tool; without, it does not.
- **GREEN:** in `buildCustomToolsInput`, when `agentOptions.reasoning` and not native-reasoning (T4),
  append `ReasoningTools.create()`. (sdk depends on sdk-tools? — if a cross-package import is
  undesirable, inline a minimal reasoning tool in sdk and have sdk-tools re-export it. Decide in GREEN
  per the parsimony ladder / no new dep.)

### T4 — Double-reasoning guard
- **RED:** model with `params:[{id:"thinking",value:"high"}]` + `reasoning:true` ⇒ preamble NOT
  present AND toolset has NO `think` AND a warn is emitted once.
- **GREEN:** `isNativeReasoning(model)` checks `params` ids ∈ {thinking,reasoning,reasoning_effort};
  both assembly + tool-attach short-circuit + `warnOnce`.

### T5 — Real-LLM E2E example
- **RED (as an executable check):** `examples/reasoning/run.ts` with `reasoning:true`, `onToolStart`
  capturing tool names; asserts the reply to "Which is bigger: 9.11 or 9.9?" matches `/9\.9\b/` AND
  `think` appears in the captured tools. Exit non-zero on miss.
- **GREEN:** run REAL on OpenRouter (`openai/gpt-4o-mini`); register in `examples/manifest.json`.

### T6 — Docs + release plumbing
- `docs.md` reasoning section (native models / reasoning tools / `reasoning:true`) + Agno mapping;
  `/theokit/reasoning` opendocs page; CHANGELOG `[Unreleased] § Added`; changesets (minor) for
  `@theokit/sdk` + `@theokit/sdk-tools`.

## Test Plan

- **Unit (deterministic, no LLM):** T1 schema/echo; T2 preamble present/absent (no-op); T3 toolset
  membership; T4 guard + warn. All under `packages/{sdk,sdk-tools}/tests/`.
- **E2E (real LLM):** T5 on OpenRouter per `rules/real-llm-validation.md` — the ONLY validated-claim
  path; fixture never counts.
- **Gates:** `pnpm validate` (typecheck/biome/knip/madge/G8 LoC/jscpd/bundle) green; `/code-quality`
  ∉ {FAIL_HARD, INVALID}; `/review` READY_TO_MERGE.

## Risks (new)

1. **Double-reasoning waste** — mitigated by T4 guard (native wins + warn; default off).
2. **Non-determinism of prompt CoT** — tests assert the MECHANISM deterministically; the real-LLM E2E
   proves value on a known trap, not a brittle exact-text match.
3. **sdk ↔ sdk-tools coupling** — if importing sdk-tools into sdk core is undesirable, inline the
   minimal reasoning tool in sdk and re-export from sdk-tools (no new dep; parsimony ladder rung 4).

## Definition of Done (SE37 — verbatim from ROADMAP)

All SE37 DoD bullets, each gated by a task above + REAL evidence (no fixture-as-proof). Milestone
checkbox flips only post-merge (Rule 4).
