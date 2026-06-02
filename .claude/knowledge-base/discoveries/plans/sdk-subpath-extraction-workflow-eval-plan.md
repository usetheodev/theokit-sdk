# Discovery Plan: Extract `Workflow` + `Eval` from `@usetheo/sdk` main barrel into dedicated sub-paths

> **Version 1.1** — investigate how the SDK should expose `Workflow` + `Eval` (+ companion `Scorers`/errors/types) as dedicated package sub-paths (`@usetheo/sdk/workflow`, `@usetheo/sdk/eval`) instead of the main barrel. Output blueprint will declare the exports-map shape, the tsup/tsc DTS wiring, the consumer-side blast radius across the monorepo, and the cycle-DTS risk profile for `workflow.ts → SDKAgent → fork-agent.ts`. **No backwards-compat is preserved** — the symbols are removed from `index.ts` entirely.

**Slug:** `sdk-subpath-extraction-workflow-eval`
**Owner:** paulohenriquevn
**Created:** 2026-06-02
**Last revised:** 2026-06-02 (v1.0 → v1.1 — absorbs EC-1/EC-2/EC-3/EC-4/EC-5 from `.claude/knowledge-base/reviews/sdk-subpath-extraction-workflow-eval-edge-cases-2026-06-02.md`)
**Time budget:** 3h05 total (per-source breakdown in ADR D1; +5 min for Q2 empirical fallback added in v1.1)

## Context

The architectural cohesion review on 2026-06-02 surfaced a packaging smell: the barrel `packages/sdk/src/index.ts` exports 17+ feature areas (Agent, Cron, Budget, Cache, Eval, Handoff, Memory, Plugin, Workflow, Task, Theokit, Scorers, Security, GenerateObject, StreamObject, AgentBuilder, AgentFactory, Trajectory). The current `packages/sdk/tsup.config.ts` already factors out 5 sub-paths (`./errors`, `./cron`, `./tools`, `./path-safety`, `./task-store`), but the explicit comment at `packages/sdk/src/index.ts:115-120` documents the trigger was a **forced cycle-DTS workaround** for `types/agent.ts ↔ fork-agent.ts` — not an intentional Interface-Segregation decision.

`Workflow` (`src/workflow.ts:1-379`) and `Eval` (`src/eval.ts:1-77`) are the strongest candidates because:

1. **Zero internal coupling** — no file under `packages/sdk/src/` imports from `./workflow` or `./eval` except the barrel `index.ts` and the type-barrel `types/index.ts`.
2. **Small surface** — workflow.ts (379 LoC) + eval.ts (77 LoC) + scorers.ts (151 LoC) = 607 LoC, isolated from the rest.
3. **High DTS weight** — both pull a long error-class taxonomy (`Workflow*Error` × 8, `EvalAlreadyRunningError`, `Scorers` namespace, `agentStep`, `fn`, `WorkflowBuilder`) that every consumer of `@usetheo/sdk` currently pays for at type-resolution time, even if they only use `Agent`.

This discovery exists to lock the HOW (exports-map, tsup wiring, cycle-DTS strategy, consumer migration scope) **before** an implementation plan in `/to-plan`. The user has explicitly waived backwards-compatibility: the symbols are REMOVED from the main barrel and only available under the sub-paths.

Triggering evidence:

- `packages/sdk/src/index.ts:115-120` — comment documenting the path-safety sub-path was a forced workaround, not an architectural choice.
- `packages/sdk/tsup.config.ts:6-14` — current multi-entry config + DTS subset comment.
- `packages/sdk/tsconfig.tools-dts.json:15-26` — narrow `include` whitelist used to dodge the cycle.
- `packages/sdk/scripts/mirror-dts-to-cts.mjs` — existing mirror step needed because tsup's DTS plugin produces `.d.ts` only.
- `packages/cli/src/eval/runner.ts:14` — current consumer site for `Eval` re-import after extraction.
- Project rule `.claude/rules/no-stubs-no-mocks-no-wired.md` — any extracted symbol must remain wired to a real runtime path; "extract" must not become "orphan".

## Objective

