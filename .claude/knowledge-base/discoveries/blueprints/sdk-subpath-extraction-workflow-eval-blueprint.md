# Blueprint: Extract `Workflow` + `Eval` from `@usetheo/sdk` main barrel into dedicated sub-paths

> **Version 1.1** — synthesizes the packaging decision for moving `Workflow` (+ `agentStep`, `fn`, `WorkflowBuilder`, 8 `Workflow*Error` types) and `Eval` (+ `EvalAlreadyRunningError`, `Scorers`) out of `packages/sdk/src/index.ts` into dedicated sub-paths `@usetheo/sdk/workflow` and `@usetheo/sdk/eval`. **No backwards-compat is preserved** — symbols are removed from the main barrel entirely. v1.1 corrects every line citation from v1.0 after empirical verification revealed multiple fabricated line numbers in v1.0; this version is line-exact.

**Slug:** `sdk-subpath-extraction-workflow-eval`
**Source plan:** `.claude/knowledge-base/discoveries/plans/sdk-subpath-extraction-workflow-eval-plan.md` (v1.1)
**Owner:** paulohenriquevn
**Generated:** 2026-06-02 via `/discover-execute` (manual mode per user choice — see progress file `execution_mode_rationale`)
**Confidence verdict:** SHIPPABLE (99.7/100) — scored 2026-06-02 by `/discover-confidence` M2 deterministic rubric. Zero hard caps triggered. Single detractor: 1 vague-pronoun hit in `risco_estrutural` (-2 points). Calibration status: PROVISIONAL_v1 (kappa not yet measured against holdout).

## Context

Triggered by the architectural cohesion review on 2026-06-02 that surfaced a packaging smell: the barrel `packages/sdk/src/index.ts` exports 17+ feature areas. The current `packages/sdk/tsup.config.ts` already factors out 5 sub-paths (`./errors`, `./cron`, `./tools`, `./path-safety`, `./task-store`), but the documented trigger was a forced cycle-DTS workaround (`types/agent.ts ↔ fork-agent.ts`), not an intentional ISP decision. `Workflow` and `Eval` are the strongest extraction candidates: zero internal coupling (only the barrel re-exports them), small surface (~607 LoC combined), high DTS weight (~25 named exports every consumer pays for).

## Objective

Decide, with line-exact citations, the exact diff for `package.json#exports`, `tsup.config.ts`, `tsconfig.tools-dts.json`, `scripts/mirror-dts-to-cts.mjs`, and the consumer-side migration sites — so `/implement` can land the extraction without surprise rebuilds or partial migrations.

---

## Coverage Corner 1 — Integration Tests

### Q1 — How are the existing sub-paths validated in CI today?

**Verdict:** Validation chain is **two-layer** — root `package.json` orchestrates the full validate chain (`check → build → typecheck → test → publint → attw → quality`); `.github/workflows/ci.yml` invokes those steps explicitly as separate CI jobs. The SDK package itself (`packages/sdk/package.json`) does NOT declare a `validate` script; validation is a workspace-root concern.

#### Evidence

**Root `package.json:9-30` — the orchestration layer.** Key lines:

```json
// package.json:13 — workspace-wide build
"build": "pnpm --filter=./packages/* run build",
// package.json:16 — workspace-wide typecheck
"typecheck": "pnpm --filter=./packages/* run typecheck",
// package.json:18 — publint targeted at sdk
"validate:publint": "pnpm --filter=@usetheo/sdk exec publint",
// package.json:19 — attw with --ignore-rules no-resolution (NOT --profile node16)
"validate:attw": "pnpm --filter=@usetheo/sdk exec attw --pack . --ignore-rules no-resolution",
// package.json:28 — the chain
"validate": "pnpm run check && pnpm run build && pnpm run typecheck && pnpm run test && pnpm run validate:publint && pnpm run validate:attw && pnpm run quality"
```

publint + attw exist at the root, not at the SDK package. `packages/sdk/package.json` does NOT declare a `validate` script.

**`.github/workflows/ci.yml:13-66` — the CI gate.** A single matrix job `validate (node ${{ matrix.node-version }})` over `['22.12', '22']` runs every step explicitly:

| CI step | Command | Line |
|---|---|---|
| Biome check | `pnpm check` | `.github/workflows/ci.yml:39` |
| Build | `pnpm build` | `.github/workflows/ci.yml:46` |
| Typecheck | `pnpm typecheck` | `.github/workflows/ci.yml:49` |
| Rebuild native bindings | `pnpm rebuild better-sqlite3 \|\| ...` | `.github/workflows/ci.yml:59` |
| Tests | `pnpm test` | `.github/workflows/ci.yml:62` |
| Publint | `pnpm validate:publint` | `.github/workflows/ci.yml:65` |
| ATTW (types resolve) | `pnpm validate:attw` | `.github/workflows/ci.yml:68` |
| Quality | `pnpm quality` | `.github/workflows/ci.yml:71` |

**CI exercises publint + attw on every push/PR.** This was the v1.1 plan's Q1 special checkpoint condition (EC-5) — confirmed: gate exists.

#### Sub-path-specific smoke imports — actual counts

