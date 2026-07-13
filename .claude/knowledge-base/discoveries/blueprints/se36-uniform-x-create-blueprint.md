---
version: 1.0
slug: se36-uniform-x-create
milestone: SE36
created: 2026-07-13
sources:
  - .claude/knowledge-base/reference/mastra/packages/core/src/tools/tool.ts
  - .claude/knowledge-base/reference/mastra/packages/core/src/workflows/workflow.ts
  - packages/sdk/src/define-tool.ts
status: SHIPPABLE
---

# Blueprint — Uniform `X.create()` public API (SE36)

Deep-research blueprint for collapsing every public `@theokit/sdk` factory into a uniform
static-namespace `X.create()` form (v3.0 hard break). Answers the six research questions from
`se36-uniform-x-create-plan.md` with reproducible evidence.

## Executive summary

The rename is **technically safe** and **low-risk to execute**, but **divergent from every SOTA
peer** (a product decision the owner accepted, not a technical blocker):

- **Inference:** a `static create<T,O>()` method preserves the EXACT generic inference of the
  current bare `defineTool<T,O>()` function — proven by a `tsc --strict` type-equality spike.
- **Tree-shaking:** `tsup`/esbuild drops unused `X.create` namespace classes exactly like unused
  bare functions — proven by a build spike (unused classes removed, 80 B bundle).
- **Codemod:** a purely **syntactic** `jscodeshift` transform (already installed, `^17.3.0`)
  rewrites both the import specifiers and the call sites — proven end-to-end on a sample.
- **Divergence:** no peer SDK uses `X.create()`; Mastra uses `createTool()`/`createStep()` +
  `new Agent()`, Vercel AI SDK uses `tool()`, OpenAI Agents uses `function_tool`/`Agent()`.

## Coverage Corner 1 — Integration Tests

**Q6 — parity between removed factory and its `X.create` replacement.**

The hard break must introduce ZERO behavior change. Since each `X.create` wraps the identical
existing implementation, parity is by construction; the test asserts the new entry point produces
a structurally-equal descriptor.

Technique (RED-first per converted symbol, per `rules/testing.md`):

```ts
// tool.create.test.ts — RED first (Tool does not exist yet → compile fails)
import { Tool } from "@theokit/sdk";
import { z } from "zod";
test("Tool.create produces a CustomTool with the spec's name/description/schema", () => {
  const spec = { name: "x", description: "d", inputSchema: z.object({ a: z.string() }), handler: () => "ok" };
  const t = Tool.create(spec);
  expect(t.name).toBe("x");
  expect(t.description).toBe("d");
  expect(typeof t.handler).toBe("function");
  expect(t.inputSchema).toMatchObject({ type: "object" }); // JSON-schema conversion preserved
});
```

Existing `defineTool` behavior tests are the parity oracle: the SE36 impl re-points them at
`Tool.create` and they must stay green (same assertions, new entry point). No behavior test is
deleted; each is migrated. Integration coverage: at least one end-to-end example per capability
re-run against a **real LLM (OpenRouter)** per `rules/real-llm-validation.md`.

## Coverage Corner 2 — Dependencies

**Q4 — is `jscodeshift` sufficient, or is `ts-morph` needed?**

`jscodeshift@^17.3.0` is **already a declared devDependency** (root `package.json`) — parsimony
rung 4 (reuse installed dep; no new codemod dependency). The transform is **purely syntactic**:

1. rename `ImportSpecifier`s from `@theokit/sdk[/subpath]` (`defineTool` → `Tool`), dedup;
2. rewrite `CallExpression` callees from `Identifier` (`defineTool`) to `MemberExpression`
   (`Tool.create`).

No type information is required → **`ts-morph` is NOT needed** (it would be a redundant heavier
dep). `jscodeshift`'s `--parser=ts` handles the TS syntax. No new runtime dependency is added by
SE36; the class refactor uses only language features.

## Coverage Corner 3 — Tools

**Q3 — does `tsup` tree-shake an unused `X.create` namespace as well as an unused bare function?**

**Evidence (reproducible):** built `entry.ts` importing only `Tool` from a module also exporting
`Provider` and `Semaphore` classes, via the workspace `tsup@8.5`:

```
$ node_modules/.bin/tsup entry.ts --format esm --minify --no-splitting -d dist-esm
ESM dist-esm/entry.mjs 80.00 B  ⚡️ Build success
markers:  PRESENT TOOL_MARKER_KEEP | DROPPED PROVIDER_MARKER_DROP | DROPPED SEMAPHORE_MARKER_DROP
```

Unused static-namespace classes are **removed** from the consumer bundle — identical tree-shaking
to bare functions, provided each class is side-effect-free (no static initializer with side
effects). **Constraint for the impl:** `X.create` classes must have NO top-level/static side
effects (pure static methods only) so esbuild marks them droppable. `dist` stays dual ESM+CJS
(locked toolchain); the CJS path does not tree-shake but that is pre-existing and unchanged.

## Coverage Corner 4 — Techniques

**Q1 — do peers use `X.create()`?** No. Prior art (in-repo, citable):