Produce a blueprint that lets us decide, with line-exact citations:

1. The exact `package.json#exports` block for `./workflow` + `./eval`.
2. The exact `tsup.config.ts` entry diff + whether `tsconfig.tools-dts.json` needs to add `src/workflow.ts` + `src/eval.ts` to its `include` whitelist.
3. Whether `workflow.ts → types/agent.ts → fork-agent.ts → types/agent.ts` (the documented cycle) will trigger when DTS is generated via tsup vs via tsc.
4. The consumer-side blast radius across `packages/cli/`, `packages/react/`, `packages/acp/`, `packages/gateway*/`, `examples/eval/`, `examples/handoffs/`.
5. Whether `Scorers` + `agentStep` + `fn` move under `./eval` and `./workflow` respectively, or stay in the main barrel (each lives in its own file: `scorers.ts:1-151`, and `agentStep`/`fn` are exported by `workflow.ts`).

Success criteria for the resulting blueprint:

- [ ] All 6 research questions answered with file:line citations to `packages/sdk/`, `packages/cli/`, `examples/`, `.claude/rules/`, or `node_modules/.pnpm/@anthropic-ai+sdk@0.40.1/`
- [ ] Decision table populated for the 5 deliverables listed above
- [ ] Recommendations section provides ≥1 concrete decision proposal per question
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per source)

| Source | In-scope paths | Reason |
|---|---|---|
| `packages/sdk/` (internal precedent) | `src/index.ts`, `src/workflow.ts`, `src/eval.ts`, `src/scorers.ts`, `src/path-safety.ts`, `src/task-store.ts`, `src/cron.ts`, `src/types/agent.ts`, `src/types/workflow.ts`, `src/types/eval.ts`, `src/internal/eval/runner.ts`, `src/internal/runtime/fork-agent.ts`, `src/internal/workflow/`, `package.json`, `tsup.config.ts`, `tsconfig.tools-dts.json`, `scripts/mirror-dts-to-cts.mjs` | Existing sub-path precedent for `./tools`, `./path-safety`, `./cron`, `./task-store`, `./errors` is the load-bearing reference. The workaround already shipped — we copy the pattern, we don't reinvent. |
| `packages/cli/src/` | `eval/runner.ts`, `eval/types.ts`, `eval/config-loader.ts`, `eval/report.ts`, `commands/inspect.ts`, `commands/tasks.ts`, `main.ts` | First-party consumer of `Eval` from the SDK barrel. Drives the import-site migration scope. |
| `examples/` | `eval/run.ts`, `handoffs/run.ts`, and any other `examples/*/run.ts` matching `Workflow\|Eval\|Scorers` | Real-LLM-validated examples per `.claude/rules/real-llm-validation.md`. Their typecheck via `tools/typecheck-examples.sh` is the CI gate for the extraction. |
| `node_modules/.pnpm/@anthropic-ai+sdk@0.40.1/node_modules/@anthropic-ai/sdk/` | `package.json#exports` only | Peer-SDK reference for how a mature, dual-format TS SDK structures its exports map. |
| `.claude/rules/` | `architecture.md`, `no-stubs-no-mocks-no-wired.md`, `real-llm-validation.md` | Project rules every extraction decision must respect (DIP layers, no orphan exports, real-LLM-validation gate). |

### Out-of-Scope (explicit)

