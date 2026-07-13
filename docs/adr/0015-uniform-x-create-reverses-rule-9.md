# ADR 0015 — Uniform `X.create()` public API (reverses Rule 9 / supersedes ADR D431)

- Status: Accepted
- Date: 2026-07-13
- Milestone: SE36
- Supersedes: ADR D431 ("factory functions are the canonical API")
- Deciders: Paulo (owner)

## Context

The public `@theokit/sdk` surface mixes two construction idioms:

- **Static-namespace classes** for live, disposable instances: `Agent.create`, `Cron.create`,
  `Workflow.create`.
- **Bare factory functions** for declarative specs and utilities: `defineTool`, `defineProvider`,
  `definePlugin`, `createSquad`, `createSkill`, `withRetry`, `createSemaphore`, …

The owner identified the `Agent.create` vs `defineTool` inconsistency as a first-class API-design
defect (2026-07-13) and decided on **full uniformity**: every public factory becomes `X.create()`.

## Decision

Every PUBLIC factory in `@theokit/sdk` (across the main barrel and all subpath entrypoints) ships
as a static method `X.create()` on a namespace class with a `private constructor`, mirroring the
existing `Agent`/`Cron`/`Workflow` shape. The old `define*` / `create*` / `with*` exports are
**removed** (hard break, no deprecated aliases) at `@theokit/sdk@3.0.0`. A published
`jscodeshift` codemod (`@theokit/codemod-sdk-3-0`) migrates consumers.

Internal helpers that already back a namespace (`createLocalAgent`/`createCloudAgent` behind
`Agent.create`, `createCronJob` behind `Cron.create`, `createEventStream`, `createTelemetry`,
`createRequire`, `createSharedAgentHandler`, `createPluginContext`) are NOT public factories and
stay internal (`rules/architecture.md` public/internal boundary).

This **reverses Unbreakable Rule 9** ("factory functions are the canonical API", ADR D431). Rule 9
and the Locked-names table in `CLAUDE.md` are rewritten in the same PR (Locked-names change
protocol).

## Consequences

- **Positive:** one mental model across the whole surface — `X.create()` everywhere.
- **Negative (accepted):**
  1. **Maximum blast radius.** Hard break + full scope breaks every consumer import at once.
     Mitigation: the codemod round-trips the in-tree `examples/**` suite before 3.0.0 is cut.
  2. **SOTA-idiom divergence.** No peer SDK uses `X.create()` — Mastra uses `createTool()`/
     `createStep()` + `new Agent()` (`.claude/knowledge-base/reference/mastra/packages/core/src/tools/tool.ts:575`),
     Vercel AI SDK uses `tool()`, OpenAI Agents uses `function_tool`/`Agent()`. New users may find
     `Tool.create` unfamiliar. Recorded, accepted.
  3. **Awkward nouns.** `withRetry` → `Retry.create`, `defineAuth` → `Auth.create`,
     `createNoopMemoryProvider` → `NoopMemoryProvider.create` read less naturally than the verb
     form. Accepted for uniformity (no per-symbol exceptions — partial uniformity defeats the goal).

## Evidence (blueprint spikes — reproducible)

- **Inference preserved:** `class X { static create<T,O>() }` gives byte-identical TS generic
  inference to `function defineX<T,O>()` (`tsc --strict` type-equality proof).
- **Tree-shaking preserved:** `tsup`/esbuild drops unused `X.create` namespaces exactly like unused
  bare functions (build spike: unused classes removed). Constraint: `create` classes must be
  side-effect-free (pure static methods, private constructor).
- **Codemod feasible:** a purely syntactic `jscodeshift` transform rewrites imports + call sites
  (proven end-to-end).

Full evidence: `.claude/knowledge-base/discoveries/blueprints/se36-uniform-x-create-blueprint.md`.

## Alternatives considered

- **Keep the split** (`X.create` for instances, `defineX` for specs — the SOTA-aligned status quo).
  Rejected by the owner in favor of uniformity.
- **Deprecated aliases** (ship `X.create` + keep `defineX` as `@deprecated` for a transition
  window). Rejected — the owner chose a clean hard break.
- **Partial scope** (convert only the primary capability factories, leave utilities). Rejected —
  the owner mandated full scope ("literally everything").
