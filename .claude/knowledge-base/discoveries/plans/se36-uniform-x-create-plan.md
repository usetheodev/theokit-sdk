---
version: 1.0
slug: se36-uniform-x-create
owner: paulohenriquevn
created: 2026-07-13
milestone: SE36
status: ready-for-execute
---

# Discovery Plan — Uniform `X.create()` public API (SE36)

## 1. Context

SE36 collapses every public factory in `@theokit/sdk` (`defineTool`, `defineProvider`,
`definePlugin`, `defineSubscription`, `defineSubAgent`, `defineSkillReadTool`, `createSquad`,
`createSkill`, `createSessionManager`, `createAgentFactory`, `createNoopMemoryProvider`, plus
utility factories `createSemaphore` / `createTokenLimiter` / `createUnicodeNormalizer` /
`createPermissionPlugin` / `createBudget` / `createUsdBudgetTracker` / `createCounterBudgetTracker`)
into a uniform static-namespace `X.create()` form (v3.0, hard break). Owner decision 2026-07-13.

The redesign is a public-surface rename of a **published** package. Before writing code we must
close three technical-risk gaps that determine whether the rename ships cleanly or generates
rework: (a) does a static `class X { static create() }` preserve the exact TypeScript generic
inference the current bare-function factories give; (b) does `tsup`'s tree-shaking keep unused
`X.create` namespaces out of a consumer bundle as well as it drops unused bare functions;
(c) what is the correct `jscodeshift` (already installed, `^17.3.0`) transform shape to rewrite
`defineX(...)` → `X.create(...)` including the import statements.

## 2. Objective

Produce a blueprint that (1) documents peer-SDK factory-API conventions as prior art, (2) locks
the `X.create` class shape that preserves TS inference + tree-shaking, and (3) specifies the
jscodeshift codemod transform — so the SE36 implementation plan has zero unknowns.

**Success criteria:** every research question answered with a file:line citation or a runnable
command + captured output; blueprint's four coverage corners populated; the class-shape and
codemod-shape ADRs decidable from the evidence.

## 3. In-scope / Out-of-scope

| Reference project | In scope | Out of scope |
|---|---|---|
| `mastra` | `packages/core/src/tools/tool.ts`, `packages/core/src/workflows/workflow.ts`, `packages/core/src/agent/` (export shapes) | runtime internals, studio, evals |
| `openai-agents-python` | tool/agent factory shape (technique cross-check only) | Python-specific runtime |
| Vercel AI SDK (no in-repo clone) | `tool()` / `generateText` export shape — via WebFetch to `ai-sdk.dev` docs | full API |
| Own repo `packages/sdk/src/` | the barrel export surface + one representative factory (`define-tool.ts`) for the class-shape spike | non-factory code |

Out-of-scope is explicit: no runtime behavior is investigated (this is a rename, behavior is
unchanged by contract); no peer's *implementation* of tools is borrowed — only their *API export
convention*.

## 4. ADRs (how to investigate)

- **ADR-D1 — Peer research is convention-only.** We read how peers *name/export* factories, not
  how they implement tools. Rationale: SE36 changes naming, not behavior; a deep implementation
  dive would be YAGNI (parsimony rung 1).
- **ADR-D2 — Vercel AI SDK via WebFetch, not clone.** No in-repo clone exists; the `tool()`
  convention is stable public documentation. WebFetch to the allowlisted `ai-sdk.dev` domain is
  cheaper than cloning the monorepo.
- **ADR-D3 — Class-shape spike is a throwaway.** Q2/Q3 require a tiny compile+bundle spike; it is
  written under `/tmp` scratch, never committed, and its finding is transcribed into the blueprint.

## 5. Research questions

| # | Corner | Question | Method | Expected answer shape |
|---|---|---|---|---|
| Q1 | Techniques | Do any SOTA peers expose a uniform `X.create()` static-namespace factory, or is it universally bare `createX()` / `defineX()` / `tool()` / `new Class()`? | `grep -rEn 'export function create|export class' mastra/packages/core/src/{tools,workflows}`; WebFetch `ai-sdk.dev` `tool()` docs | Table: peer → convention → citation. Confirms/denies divergence. |
| Q2 | Techniques | Does `class X { static create<G>(spec): Result<G> }` preserve the SAME generic inference as the current `export function defineTool<G>(spec)`? | Spike: copy `packages/sdk/src/define-tool.ts` signature into a `class Tool { static create }` in `/tmp`, `tsc --noEmit` a call site, diff the inferred type | "identical inference" / "inference lost at X" + the fix |
| Q3 | Tools | Does `tsup` tree-shake an unused `X.create` static-method namespace as well as an unused bare function (no bloat for consumers importing only `Agent`)? | Spike: build two tiny entrypoints with `tsup`, import only one symbol, compare `dist` size / contents | bytes delta + verdict (tree-shakes / retains) |
| Q4 | Dependencies | Is `jscodeshift@^17.3.0` (already installed) sufficient to rewrite `defineX(a)` → `X.create(a)` **and** fix the named imports, or is `ts-morph` needed for type-aware rewrites? | Read root `package.json`; read jscodeshift API; assess whether the transform is purely syntactic | "jscodeshift sufficient (syntactic)" / "needs ts-morph" + rationale |
| Q5 | Techniques | What is the exact jscodeshift transform recipe (import specifier rename + CallExpression callee rewrite) for one representative pair (`defineTool` → `Tool.create`)? | Read jscodeshift `CallExpression`/`ImportDeclaration` API; draft the transform against a sample source string | A concrete transform sketch + the AST nodes touched |
| Q6 | Integration tests | How do we prove behavior parity between a removed factory and its `X.create` replacement (so the hard break introduces zero behavior change)? | Read `packages/sdk/tests/` for an existing `defineTool` test; design the parity assertion (same input spec → structurally equal descriptor) | The parity-test technique (RED-first per symbol) |

## 6. Coverage Matrix

| Corner | Questions | Covered? |
|---|---|---|
| Integration tests | Q6 | ✅ |
| Dependencies | Q4 | ✅ |
| Tools | Q3 | ✅ |
| Techniques | Q1, Q2, Q5 | ✅ |

100% — every question maps to a method; no deferred gaps.

## 7. Halt-loop checkpoints (for /discover-execute)

A question is DONE only when: its answer is written to the blueprint AND backed by a
file:line citation OR a captured command output. Q2/Q3 require the spike output pasted verbatim.

## 8. Acceptance Criteria

- All 6 questions answered with evidence.
- Every `mastra/...` citation resolves on disk (pre-verified: `tool.ts:575`, `workflow.ts:206`).
- Blueprint has the four coverage corners + ≥ 1 ADR (class shape) + ≥ 1 ADR (codemod shape).
- The class-shape and codemod recipe are concrete enough that `/to-plan SE36` has no open unknowns.

## 9. Global Definition of Done

Scored by `/discover-confidence` against `rules/discover-blueprint-golden-rule.md`
(≥ SHIPPABLE_WITH_CAVEATS). Hard caps: no empty coverage corner, no fabricated citation.

## Cited project rules

- `rules/parsimony-ladder.md` — rung 4 (reuse installed `jscodeshift`, no new codemod dep); rung 1 (convention-only peer research).
- `rules/architecture.md` — the rename must not cross the public/internal boundary (internal helpers like `createLocalAgent` stay internal; only barrel exports change).
- `rules/testing.md` — Q6 parity tests follow the pyramid (unit-level structural equality) + RED-first.
- `rules/real-llm-validation.md` — examples re-verified against a real LLM in the implement phase.