| Source / Path | Why excluded |
|---|---|
| `.claude/knowledge-base/references/` | Empty (`.gitkeep` only) at the time of this plan; no ref-projects to investigate. Documented in ADR D2. |
| `referencia/{mastra,openai-agents-python,pi,cookbook,hermes-agent}/` | Directories exist but are empty as of 2026-06-02. Cannot serve as evidence. Documented in ADR D2. |
| `packages/orm/`, `packages/di/`, `packages/di-agent/`, `packages/memory-*`, `packages/gateway-*`, `packages/skills-*` | None of these import `Workflow` / `Eval` / `Scorers` from `@usetheo/sdk` (verified by grep — see Q5 Fase A); they don't sit on the migration path. |
| `packages/react/`, `packages/acp/` | Verified by grep: no references to `Workflow` / `Eval` / `Scorers`; excluded from the consumer scan. |
| Workflow/Eval **runtime behavior** | This discovery is packaging-only. The runtime contract of `Workflow.create/.run/.resume` and `Eval.create/.run` is locked by ADRs D230-D266 + D202-D213 and is NOT being modified. |
| Breaking-change migration shims, codemods, deprecation warnings | User explicitly waived backwards-compat. No shims. The barrel just stops exporting the symbols. |
| `Memory`, `Cache`, `Handoff`, `Budget`, `Task`, `Plugin` sub-paths | Out of scope for this discovery. Listed only as future candidates. |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** Per-source budget — internal precedent 1h, cycle-DTS probe 1h, consumer blast radius 0.5h, peer-SDK + project-rule synthesis 0.5h. Total 3h.

**Rationale:** Internal precedent (`tsup.config.ts` + `tsconfig.tools-dts.json` + `mirror-dts-to-cts.mjs`) is the dominant evidence source — it's already-shipped code that we replicate. The cycle-DTS probe is the highest-risk unknown (Q2) and merits time. Consumer blast radius is well-scoped by grep (5 known import sites). Peer-SDK + rules are confirmation, not exploration.

**Alternatives considered:**
- Equal split across 6 questions (30min each) — rejected because Q3 (tooling) is almost-copy-paste from existing config; spending 30 min on it would underspend the cycle-DTS probe.
- No time budget — rejected because halt-loop in `/discover-execute` needs a stop signal.

**Stop condition — per question (mandatory):** When a question's Fase A returns empty matches after 3 consecutive retries with different query variants, mark the question BLOCKED with reason "Fase A exhausted — no hotspots found" and continue to the next. Do NOT pad with unrelated hotspots from a different question's scope.

**Stop condition — per source (mandatory):** When a source's time budget is exhausted with N questions still pending, mark all remaining questions for that source as BLOCKED with reason "budget exhausted" and emit the honest blocked-questions report.

**Anti-pattern:** NEVER fabricate Fase B answers to close a question whose Fase A was exhausted. Honest BLOCKED with reason is required (CLAUDE.md Rule 3 — extreme honesty).

**Consequences:** The halt-loop in `/discover-execute` will respect the per-source budget. Unanswered questions become the seed for a follow-up discovery — they don't silently disappear.

### D2 — Investigation sources (deviation from default skill template)

**Decision:** Treat `.claude/knowledge-base/references/` and `referencia/` as **out-of-scope-because-empty**. Use four real evidence sources instead: (a) `packages/sdk/` internal precedent (sub-paths already shipped), (b) `packages/cli/src/` + `examples/` as consumer scope, (c) `node_modules/.pnpm/@anthropic-ai+sdk@0.40.1/.../package.json` as the only available peer-SDK reference, (d) `.claude/rules/` for the design constraints every decision must respect.

**Rationale:** Both standard reference roots are empty as of 2026-06-02 (verified via `ls -la`). The honest path is to declare this and substitute with sources that DO exist. The internal precedent is also load-bearing: this is the second extraction of a sub-path (after `path-safety`/`tools`/`cron`/`task-store`/`errors`), so the existing config + workaround is the dominant reference, not a peer SDK.

**Alternatives considered:**
- Abort the discovery and ask the user to clone Mastra/OpenAI-Agents-Python into `referencia/` first — rejected: the user explicitly wants the plan now; the missing refs aren't blocking because internal precedent covers 80% of the decision surface.
- Use only internal precedent — rejected: one peer SDK exports-map reference (Anthropic) is cheap to fetch and validates the exports shape against an industry-mature pattern (mitigates Rule 9 "don't reinvent" risk).

**Consequences:** The blueprint cannot cite Mastra-style Workflow ergonomics or OpenAI-Agents-Python eval framing. Those become out-of-scope for THIS discovery; if they matter later, a follow-up `/discover-plan` runs once the refs are cloned. This discovery's scope is **packaging**, not API ergonomics — the API surface is locked.

### D3 — Investigation depth