| Peer | Factory convention | Citation |
|---|---|---|
| Mastra | `export function createTool<…>()` | `mastra/packages/core/src/tools/tool.ts:575` |
| Mastra | `export function createStep<…>()` (+ `createWorkflow`) | `mastra/packages/core/src/workflows/workflow.ts:206` |
| Mastra | `Agent` is a **class** (`new Agent(...)`) | `mastra/packages/core/src/agent/` |
| Vercel AI SDK | `tool()` bare function, `generateText()` | documented convention (ai-sdk.dev) |
| OpenAI Agents | `function_tool` / `Agent()` | `openai-agents-python` |

`X.create()` uniformity is a **deliberate divergence** from the ecosystem `tool()`/`createX()`
idiom. Accepted by the owner (2026-07-13) for one-mental-model consistency with `Agent.create`.

**Q2 — does `static create<T,O>()` preserve `defineTool<T,O>()`'s inference?**

**Evidence (reproducible):** `tsc@5.8 --strict --noEmit` on a spike compiling a type-equality
proof between a bare generic function and an equivalent static method:

```ts
function defineX<T, O = never>(s: Spec<T,O>): { t: T; o: O } { … }
class X { static create<T, O = never>(s: Spec<T,O>): { t: T; o: O } { … } }
const a = defineX({ input: 123 as number, handler: (x) => x > 0 });
const b = X.create({ input: 123 as number, handler: (x) => x > 0 });
type Eq<A,B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _same: Eq<typeof a, typeof b> = true;   // COMPILES  → inference identical
const _diff: Eq<typeof a, {t:string;o:boolean}> = false; // negative control holds
// $ tsc --noEmit --strict inference.ts  →  PASS
```

Static-method generic inference == function generic inference. **No `as` casts, no inference
loss.** The current `define-tool.ts` signature (`defineTool<T extends ZodType, O extends ZodType = never>`)
maps 1:1 to `class Tool { static create<T extends ZodType, O extends ZodType = never>(...) }`.

**Q5 — the concrete jscodeshift recipe.** Proven end-to-end:

```
BEFORE:  import { Agent, defineTool, createSquad } from "@theokit/sdk";
         const t = defineTool({ … });  const sq = createSquad({ … });
AFTER:   import { Agent, Tool, Squad } from "@theokit/sdk";
         const t = Tool.create({ … });  const sq = Squad.create({ … });
```

The transform (≈40 LOC) lives at `tools/codemods/se36-x-create.mjs`; it ships in the package so
consumers run `npx jscodeshift -t node_modules/@theokit/sdk/codemods/se36-x-create.mjs src/ --parser=ts`.
It handles the `@theokit/sdk` barrel + subpath imports (`@theokit/sdk/…`).

## ADRs

### ADR-B1 — Namespace class = pure static methods wrapping the existing factory

Each `X.create` is a `class X { private constructor(){}; static create(spec){ return <existing impl>(spec) } }`.
The existing implementation function is kept (moved to internal, un-exported) and the class calls
it — so behavior is identical (parity by construction) and the class has no side effects
(tree-shakeable, per Corner 3). Private constructor prevents `new X()` (the type is a namespace,
not an instantiable value). **Rationale:** minimal diff, guaranteed behavior parity, tree-shake
safe. Alternative rejected: reimplementing logic inside `static create` (needless risk +
duplicate code, DRY violation).

### ADR-B2 — Codemod is syntactic jscodeshift, shipped in-package, no ts-morph

Per Corner 2. **Rationale:** the rewrite needs no type info; jscodeshift is already installed;
shipping the transform in `node_modules/@theokit/sdk/codemods/` gives consumers a one-command
migration. Alternative rejected: `ts-morph` (heavier, type-aware capability unused here).

### ADR-B3 — Scope boundary: barrel exports only, internals untouched

Only symbols exported from the public barrels change. Internal helpers that already back a
namespace (`createLocalAgent`/`createCloudAgent` behind `Agent.create`, `createCronJob` behind
`Cron.create`, `createEventStream`, `createTelemetry`, `createRequire`) are NOT public factories
and stay as-is. **Rationale:** `rules/architecture.md` public/internal boundary; the owner's
"todos" means every public factory, not private plumbing. The definitive public list is derived
in `/to-plan` from the barrel (`packages/sdk/src/index.ts` + sub-path entrypoints).

## Open decisions handed to /to-plan

1. The exact public factory → class name map (derive from the barrels; ~18 public symbols).
2. Whether utility factories with awkward nouns (`withRetry` → `Retry.create`?) get a class or
   an ADR-documented exception (owner said full scope; plan proposes the least-ugly nouns).
3. CJS interop: confirm `X.create` works identically on the `require()` path (dual package).

## Definition of Done (this blueprint)

- [x] All 6 questions answered with reproducible evidence (2 spikes + 1 codemod run + in-repo citations).
- [x] Four coverage corners populated.
- [x] 3 ADRs (class shape, codemod, scope boundary).
- [x] Mastra citations pre-verified on disk (`tool.ts:575`, `workflow.ts:206`).