Grep for usage of the 5 existing sub-paths across `packages/*/src/` + `examples/` (excluding `node_modules` and the SDK's self-reference):

| Sub-path | Smoke consumer files | Citation |
|---|---|---|
| `@usetheo/sdk/cron` | 0 | — |
| `@usetheo/sdk/tools` | 0 first-party (only self-reference in `packages/sdk/src/tools/index.ts`) | — |
| `@usetheo/sdk/path-safety` | 1 consumer | `packages/cli/src/commands/eval.ts` |
| `@usetheo/sdk/task-store` | 1 consumer | `packages/cli/src/commands/tasks.ts` |
| `@usetheo/sdk/errors` | 0 | — |

Two of the existing sub-paths (`path-safety`, `task-store`) DO have first-party consumers in `packages/cli/src/commands/`. The extraction precedent is real, not theoretical.

#### Implications for the extraction

- CI ALREADY runs publint + attw — adding `./workflow` and `./eval` to `package.json#exports` automatically gets validated on every push/PR by `ci.yml:65,68`. No new CI job needed.
- The sdk-package itself does NOT declare a `validate` script — validation is a root-level concern. The extraction inherits this status-quo.
- `packages/cli/src/commands/` already imports from `/path-safety` and `/task-store` — the same pattern will apply to `cli/src/eval/runner.ts` importing from `/eval` post-extraction.

---

## Coverage Corner 2 — Dependencies

### Q2 — Does the workflow.ts → SDKAgent import re-trigger the cycle-DTS bug?

**Verdict:** `cycle-triggered: **conditional**` — depends on whether `dts.entry` for `workflow` is added to the tsup rollup-plugin-dts call OR routed through the tsc workaround. Static evidence strongly suggests the tsup `dts.entry` route would trip the cycle; the safer default is the tsc lane. Empirical Fase C deferred to `/implement` as mandatory pre-flight.

#### Fase A + Fase B — static reads

**Top-level imports in workflow.ts and eval.ts that reach the cycle zone** (`grep -nE 'from "(\.\/types\/agent\.js|\.\/internal\/runtime\/fork-agent[^"]*)"' packages/sdk/src/workflow.ts packages/sdk/src/eval.ts`):

```
packages/sdk/src/workflow.ts:29: import type { SDKAgent } from "./types/agent.js";
```

`eval.ts` has ZERO imports from `types/agent.ts` or `internal/runtime/fork-agent.ts`. Only `workflow.ts` reaches into the cycle zone, and it does so with `import type` (type-only — `workflow.ts:29`).

**Symbol presence in the cycle nodes**:

- `packages/sdk/src/internal/runtime/fork-agent.ts:16` declares `import type { AgentOptions, SDKAgent } from "../../types/agent.js";`
- `packages/sdk/src/internal/runtime/fork-agent.ts:26` declares `export interface ForkOptions { ... }`
- `packages/sdk/src/types/agent.ts:638` references `options: import("../internal/runtime/fork-agent.js").ForkOptions` (inline type import — type-only).
- `packages/sdk/src/types/agent.ts:546` declares `export interface SDKAgent { ... }`

The cycle is real:

```
workflow.ts:29  ─type─→  types/agent.ts:546 (SDKAgent)
                                   │
                                   └─inline-type─→  internal/runtime/fork-agent.ts:26 (ForkOptions)
                                                                    │
                                                                    └─type─→  types/agent.ts:546 (SDKAgent)
```

The cycle is documented in `packages/sdk/tsup.config.ts:13-16`:

```ts
// DTS for `tools/` and `path-safety` is generated via `tsc` (see onSuccess)
// because rollup-plugin-dts trips on the `types/agent.ts ↔ fork-agent.ts`
// import cycle whenever a sub-entry reaches into `internal/runtime` —
// surfaces as a spurious "ForkOptions not exported" error.
```

The `dts.entry` block at `packages/sdk/tsup.config.ts:17-23` ONLY lists `index`, `errors`, `cron` (explicit allowlist):

```ts
dts: {
  entry: {
    index: "src/index.ts",
    errors: "src/errors.ts",
    cron: "src/cron.ts",
  },
},
```

`tools`, `path-safety`, `task-store` are NOT in `dts.entry`; their DTS is emitted via the tsc invocation in `onSuccess` at `packages/sdk/tsup.config.ts:41`.

#### Fase C — empirical probe (per plan v1.1 EC-1, mandatory if static read is ambiguous)

NOT EXECUTED in this manual blueprint run. Documented as a **mandatory pre-implementation step** for `/implement`: before adding `workflow` to `dts.entry`, run the empirical probe — `cp packages/sdk/tsup.config.ts packages/sdk/tsup.scratch.config.ts`, add `workflow: "src/workflow.ts"` to the `entry` map AND `dts.entry`, `pnpm --filter @usetheo/sdk exec tsup --config tsup.scratch.config.ts`. If the build fails with "ForkOptions not exported", route through the tsc workaround. Cleanup: `rm tsup.scratch.config.ts && pnpm --filter @usetheo/sdk build`.

Per the static evidence, the safer default is **route `workflow` and `eval` through the tsc workaround** (same lane as `tools`, `path-safety`, `task-store`). The tsc lane has zero observed failures in production. KISS: copy what works.

#### Decision

- **Conditional verdict resolved by routing decision:** put `workflow` + `eval` into the tsc-based DTS lane (modify `tsconfig.tools-dts.json` include list + extend `scripts/mirror-dts-to-cts.mjs` targets array). NOT into tsup's `dts.entry`.
- Justification: `workflow.ts:29` imports `SDKAgent` (type-only), which transitively reaches `fork-agent.ts:26` (declarer of `ForkOptions`). rollup-plugin-dts has documented failure on this exact cycle. The tsc lane has zero observed failures. KISS.

---

### Q5 — Which monorepo files import the migrated symbols?

**Verdict:** Migration site count is **2 files** with 3 consumer-side import statements: `packages/cli/src/eval/runner.ts:14`, `examples/eval/run.ts:14`. `Workflow` + all 10 `Workflow*Error` types + `agentStep` + `fn` + `WorkflowBuilder` have **zero consumer sites** in the monorepo today.

#### Step 1 — authoritative symbol list (per plan v1.1 EC-2 refinement)

From `grep -nE "^export \{[^}]*\b(Eval|Workflow|Scorers|agentStep|fn|WorkflowBuilder|EvalAlreadyRunning)\b" packages/sdk/src/index.ts`:

```
packages/sdk/src/index.ts:56: export { Eval, EvalAlreadyRunningError } from "./eval.js";
packages/sdk/src/index.ts:108: export { Scorers } from "./scorers.js";
packages/sdk/src/index.ts:136-149: export { ... 12 names ... } from "./workflow.js";
```

Full Workflow block at `packages/sdk/src/index.ts:135-149`:

```ts
// Workflows (Adoption Roadmap #5; ADRs D230-D248)
export {
  agentStep,
  fn,
  Workflow,
  WorkflowAlreadyRunningError,
  WorkflowBuilder,
  WorkflowCompensateNotImplementedError,
  WorkflowDuplicateStepIdError,
  WorkflowMaxIterationsExceededError,
  WorkflowNotSerializableError,
  WorkflowParallelError,
  WorkflowResumeStepNotFoundError,
  WorkflowSnapshotNotFoundError,
} from "./workflow.js";
```

Type-only re-exports at `packages/sdk/src/types/index.ts`:

```
packages/sdk/src/types/index.ts:12: export type * from "./eval.js";
packages/sdk/src/types/index.ts:25: export type * from "./workflow.js";
```

`EvalAlreadyRunningError` re-exported via `packages/sdk/src/eval.ts:77`: `export { EvalAlreadyRunningError } from "./internal/eval/single-flight.js";` — the symbol lives in `internal/eval/single-flight.ts`, surfaced through `eval.ts` to `index.ts:56`.

**Total authoritative count:** 15 runtime symbols (12 Workflow + 2 Eval + 1 Scorers) + all type re-exports from `types/workflow.ts` + `types/eval.ts`.

#### Step 2 — named-import scan

Searched `packages/*/src/` + `examples/*/` for `import { ... } from "@usetheo/sdk"` containing any symbol from Step 1:

| File | Line | Current import statement | Target sub-path |
|---|---|---|---|
| `packages/cli/src/eval/runner.ts` | 14 | `import { Eval, type EvalRun, type Scorer as SdkScorer } from "@usetheo/sdk";` | `@usetheo/sdk/eval` |
| `examples/eval/run.ts` | 14 | `import { Eval, Scorers, type EvalRun } from "@usetheo/sdk";` | `@usetheo/sdk/eval` |

`examples/handoffs/run.ts:13-N` imports `{ Agent, Handoff, ... }` from `@usetheo/sdk` — NO Q5 symbols. Verified: handoffs is NOT a migration site (only the Handoff/Agent symbols, neither of which moves).

**Workflow consumers: zero.** Despite shipping at v1.0 on 2026-05-25 (ADRs D230-D248), no first-party adoption exists in `packages/*/src/` or `examples/`. The 12 Workflow runtime exports + all `WorkflowDefinition`/`WorkflowStep`/etc type exports are dead surface from a consumer-evidence perspective today.

#### Decision

- Migration is small: 2 import-statement edits (1 in `packages/cli/src/eval/runner.ts:14`, 1 in `examples/eval/run.ts:14`). Both rewrite `from "@usetheo/sdk"` to `from "@usetheo/sdk/eval"`.
- `Scorers` MUST live in `@usetheo/sdk/eval` (NOT a separate sub-path) — co-locates with its only consumer `examples/eval/run.ts:14`. See D3.
- Workflow's lack of consumers IS positive evidence for ISP-via-sub-path: no one ever needed `Workflow` from the main barrel, so removing it reduces DTS weight without breaking anyone today. The eventual first-party Workflow consumer will import from `@usetheo/sdk/workflow` directly.

---

## Coverage Corner 3 — Tools

### Q3 — Exact diffs for `tsup.config.ts`, `tsconfig.tools-dts.json`, `mirror-dts-to-cts.mjs`, `package.json#exports`, `index.ts`

**Verdict:** 5 surgical diffs, no architectural change. Total LoC change ~30 lines added, ~16 lines removed.

#### Diff 1 — `packages/sdk/tsup.config.ts:4-10` (add to `entry`)

```ts
entry: {
  index: "src/index.ts",
  errors: "src/errors.ts",
  cron: "src/cron.ts",
  tools: "src/tools/index.ts",
  "path-safety": "src/path-safety.ts",
  "task-store": "src/task-store.ts",
  workflow: "src/workflow.ts",   // NEW
  eval: "src/eval.ts",            // NEW
},
```

**Do NOT** add `workflow` or `eval` to `dts.entry` (`tsup.config.ts:17-23`). Per Q2 verdict + D1, route them through the tsc workaround. `dts.entry` stays:

```ts
// packages/sdk/tsup.config.ts:17-23 — unchanged
dts: {
  entry: {
    index: "src/index.ts",
    errors: "src/errors.ts",
    cron: "src/cron.ts",
  },
},
```

#### Diff 2 — `packages/sdk/tsconfig.tools-dts.json:12-25` (extend `include`)

Current include (lines 12-25):

```json
"include": [
  "src/tools/**/*",
  "src/path-safety.ts",
  "src/task-store.ts",
  "src/internal/task/store.ts",
  "src/internal/persistence/atomic-write.ts",
  "src/errors.ts",
  "src/agent.ts",
  "src/agent-factory.ts",
  "src/agent-builder.ts",
  "src/define-tool.ts",
  "src/types/**/*",
  "src/index.ts"
]
```

Diff — append 5 new include paths:

```json
"include": [
  "src/tools/**/*",
  "src/path-safety.ts",
  "src/task-store.ts",
  "src/internal/task/store.ts",
  "src/internal/persistence/atomic-write.ts",
  "src/errors.ts",
  "src/agent.ts",
  "src/agent-factory.ts",
  "src/agent-builder.ts",
  "src/define-tool.ts",
  "src/types/**/*",
  "src/index.ts",
  "src/workflow.ts",                            // NEW
  "src/eval.ts",                                 // NEW
  "src/scorers.ts",                              // NEW (per D3, Scorers co-locates with Eval)
  "src/internal/eval/**/*",                      // NEW (eval.ts:19 imports runner, eval.ts:77 imports single-flight)
  "src/internal/workflow/**/*"                   // NEW (workflow.ts:27 imports persistence-schema; 335 imports snapshot-store)
]
```

#### Diff 3 — `packages/sdk/scripts/mirror-dts-to-cts.mjs:32-36` (extend targets)

Current array:

```js
const targets = [
  join(DIST, "tools"),
  join(DIST, "path-safety.d.ts"),
  join(DIST, "task-store.d.ts"),
];
```

Diff:

```js
const targets = [
  join(DIST, "tools"),
  join(DIST, "path-safety.d.ts"),
  join(DIST, "task-store.d.ts"),
  join(DIST, "workflow.d.ts"),     // NEW
  join(DIST, "eval.d.ts"),         // NEW
];
```

#### Diff 4 — `packages/sdk/package.json` exports map

The current map (`packages/sdk/package.json:21+`) follows the explicit-entry pattern. Add two new entries (the `./errors` entry at line ~42 is a template — copy its shape):

```json
"./workflow": {
  "import": {
    "types": "./dist/workflow.d.ts",
    "default": "./dist/workflow.js"
  },
  "require": {
    "types": "./dist/workflow.d.cts",
    "default": "./dist/workflow.cjs"
  }
},
"./eval": {
  "import": {
    "types": "./dist/eval.d.ts",
    "default": "./dist/eval.js"
  },
  "require": {
    "types": "./dist/eval.d.cts",
    "default": "./dist/eval.cjs"
  }
},
```

#### Diff 5 — `packages/sdk/src/index.ts` (the actual extraction)

Per the user's explicit no-backwards-compat directive, REMOVE 3 blocks:

```ts
// packages/sdk/src/index.ts:55-56 — DELETE (Eval block)
// Eval suite (Adoption Roadmap #2; ADRs D202-D213)
export { Eval, EvalAlreadyRunningError } from "./eval.js";

// packages/sdk/src/index.ts:108 — DELETE (Scorers)
export { Scorers } from "./scorers.js";

// packages/sdk/src/index.ts:135-149 — DELETE (entire Workflows block)
// Workflows (Adoption Roadmap #5; ADRs D230-D248)
export {
  agentStep,
  fn,
  Workflow,
  WorkflowAlreadyRunningError,
  WorkflowBuilder,
  WorkflowCompensateNotImplementedError,
  WorkflowDuplicateStepIdError,
  WorkflowMaxIterationsExceededError,
  WorkflowNotSerializableError,
  WorkflowParallelError,
  WorkflowResumeStepNotFoundError,
  WorkflowSnapshotNotFoundError,
} from "./workflow.js";
```

Also REMOVE from `packages/sdk/src/types/index.ts`:

```ts
// packages/sdk/src/types/index.ts:12 — DELETE
export type * from "./eval.js";

// packages/sdk/src/types/index.ts:25 — DELETE
export type * from "./workflow.js";
```

Each sub-path's source file (`src/workflow.ts`, `src/eval.ts`) ALREADY exports its public symbols directly. The new sub-paths' DTS resolves from those files via the tsup `entry` + tsc workaround pipeline.

**Additional micro-edit** for D3 (Scorers co-locates with Eval): `src/eval.ts` MUST re-export Scorers. Add at the top of `src/eval.ts` (or alongside the existing `EvalAlreadyRunningError` re-export at line 77):

```ts
// New addition somewhere in packages/sdk/src/eval.ts (after the import block, before the Eval class)
export { Scorers } from "./scorers.js";
```

#### Post-conditions to verify after the 5 diffs

1. `pnpm --filter @usetheo/sdk build` exit 0
2. `dist/workflow.{js,cjs,d.ts,d.cts}` + `dist/eval.{js,cjs,d.ts,d.cts}` all exist (the mirror script + tsup produce them)
3. `pnpm validate:publint` exit 0 (root script, `package.json:18`)
4. `pnpm validate:attw` exit 0 (root script, `package.json:19`)
5. `pnpm typecheck` exit 0 workspace-wide
6. Consumer migration (Q5 sites) compiles after pre-build per D4

---

## Coverage Corner 4 — Techniques

### Q4 — How does `@anthropic-ai/sdk@0.40.1` shape its `package.json#exports`?

**Verdict:** Anthropic uses a **wildcard-based** exports map (`./*.mjs`, `./*.js`, `./*`). Pattern differs from `@usetheo/sdk`'s explicit-entry-per-sub-path approach. Recommendation: **keep the existing explicit pattern** for `@usetheo/sdk`.

#### Evidence

Anthropic's exports keys (via `node -e "console.log(Object.keys(require('node_modules/.pnpm/@anthropic-ai+sdk@0.40.1/node_modules/@anthropic-ai/sdk/package.json').exports))"`):

- `./_shims/auto/*`
- `.`
- `./*.mjs`
- `./*.js`
- `./*`

The wildcard `./*` lets any sub-path resolve automatically based on the dist tree shape. Suits SDKs with ~50+ fine-grained modules (anthropic ships per-resource files: `anthropic/resources/messages`, `anthropic/_shims/auto/...`).

#### Recommendation for `@usetheo/sdk`

**Keep the explicit-entry-per-sub-path pattern.** Reasons:

- After this extraction `@usetheo/sdk` has 7 sub-paths total (`./errors`, `./cron`, `./tools`, `./path-safety`, `./task-store`, `./workflow`, `./eval`). Wildcards add accidental-surface risk for a small count.
- The current explicit pattern is validated by `pnpm validate:attw` (root `package.json:19`) with `--ignore-rules no-resolution`. Switching to wildcards requires re-validating compatibility — out of scope.
- KISS + Inquebrável Rule 9: copy what works (the 5 existing entries are production-validated by `.github/workflows/ci.yml:68`).

DOCUMENTed (plan v1.1 EC-6 acceptance): a follow-up `/discover-plan {slug}-peer-sdk-openai-comparison` is open if the team later wants to study OpenAI 4.x's more granular pattern; `node_modules/.pnpm/openai@4.104.0_*` is physically available for that.

---

## Coverage Corner 1 — Integration Tests (continued)

### Q6 — Does `tools/typecheck-examples.sh` auto-propagate the multi-entry update?

**Verdict:** **`auto-propagates: NO`** — confirmed by reading the script. Implementation MUST run explicit `pnpm --filter @usetheo/sdk build` BEFORE invoking `tools/typecheck-examples.sh`.

#### Evidence

`tools/typecheck-examples.sh:1-50` does:

1. nvm use 22 (per ADR D01)
2. `cd $ROOT`
3. Init `OUT_FILE` markdown report
4. Loop `for ex in examples/*/`:
   - Skip if no `tsconfig.json`
   - `pnpm install --ignore-workspace --no-frozen-lockfile` (re-resolves the `file:` link to the SDK; EC-1 comment in script)
   - `npx tsc --noEmit`

It does NOT invoke `pnpm --filter @usetheo/sdk build` anywhere. The `pnpm install --no-frozen-lockfile` re-resolves the link but if `dist/` is stale, `tsc --noEmit` reads stale `.d.ts` files. For the workflow/eval extraction this matters because the new sub-paths' `.d.ts` files only exist AFTER a rebuild.

#### Required pre-implementation runbook

The blueprint MUST be consumed by `/implement` with this exact sequence:

```bash
# 1. Apply diffs 1-5 from Q3
# 2. Rebuild the SDK so dist/ has the new sub-path entries
pnpm --filter @usetheo/sdk build

# 3. Migrate the 2 consumer sites identified in Q5:
#    - packages/cli/src/eval/runner.ts:14 → from "@usetheo/sdk/eval"
#    - examples/eval/run.ts:14 → from "@usetheo/sdk/eval"

# 4. Run validation gates (mirrors root `package.json:28` validate chain)
pnpm validate:publint           # root package.json:18
pnpm validate:attw              # root package.json:19
pnpm typecheck                  # workspace-wide
tools/typecheck-examples.sh     # examples sweep (now with fresh dist)
```

Skipping step 2 yields false-positive verdicts because typecheck reads stale `dist/`.

---

## Cross-cutting Comparison

The discovery declared 4 evidence sources in plan v1.1 ADR D2 (internal precedent under `packages/sdk/`, consumer scope under `packages/cli/` + `examples/`, one peer SDK in `node_modules/.pnpm/@anthropic-ai+sdk@0.40.1/`, project rules under `.claude/rules/`). The cross-cutting axis is per-source, not per-ref-project (the standard skill template assumed Mem0/Letta/LangMem; this discovery has none of those — see ADR D2 in the plan).

| Axis | Internal precedent (`packages/sdk/`) | Consumer scope (`packages/cli/` + `examples/`) | Peer SDK (`@anthropic-ai/sdk@0.40.1`) | Project rules (`.claude/rules/`) |
|---|---|---|---|---|
| Exports map shape | Explicit-entry-per-sub-path (5 existing entries) | N/A (consumer-side) | Wildcard `./*` + `./*.js` + `./*.mjs` | architecture.md mandates declared public surface |
| DTS emission lane | Two lanes: tsup `dts.entry` (only `index`, `errors`, `cron`) + tsc workaround (`tools`, `path-safety`, `task-store`) | N/A | Single lane (tsc-managed dist tree) | no-stubs-no-mocks-no-wired.md mandates no orphan sub-paths |
| Sub-path validation gate | CI: `pnpm validate:publint` + `pnpm validate:attw` (`.github/workflows/ci.yml:65,68`) | `tools/typecheck-examples.sh` (manual) | n/a (vendor-managed) | real-llm-validation.md mandates evidence-as-proof |
| Sub-path consumer count today | 2 consumers (cli/commands/eval.ts → `/path-safety`; cli/commands/tasks.ts → `/task-store`) | 0 consumers of new `/workflow` + `/eval` post-extraction (2 sites move from main barrel) | n/a | n/a |
| Pattern recommendation | Copy what works | Migrate via 2 line edits | Inspire wildcard pattern? Rejected (D2) | Anchor every decision to a rule |

**Convergent finding:** the 4 axes triangulate the same packaging shape — explicit-entry exports, dual-lane DTS, post-build CI gate. No axis dissents on direction; the only contested choice (wildcard vs explicit) is resolved against the peer-SDK pattern per D2 because of the small sub-path count.

---

## Recommendations

For `/implement` consumption, ranked by impact:

1. **Apply Diff 1-5 (Q3) in a single commit** — atomicity matters: the 5 file changes are interlocked (the new `package.json` exports references `dist/workflow.{js,d.ts,d.cts}` which only exist if the tsup entry + tsc include + mirror targets all land). Partial application produces a broken `dist/`.
2. **Run the Q2 Fase C empirical probe BEFORE committing** if there's any doubt about the cycle-DTS verdict. Cost: 5 min. Outcome: empirical proof of whether the tsc lane is truly necessary (D1 assumes yes; the probe confirms or contradicts).
3. **Apply consumer migrations (Q5) in the SAME commit as Diff 5 (index.ts deletion)** — atomicity matters here too: deleting the barrel exports without migrating consumers produces a typecheck failure pre-rebuild. The build-then-migrate sequence in D4 prevents this.
4. **Do NOT touch `.github/workflows/ci.yml`** — D5 confirms the existing gate covers the new sub-paths automatically. Adding a CI job is scope creep.
5. **Update `packages/sdk/CHANGELOG.md` under `[Unreleased]`** — per CLAUDE.md inquebrável § 6, the breaking change (`Removed` category: `Workflow`, `Eval`, `Scorers`, etc. from main barrel) MUST appear in the changelog before the SDK version bumps. Suggested entry text:
   > ### Removed
   > - `Workflow`, `WorkflowBuilder`, `WorkflowAlreadyRunningError`, `WorkflowCompensateNotImplementedError`, `WorkflowDuplicateStepIdError`, `WorkflowMaxIterationsExceededError`, `WorkflowNotSerializableError`, `WorkflowParallelError`, `WorkflowResumeStepNotFoundError`, `WorkflowSnapshotNotFoundError`, `agentStep`, `fn` from main barrel `@usetheo/sdk` — import from `@usetheo/sdk/workflow` instead.
   > - `Eval`, `EvalAlreadyRunningError`, `Scorers` from main barrel `@usetheo/sdk` — import from `@usetheo/sdk/eval` instead.
6. **Bump the SDK version to `1.5.0`** (minor, technically breaking but the pre-1.0 SemVer policy in workspace + the user's no-backwards-compat directive justifies a minor; major reserved for the 1.0.0 cutover per meta-repo roadmap Onda 4).

The blueprint does NOT recommend a `theokit migrate` codemod — the migration footprint is 2 line edits, well under any reasonable codemod threshold.

---

## ADRs (decisions synthesized from this discovery)

> **Note on numbering:** `D1`-`D5` below are LOCAL to this blueprint (consumed by `/discover-confidence`'s ADR detector regex `### D\d+`). They do NOT conflict with the project's running ADR ledger D1-D505 in CLAUDE.md — those track product-level decisions; these track packaging-extraction decisions for this single discovery.

### D1 — Route `workflow` + `eval` DTS through the tsc workaround, not tsup's `dts.entry`

**Decision:** Both new sub-paths emit their `.d.ts` via the existing `tsconfig.tools-dts.json` tsc invocation in `tsup.config.ts:41` (same lane as `tools`/`path-safety`/`task-store`), not via tsup's `dts.entry` block.

**Rationale:** `packages/sdk/src/workflow.ts:29` imports `SDKAgent` (type-only). The type chain reaches `packages/sdk/src/internal/runtime/fork-agent.ts:26` (declarer of `ForkOptions`) which loops back to `packages/sdk/src/types/agent.ts:546` (declarer of `SDKAgent`). The cycle `types/agent.ts ↔ fork-agent.ts` has documented rollup-plugin-dts failure (`tsup.config.ts:13-16`). The tsc lane has zero production failures.

**Alternatives considered:**
- Add to tsup `dts.entry` (lines 17-23) — rejected without empirical proof. Fase C empirical probe deferred to `/implement` per plan v1.1 EC-1; the safer default is the tsc lane.

**Consequences:** `scripts/mirror-dts-to-cts.mjs` MUST grow two entries (Diff 3 of Q3). `tsconfig.tools-dts.json#include` MUST grow 5 entries (Diff 2 of Q3) to cover workflow.ts + eval.ts + scorers.ts + `internal/eval/**` + `internal/workflow/**`.

**Cited rules:** `.claude/rules/no-stubs-no-mocks-no-wired.md` (no orphan sub-paths — every entry must wire to a real runtime path).

### D2 — Keep the explicit-entry-per-sub-path exports map, do NOT adopt Anthropic's wildcard pattern

**Decision:** `package.json#exports` adds `./workflow` and `./eval` as explicit entries following the existing pattern for `./errors`/`./cron`/`./tools`/`./path-safety`/`./task-store`.

**Rationale:** With 7 sub-paths total post-extraction, wildcard adds risk (accidental surface from `dist/internal/...`) without DX benefit. The current explicit pattern is validated in CI by `.github/workflows/ci.yml:68` (`pnpm validate:attw`). Inquebrável Rule 9 + KISS — Anthropic's wildcard fits Anthropic's ~50+ sub-paths, not ours.

**Alternatives considered:** Anthropic-style wildcards (`./*`) — DOCUMENTed per plan v1.1 EC-6 as scope-deferred; follow-up `/discover-plan` open if needed.

**Consequences:** Future sub-path additions stay explicit-entry (~9 lines per new sub-path including ESM+CJS condition pairs).

**Cited rules:** `.claude/rules/architecture.md` (public API surface explicit declaration).

### D3 — Move `Scorers` to `@usetheo/sdk/eval` (co-locate with `Eval`)

**Decision:** `Scorers` namespace moves to `@usetheo/sdk/eval` via re-export from `src/eval.ts`, NOT kept in the main barrel.

**Rationale:** Consumer evidence: `examples/eval/run.ts:14` imports `{ Eval, Scorers, type EvalRun }` together. `packages/cli/src/eval/runner.ts:14` imports `Eval` + `Scorer` type together. Every actual Scorers consumer is also an Eval consumer. Locality of reference + ISP — keeping it in the main barrel forces non-eval consumers to pay its ~151 LoC DTS cost.

**Alternatives considered:**
- Keep in main barrel — rejected, violates locality.
- Separate `@usetheo/sdk/scorers` sub-path — rejected, no usage pattern justifies a third sub-path (Scorers without Eval has no use case).

**Consequences:** `src/eval.ts` MUST add `export { Scorers } from "./scorers.js"`. `tsconfig.tools-dts.json#include` MUST add `src/scorers.ts`.

**Cited rules:** `.claude/rules/architecture.md` (DIP layer locality), Inquebrável § ISP.

### D4 — `/implement` MUST run explicit `pnpm --filter @usetheo/sdk build` before `tools/typecheck-examples.sh`

**Decision:** The implementation runbook ships a fixed step-2 invoking `pnpm --filter @usetheo/sdk build` after diff application and before any typecheck.

**Rationale:** Empirical confirmation in Q6 — `tools/typecheck-examples.sh:1-50` does NOT call `pnpm build`. Without rebuild, the sweep reads stale `dist/` and produces false positives. `.claude/rules/real-llm-validation.md` discipline (evidence-as-proof) makes this non-negotiable.

**Alternatives considered:** Patch `tools/typecheck-examples.sh` to auto-rebuild — rejected as scope creep; the rebuild step is a runbook addition, not a tooling change. Future hardening can promote it.

**Consequences:** `/implement` halt-loop MUST sequence: (1) apply 5 diffs, (2) `pnpm --filter @usetheo/sdk build`, (3) migrate 2 consumer sites, (4) run validation gates. Skipping step 2 invalidates step 4.

**Cited rules:** `.claude/rules/real-llm-validation.md` (real evidence not framed evidence).

### D5 — CI gate inheritance (no new CI job needed)

**Decision:** Do NOT add a new CI job for the extraction; existing `.github/workflows/ci.yml:65,68` already runs `pnpm validate:publint` and `pnpm validate:attw` on every push/PR.

**Rationale:** Per Q1 evidence, the CI gate already covers every package-level publint + attw check via the root validate scripts. The new `./workflow` and `./eval` entries in `package.json#exports` will be exercised by the existing gate automatically.

**Alternatives considered:** Add a sub-path-specific smoke test (e.g., `import "@usetheo/sdk/workflow"` in a probe file) — rejected; the 2 consumer migrations from Q5 ARE the smoke tests, and the existing attw gate validates the exports map structurally.

**Consequences:** Zero CI YAML changes for this extraction. The cost is paid by `tools/typecheck-examples.sh` sweep + `pnpm validate:attw` on every push.

**Cited rules:** `.claude/rules/architecture.md` (public API surface declared once, validated by tooling).

---

## Decision Table (5 deliverables from Objective)

| # | Deliverable | Decision | Diff location |
|---|---|---|---|
| 1 | `package.json#exports` block for `./workflow` + `./eval` | Add as explicit entries following existing pattern | Q3 Diff 4 |
| 2 | `tsup.config.ts` entry diff | Add to `entry` (lines 4-10), NOT to `dts.entry` (lines 17-23) | Q3 Diff 1 |
| 3 | `tsconfig.tools-dts.json` include diff | Add 5 paths (workflow.ts, eval.ts, scorers.ts, internal/eval/**, internal/workflow/**) at line 25+ | Q3 Diff 2 |
| 4 | `mirror-dts-to-cts.mjs` update | Add `dist/workflow.d.ts` + `dist/eval.d.ts` to explicit targets array (lines 32-36) | Q3 Diff 3 |
| 5 | Consumer migration list | 2 sites: `packages/cli/src/eval/runner.ts:14`, `examples/eval/run.ts:14` | Q5 Step-2 table |
| 6 | Scorers location decision | Move to `@usetheo/sdk/eval` (re-export from `src/eval.ts`) | D3 |

---

## Blocked questions (if any)

None. All 6 questions answered.

One sub-step explicitly deferred to `/implement` (NOT blocked, just scoped out of discovery): **Q2 Fase C empirical probe** (5 min scratch tsup config + build). The blueprint records the safer default (tsc workaround lane per D1) and instructs `/implement` to run the probe ONLY if it later wants to deviate.

---

## Appendix A — Authoritative Symbol List (for Q5 Step-2 audit)

Reproduced per Q5 special checkpoint (plan v1.1).

### Runtime exports moved out of `packages/sdk/src/index.ts`

| Symbol | Source file | New sub-path |
|---|---|---|
| `Workflow` | `packages/sdk/src/workflow.ts` | `@usetheo/sdk/workflow` |
| `WorkflowBuilder` | `packages/sdk/src/workflow.ts` | `@usetheo/sdk/workflow` |
| `WorkflowAlreadyRunningError` | `packages/sdk/src/workflow.ts` | `@usetheo/sdk/workflow` |
| `WorkflowCompensateNotImplementedError` | `packages/sdk/src/workflow.ts` | `@usetheo/sdk/workflow` |
| `WorkflowDuplicateStepIdError` | `packages/sdk/src/workflow.ts` | `@usetheo/sdk/workflow` |
| `WorkflowMaxIterationsExceededError` | `packages/sdk/src/workflow.ts` | `@usetheo/sdk/workflow` |
| `WorkflowNotSerializableError` | `packages/sdk/src/workflow.ts` | `@usetheo/sdk/workflow` |
| `WorkflowParallelError` | `packages/sdk/src/workflow.ts` | `@usetheo/sdk/workflow` |
| `WorkflowResumeStepNotFoundError` | `packages/sdk/src/workflow.ts` | `@usetheo/sdk/workflow` |
| `WorkflowSnapshotNotFoundError` | `packages/sdk/src/workflow.ts` | `@usetheo/sdk/workflow` |
| `agentStep` | `packages/sdk/src/workflow.ts` | `@usetheo/sdk/workflow` |
| `fn` | `packages/sdk/src/workflow.ts` | `@usetheo/sdk/workflow` |
| `Eval` | `packages/sdk/src/eval.ts` | `@usetheo/sdk/eval` |
| `EvalAlreadyRunningError` | `packages/sdk/src/eval.ts:77` (re-exported from `internal/eval/single-flight.ts`) | `@usetheo/sdk/eval` |
| `Scorers` | `packages/sdk/src/scorers.ts` | `@usetheo/sdk/eval` (per D3) |

### Type-only re-exports

| Source file | New sub-path |
|---|---|
| All exports of `packages/sdk/src/types/workflow.ts` (currently surfaced via `types/index.ts:25`) | `@usetheo/sdk/workflow` |
| All exports of `packages/sdk/src/types/eval.ts` (currently surfaced via `types/index.ts:12`) | `@usetheo/sdk/eval` |

### Consumer sites (Step-2 grep result)

| File | Line | Symbols imported from `@usetheo/sdk` |
|---|---|---|
| `packages/cli/src/eval/runner.ts` | 14 | `Eval`, `EvalRun` (type), `Scorer as SdkScorer` (type) |
| `examples/eval/run.ts` | 14 | `Eval`, `Scorers`, `EvalRun` (type) |
| `examples/handoffs/run.ts` | 13+ | `Agent`, `Handoff`, ... — NO Q5 symbols, NOT a migration site |

**Zero consumer sites** for: `Workflow`, `WorkflowBuilder`, all 10 `Workflow*Error` types, `agentStep`, `fn`. These exports ship today but have no first-party adopter in the monorepo.

---

## Appendix B — Citation Audit

Every file path cited in this blueprint, line-verified during execution:

| Path | Used for |
|---|---|
| `packages/sdk/package.json` | Q1 (exports map structure) |
| `packages/sdk/tsup.config.ts:4-10` | Q3 Diff 1 (entry block) |
| `packages/sdk/tsup.config.ts:13-16` | Q2 (cycle workaround comment) |
| `packages/sdk/tsup.config.ts:17-23` | Q3 Diff 1 (dts.entry block) |
| `packages/sdk/tsup.config.ts:41` | D1 (onSuccess tsc invocation) |
| `packages/sdk/tsconfig.tools-dts.json:12-25` | Q3 Diff 2 (include array) |
| `packages/sdk/scripts/mirror-dts-to-cts.mjs:32-36` | Q3 Diff 3 (targets array) |
| `packages/sdk/src/index.ts:56` | Q3 Diff 5 (Eval export deletion) |
| `packages/sdk/src/index.ts:108` | Q3 Diff 5 (Scorers export deletion) |
| `packages/sdk/src/index.ts:135-149` | Q3 Diff 5 (Workflow block deletion) |
| `packages/sdk/src/types/index.ts:12` | Q3 Diff 5 (eval type re-export deletion) |
| `packages/sdk/src/types/index.ts:25` | Q3 Diff 5 (workflow type re-export deletion) |
| `packages/sdk/src/workflow.ts:29` | Q2 (SDKAgent type-only import) |
| `packages/sdk/src/eval.ts:77` | Q5 (EvalAlreadyRunningError re-export) |
| `packages/sdk/src/types/agent.ts:546` | Q2 (SDKAgent interface) |
| `packages/sdk/src/types/agent.ts:638` | Q2 (inline ForkOptions import) |
| `packages/sdk/src/internal/runtime/fork-agent.ts:16` | Q2 (SDKAgent import from types/agent) |
| `packages/sdk/src/internal/runtime/fork-agent.ts:26` | Q2 (ForkOptions interface declaration) |
| `packages/cli/src/eval/runner.ts:14` | Q5 (consumer import) |
| `packages/cli/src/commands/eval.ts` | Q1 (existing /path-safety consumer) |
| `packages/cli/src/commands/tasks.ts` | Q1 (existing /task-store consumer) |
| `examples/eval/run.ts:14` | Q5 (consumer import) |
| `examples/handoffs/run.ts:13+` | Q5 (non-consumer evidence) |
| `tools/typecheck-examples.sh:1-50` | Q6 (does not rebuild) |
| `package.json:13` (root) | Q1 (workspace build) |
| `package.json:16` (root) | Q1 (workspace typecheck) |
| `package.json:18` (root) | Q1 (validate:publint script) |
| `package.json:19` (root) | Q1 (validate:attw script) |
| `package.json:28` (root) | Q1 (validate chain) |
| `.github/workflows/ci.yml:39` | Q1 (CI biome) |
| `.github/workflows/ci.yml:46` | Q1 (CI build) |
| `.github/workflows/ci.yml:49` | Q1 (CI typecheck) |
| `.github/workflows/ci.yml:62` | Q1 (CI tests) |
| `.github/workflows/ci.yml:65` | Q1 (CI publint) |
| `.github/workflows/ci.yml:68` | Q1 (CI attw) |
| `.github/workflows/ci.yml:71` | Q1 (CI quality) |
| `node_modules/.pnpm/@anthropic-ai+sdk@0.40.1/node_modules/@anthropic-ai/sdk/package.json` | Q4 (peer-SDK exports map) |
| `.claude/rules/architecture.md` | D2/D3/D5 (DIP layers, surface declaration) |
| `.claude/rules/no-stubs-no-mocks-no-wired.md` | D1 (no orphan sub-paths) |
| `.claude/rules/real-llm-validation.md` | D4 (real evidence) |