**Decision:** Read each in-scope file end-to-end for `tsup.config.ts`, `tsconfig.tools-dts.json`, `scripts/mirror-dts-to-cts.mjs`, `package.json` (sdk), `src/workflow.ts`, `src/eval.ts`. Grep + targeted Read for the rest.

**Rationale:** The configuration files are short (each < 50 LoC) and dense — every line carries decision weight. `workflow.ts` (379 LoC) carries the cycle-DTS risk surface and must be understood in full. Other files (consumers, examples) are scanned for import-sites only.

**Consequences:** Higher cost on configuration files; lower cost on bulk consumer scanning. Total stays inside D1's 3h budget.

### D4 — Project rule alignment

**Decision:** Every decision in the blueprint MUST cite which `.claude/rules/` file it respects (architecture.md DIP layers, no-stubs.md "no orphan exports", real-llm-validation.md for example coverage).

**Rationale:** Inquebrável rule #9 + cycle-discover Golden Rule requires ADRs to anchor in project principles, not vibes.

**Consequences:** Blueprint sections without a rule citation are flagged in `/discover-confidence` as `unsourced`.

### D5 — Edge-case absorption (v1.0 → v1.1)

**Decision:** The five edge cases raised in `.claude/knowledge-base/reviews/sdk-subpath-extraction-workflow-eval-edge-cases-2026-06-02.md` are absorbed into this plan as method refinements + halt-loop checkpoints, with no scope expansion.

- **EC-1 (Q2 empirical fallback):** Added as Fase C in Q2 row — 5 min scratch tsup config + build to deterministically verify the cycle-DTS verdict when static read is ambiguous. Time budget bumped to 3h05.
- **EC-2 (Q5 grep refinement):** Q5 Fase A rewritten as a two-step process — (1) derive authoritative symbol list from barrel `export` lines; (2) named-import-anchored grep using the alternation of step 1 symbols. Eliminates `EvalConfig` false positives and 6+ `Workflow*Error` false negatives.
- **EC-3 (Q2 ast-grep pattern):** Replaced the ambiguous `from "./types/agent$$$"` ast-grep pattern with deterministic `grep -nE` against literal extensions; ast-grep kept only as optional cross-check.
- **EC-4 (Q6 rebuild step):** Added Q6 special checkpoint enforcing the blueprint's "Required build step before consumer sweep" section if `tools/typecheck-examples.sh` does not auto-rebuild the SDK (confirmed in spot-check).
- **EC-5 (Q1 validation chain location):** Q1 Fase A widened from `packages/sdk/package.json` only to `packages/sdk/package.json` + root `package.json` + `.github/workflows/ci.yml` + `.github/workflows/docs-drift.yml`. Q1 special checkpoint accepts "no gate" as a DOCUMENTed honest result.

**Rationale:** All 5 fixes are surgical (method swaps, additional grep paths, an empirical fallback bounded to 5 min). None expand the research scope, change the coverage matrix, or alter the 4 deliverables in §Objective. The plan version bumps from v1.0 to v1.1 — a non-breaking refinement.

**Consequences:** Halt-loop checkpoint count grows from 6 to 9 (Q1, Q2, Q5, Q6 each get a special checkpoint). Time budget grows by 5 minutes for Q2 Fase C. Coverage matrix unchanged (still 4/4 corners).

## Research Questions

| # | Question | Corner | Source(s) | Fase A (broad — ast-grep/grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How are the existing sub-paths (`@usetheo/sdk/cron`, `/tools`, `/path-safety`, `/task-store`, `/errors`) validated in CI today? Is there an attw + publint gate, a smoke-import test, or only the build step? | tests | `packages/sdk/`, `.github/workflows/ci.yml`, `.github/workflows/docs-drift.yml`, root `package.json` | **(v1.1, absorbs EC-5)** Three-step grep — (a) `grep -rn "@usetheo/sdk/\(cron\|tools\|path-safety\|task-store\|errors\)" packages/ examples/ tests/`; (b) `grep -nE "attw\|publint" packages/sdk/package.json package.json .github/workflows/*.yml`; (c) `grep -nE "\"(validate\|prepublishOnly\|verify)\":" packages/sdk/package.json package.json` — confirmed in spot-check: `packages/sdk/package.json#scripts` only declares `build: "tsup"`, so the validation chain must live in root or CI | Read `packages/sdk/package.json` scripts section + root `package.json` scripts + `.github/workflows/ci.yml` end-to-end + any matching test files | Table: validation step → command → what it asserts → location (sdk pkg / root pkg / ci.yml), with `:line` per row. If attw+publint absent from ALL three, mark as DOCUMENTed gap per EC-5 fallback |
| Q2 | Does `src/workflow.ts → SDKAgent → src/internal/runtime/fork-agent.ts` actually re-trigger the cycle-DTS bug that forced the tsc-based DTS workaround for `tools`/`path-safety`? Or does workflow.ts's `import type { SDKAgent }` (type-only) sidestep it? | deps | `packages/sdk/src/workflow.ts`, `packages/sdk/src/types/agent.ts`, `packages/sdk/src/internal/runtime/fork-agent.ts`, `packages/sdk/tsup.config.ts`, `packages/sdk/tsconfig.tools-dts.json` | **(v1.1, absorbs EC-3)** Deterministic grep, no ast-grep ambiguity: `grep -nE 'from "(\.\/types\/agent\.js\|\.\/internal\/runtime\/fork-agent[^"]*)"' packages/sdk/src/workflow.ts packages/sdk/src/eval.ts` AND `grep -n "ForkOptions\|SDKAgent" packages/sdk/src/types/agent.ts packages/sdk/src/internal/runtime/fork-agent.ts`. Optionally also `ast-grep run --pattern 'import type { $A } from "./types/agent.js"' --lang typescript packages/sdk/src/workflow.ts packages/sdk/src/eval.ts` (literal extension, single-meta `$A`) as a cross-check, but the grep is the source of truth | Read the comment at `tsup.config.ts:11-15`, read `types/agent.ts` end-to-end, read `fork-agent.ts` end-to-end, trace whether workflow.ts's import chain reaches `fork-agent.ts` transitively when DTS resolves through type-barrel | Verdict: `cycle-triggered: yes/no/conditional`, with the exact import chain that reproduces it OR the type-only protection that prevents it. **(v1.1, absorbs EC-1)** **Fase C empirical fallback — mandatory if Fase B verdict is ambiguous** (5 min budget): copy `tsup.config.ts` to `tsup.scratch.config.ts`, add `workflow: "src/workflow.ts"` to the `entry` map AND to `dts.entry`, run `pnpm --filter @usetheo/sdk exec tsup --config tsup.scratch.config.ts`, observe whether `dist/workflow.d.ts` emits or the build fails with the documented "ForkOptions not exported" error. Cleanup: `rm tsup.scratch.config.ts && pnpm --filter @usetheo/sdk build` to restore canonical state. Empirical result is the final verdict (overrides ambiguous read) |
| Q3 | What is the exact diff to `tsup.config.ts`, `tsconfig.tools-dts.json`, `scripts/mirror-dts-to-cts.mjs`, and `package.json#exports` needed to ship `./workflow` + `./eval` sub-paths? | tools | `packages/sdk/tsup.config.ts`, `packages/sdk/tsconfig.tools-dts.json`, `packages/sdk/scripts/mirror-dts-to-cts.mjs`, `packages/sdk/package.json` | SKIP Fase A — text-shape question. Glob the 4 files directly | Read all 4 files end-to-end; produce the exact insertion-site diff for each | Code-block diff per file with line numbers + post-condition (`dist/workflow.d.ts`, `dist/eval.d.ts`, `dist/workflow.d.cts`, `dist/eval.d.cts` all emitted; `attw` + `publint` still pass) |
| Q4 | How does `@anthropic-ai/sdk@0.40.1` shape its `package.json#exports` map for multi-entry dual ESM+CJS publishing? Does it use the `"types"/"default"` condition pattern under `import`/`require` like `@usetheo/sdk` does? | techniques | `node_modules/.pnpm/@anthropic-ai+sdk@0.40.1/node_modules/@anthropic-ai/sdk/package.json` | SKIP Fase A — single file. `node -e "console.log(JSON.stringify(require('node_modules/.../package.json').exports, null, 2))"` | Read the full exports object; identify common condition patterns, glob entries, and any non-obvious choices | Side-by-side table: `@anthropic-ai/sdk` exports shape vs current `@usetheo/sdk` exports shape; recommendation: copy what / diverge where |
| Q5 | Which files in the monorepo import `Workflow`, `Eval`, `Scorers`, `EvalAlreadyRunningError`, `WorkflowBuilder`, `agentStep`, `fn`, or any `Workflow*Error` directly from `@usetheo/sdk`? This is the migration site list. | deps | `packages/cli/src/`, `packages/react/src/`, `packages/acp/src/`, `packages/gateway*/`, `packages/orm/src/`, `packages/di/src/`, `packages/di-agent/src/`, `examples/` | **(v1.1, absorbs EC-2)** Two-step refined scan to eliminate false positives (`EvalConfig` in CLI) and false negatives (6+ `Workflow*Error` symbols missed by previous broad regex): **Step 1 — derive the authoritative symbol list** from the barrels: `grep -nE "^export " packages/sdk/src/index.ts packages/sdk/src/types/workflow.ts packages/sdk/src/types/eval.ts` and extract every named export sourced from `./workflow`, `./eval`, `./scorers`, `./types/workflow`, `./types/eval` (~25 names including `Workflow`, `WorkflowBuilder`, `WorkflowAlreadyRunningError`, `WorkflowCompensateNotImplementedError`, `WorkflowDuplicateStepIdError`, `WorkflowMaxIterationsExceededError`, `WorkflowNotSerializableError`, `WorkflowParallelError`, `WorkflowResumeStepNotFoundError`, `WorkflowSnapshotNotFoundError`, `Eval`, `EvalAlreadyRunningError`, `Scorers`, `agentStep`, `fn`, plus any type-only exports from the two type-barrels). **Step 2 — named-import scan**: `grep -rln "from \"@usetheo/sdk\"" packages/*/src/ examples/ \| xargs grep -nE "import[[:space:]]+(type[[:space:]]+)?\{[^}]*\b($EXHAUSTIVE_REGEX)\b[^}]*\}[[:space:]]+from[[:space:]]+\"@usetheo/sdk\""` where `$EXHAUSTIVE_REGEX` is the alternation of Step 1 names. This is named-import-anchored so `EvalConfig` (CLI-local) cannot match. | For each match, Read the import statement + identify the exact named imports that need rewriting to `from "@usetheo/sdk/workflow"` or `from "@usetheo/sdk/eval"` | Table: file → current import → new import — exhaustive migration site list, with the authoritative symbol list from Step 1 reproduced in an appendix so the exhaustiveness claim is auditable |
| Q6 | Does `tools/typecheck-examples.sh` re-run after a tsup multi-entry change? Will it catch breakage in `examples/eval/run.ts` + `examples/handoffs/run.ts` (and any other example) automatically? Or does the example workspace need an explicit re-pin? | tests | `tools/typecheck-examples.sh`, `examples/eval/`, `examples/handoffs/`, `examples/*/package.json` | `cat tools/typecheck-examples.sh` AND `grep -rln "Workflow\|Eval\|Scorers" examples/ \| grep -v node_modules` | Read `typecheck-examples.sh` end-to-end; identify whether it uses linked workspace `file:` deps or resolved tarballs; trace whether multi-entry exports update propagates without an explicit `pnpm install` re-run | Verdict: `auto-propagates: yes/no` + the exact CI hook that needs to run + any extra example-side change required |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q1, Q6 | Covered |
| Dependencies | Q2, Q5 | Covered |
| Tools | Q3 | Covered |
| Techniques | Q4 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | Every path cited in that question's Fase A exists | Mark Qx BLOCKED with reason "path not found", continue to next |
| Per-question Fase A budget | Fase A returned at least one hotspot OR 3 query-variant retries attempted | After 3 retries with empty results, mark Qx BLOCKED with reason "Fase A exhausted"; continue |
| After answering Qx | Blueprint section under Qx has ≥1 line-exact citation | Re-iterate Qx (1 retry max) |
| Mid-loop sanity | Total citations to `packages/sdk/` + `packages/cli/` + `examples/` + `node_modules/.pnpm/@anthropic-ai+sdk@0.40.1/` ≥ 1 per 200 words of blueprint prose | Add citations to under-cited paragraphs (1 retry max) |
| Per-source time budget | D1 budget not exhausted for that source | When exhausted, mark all remaining Qx for that source BLOCKED with reason "budget exhausted"; advance |
| Before promising complete | All 4 coverage corners have populated sections | Refuse promise, continue iterating |
| Q1 special checkpoint (v1.1, EC-5) | Q1 answer cites the exact location of attw + publint gate (one of: `packages/sdk/package.json`, root `package.json`, `.github/workflows/ci.yml`, `.github/workflows/docs-drift.yml`) OR explicitly records "no attw/publint gate present in any of the three locations" as a DOCUMENTed gap | Re-iterate Q1 with widened Fase A; if all three locations searched and gate not found, accept the DOCUMENTed gap and proceed (does not block blueprint) |
| Q2 special checkpoint (v1.1, EC-1+EC-3) | Cycle-DTS verdict is one of `yes / no / conditional` (NOT `unknown`). If Fase B (static read) produces `unknown`, Fase C (empirical scratch tsup build) MUST run and its result is the verdict | Re-iterate Q2 — this is the single highest-risk unknown; an `unknown` verdict invalidates the blueprint. Fase C cleanup MUST also run: `rm tsup.scratch.config.ts && pnpm --filter @usetheo/sdk build` to restore canonical dist |
| Q5 special checkpoint (v1.1, EC-2) | Migration site list is EXHAUSTIVE: Q5 answer reproduces the Step-1 authoritative symbol list in an appendix; every site found by Step-2 grep maps to ≥1 symbol from the list | Re-iterate Q5 — if Step-1 list is missing symbols present in `packages/sdk/src/index.ts` re-exports, the exhaustiveness claim is invalid and the migration plan will have gaps |
| Q6 special checkpoint (v1.1, EC-4) | If Q6 verdict is `auto-propagates: no` (confirmed in spot-check: `tools/typecheck-examples.sh:35-50` runs `pnpm install --no-frozen-lockfile` but NOT `pnpm --filter @usetheo/sdk build`), the blueprint MUST include a "Required build step before consumer sweep" section with the exact command (`pnpm --filter @usetheo/sdk build && tools/typecheck-examples.sh`) | Re-iterate Q6 — if the build step is missing from the blueprint, `/implement` will run typecheck against a stale `dist/` and produce a false-positive verdict |

## Acceptance Criteria

- [ ] All 6 research questions answered OR explicitly marked BLOCKED with reason
- [ ] All four coverage corners have populated sections in the blueprint
- [ ] Every citation in the blueprint points to a real path (one of: `packages/sdk/`, `packages/cli/`, `examples/`, `node_modules/.pnpm/@anthropic-ai+sdk@0.40.1/`, `.claude/rules/`)
- [ ] At least one ADR section in the blueprint synthesizes the packaging decision (one ADR each for: exports-map shape, tsup entry diff, tsconfig include diff, mirror script glob update, consumer migration sweep)
- [ ] Time budget respected per source (D1)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/sdk-subpath-extraction-workflow-eval-blueprint.md`

## Global Definition of Done

- [ ] All phases completed (plan → edge-cases → execute → confidence → improve if needed → confidence re-score)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations
- [ ] Coverage Matrix 100% covered
- [ ] ADRs reference at least one principle from project rules: `architecture.md` (DIP layers), `no-stubs-no-mocks-no-wired.md` (extracted symbol must remain wired to a real caller), `real-llm-validation.md` (examples consuming `Workflow`/`Eval` must remain runnable against real LLMs after extraction)
- [ ] Confirms the user's explicit no-backwards-compat directive: extracted symbols are REMOVED from `packages/sdk/src/index.ts` — no re-export shim, no deprecation comment, no migration codemod
