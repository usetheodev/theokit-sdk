# Edge Case Review — sdk-subpath-extraction-workflow-eval (implementation plan)

Data: 2026-06-02
Plano analisado: `.claude/knowledge-base/plans/sdk-subpath-extraction-workflow-eval-plan.md` (v1.0)
Phases: 6 (Phase 0-5 + Dogfood)
Tasks: 16
Edge cases encontrados: 6 (MUST FIX: 1, SHOULD TEST: 3, DOCUMENT: 2)

Spot-checks rodados antes do report (evidência empírica):

- `packages/sdk/src/eval.ts:1-77` — full read. Confirms `EvalOptions`, `EvalRun`, `EvalRunOptions` are IMPORTED at line 20 from `./types/eval.js` but NOT re-exported. The file only exports the `Eval` class (line ~55), and re-exports `EvalAlreadyRunningError` from `./internal/eval/single-flight.js` (line 77).
- `packages/sdk/src/workflow.ts:341-349` — confirmed: workflow.ts re-exports the 8 `Workflow*Error` types from `./types/workflow.js` but does NOT use `export type * from "./types/workflow.js"`. Other type aliases (`WorkflowDefinition`, `WorkflowStep`, etc.) reach consumers ONLY via `types/index.ts:25` (which the plan deletes).
- Peer-dep scan: 10+ workspace packages declare `"@theokit/sdk": "workspace:^"` (caret) — caret resolves to any 1.x.x compatible, so 1.5.0 satisfies. No tilde/pinned versions found.

---

## MUST FIX

### EC-1: T2.2/T2.3 break type re-exports — `src/eval.ts` and `src/workflow.ts` never re-export their `./types/{eval,workflow}.js` types

- **Tasks affected:** T2.2 (Scorers re-export), T2.3 (delete `types/index.ts:12,25`), T3.1 (uses `type EvalRun`, `type Scorer as SdkScorer`), T3.2 (uses `type EvalRun`)
- **Família:** Dependency / Citation
- **Cenário:** Today, `EvalRun` and `Scorer` reach consumers via `packages/sdk/src/types/index.ts:12: export type * from "./eval.js"` (the type-barrel file under `types/`, NOT the runtime `src/eval.ts`). After T2.3 deletes that line, the only path for `EvalRun`/`Scorer`/`Score`/`EvalAggregate`/etc. to reach `@theokit/sdk/eval` consumers is via `src/eval.ts` — but `src/eval.ts:20` only IMPORTS the types for internal use, never `export type *`. Symmetric problem for `src/workflow.ts:341-349`: re-exports 8 `Workflow*Error` runtime classes but not the type aliases (`WorkflowDefinition`, `WorkflowStep`, `WorkflowRunOptions`, etc.).
- **Impacto:** T3.1 (`packages/cli/src/eval/runner.ts:14`) imports `{ Eval, type EvalRun, type Scorer as SdkScorer } from "@theokit/sdk/eval"`. T3.2 (`examples/eval/run.ts:14`) imports `{ Eval, Scorers, type EvalRun }`. After Phase 3 + T4.0 rebuild, BOTH fail with `Module '"@theokit/sdk/eval"' has no exported member 'EvalRun'` / `'Scorer'`. T4.4 (workspace typecheck) fails. The plan never reaches Phase 5. Same applies pre-emptively to any future Workflow consumer if it uses a type like `WorkflowDefinition`.
- **Fix sugerido:** T2.2 acquires a second edit (or split into T2.2a + T2.2b): in `src/eval.ts` add `export type * from "./types/eval.js"` alongside the new Scorers re-export. Add a parallel task T2.2c: in `src/workflow.ts` add `export type * from "./types/workflow.js"` (next to the existing line 341-349 named re-exports). Both edits are 1 line each.

---

## SHOULD TEST

### EC-2: T1.2 transitive include fan-out may exceed the proposed 5-path delta

- **Task affected:** T1.2 (tsconfig.tools-dts.json#include extension)
- **Halt-loop checkpoint sugerido:** Add to T1.2 acceptance criteria: "After running `pnpm --filter @theokit/sdk build`, count any `error TS6053: File 'src/...' not found` or `Cannot find module` lines. If > 0, append the missing source files to `include` and re-run. Loop terminates after ≤ 4 iterations OR the include array grows by > 10 entries. If the second condition fires, escalate: the tsc lane may not be the right route for workflow.ts, reopen D1 with the empirical data, consider falling back to tsup `dts.entry`."
- **Cenário:** `src/internal/workflow/**/*` likely imports from `src/internal/persistence/persistence-schema.ts`, `src/internal/security/path-guard.ts`, and possibly the agent loop. `src/internal/eval/**/*` likely imports `src/internal/runtime/concurrency.ts` or similar. Each unresolved transitive forces another iteration of the loop the plan already documents in T1.2 step 5.

### EC-3: T2.3 deletes by line number — sequential edits shift downstream line numbers

- **Task affected:** T2.3 (delete 3 blocks in `index.ts` + 2 lines in `types/index.ts`)
- **Halt-loop checkpoint sugerido:** Add to T2.3 step 2: "Delete blocks in REVERSE line-number order (134-149 first, then 108, then 54-56). Each deletion of N lines shifts every subsequent line by -N; doing bottom-up means earlier line numbers stay accurate. Alternative: re-grep after each deletion to recompute targets."
- **Cenário:** Without ordering discipline, the second Edit fails to find the expected `old_string` because the content moved up after the first deletion succeeded. /implement runs each Edit independently and won't recover gracefully — it'll either misclassify as "already gone" (false success) or fail with "old_string not found" (correct error but confusing).

### EC-6: T4.3 `tools/typecheck-examples.sh` runs `pnpm install --ignore-workspace` — may still resolve to stale dist despite T4.0 rebuild

- **Task affected:** T4.3 (typecheck-examples sweep)
- **Halt-loop checkpoint sugerido:** Add to T4.3 verify step: "After running `tools/typecheck-examples.sh`, check the auto-generated `examples/<name>/node_modules/.pnpm/@usetheo+sdk@.../node_modules/@theokit/sdk/dist/workflow.d.ts` exists for `examples/eval/`. If absent, the `--ignore-workspace --no-frozen-lockfile` may have resolved against a stale cache. Workaround: `rm -rf examples/eval/node_modules examples/eval/pnpm-lock.yaml && tools/typecheck-examples.sh` to force fresh resolution."
- **Cenário:** pnpm's `file:` link resolution + `--ignore-workspace` is mutually-correct but the lockfile may pin a hash. The plan's D4 mandate ensures dist is fresh; T4.3 trusts pnpm to re-resolve. If pnpm caches, the example tsc reads a stale dist that lacks the new sub-paths.

---

## DOCUMENT

### EC-4: Workspace peer deps use `workspace:^` — 1.5.0 satisfies, no action needed

- **Risco aceito:** Per spot-check, 10+ workspace packages (acp, cli, gateway-{line,slack,sms}, memory-supermemory, etc.) declare `"@theokit/sdk": "workspace:^"`. The caret resolves to any 1.x.x compatible release; `1.5.0` satisfies. No package uses tilde (`~1.4.x`) or exact pin (`1.4.1`). The version bump in T5.2 is operationally safe for the monorepo. Documented for the implementer who wonders why no further coordination is required.

### EC-5: T0.1 probe command portability — `pnpm --filter @theokit/sdk exec tsup --config tsup.scratch.config.ts`

- **Risco aceito:** `pnpm --filter` sets cwd to `packages/sdk/` before `exec`, so `--config tsup.scratch.config.ts` resolves relative to that dir (where the scratch file lives). If for any reason the cwd doesn't switch (unusual but possible with custom pnpm config), tsup errors with "config not found". The fix is trivial (`--config packages/sdk/tsup.scratch.config.ts` from repo root, or `cd packages/sdk && tsup --config tsup.scratch.config.ts`). Documented so the implementer doesn't escalate on first error.

---

## Resumo

| Phase | Tasks | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|-------|-------|-------------|----------|-------------|----------|
| Phase 0 | T0.1 | 1 | 0 | 0 | 1 (EC-5) |
| Phase 1 | T1.1, T1.2, T1.3 | 1 | 0 | 1 (EC-2) | 0 |
| Phase 2 | T2.1, T2.2, T2.3 | 2 | 1 (EC-1) | 1 (EC-3) | 0 |
| Phase 3 | T3.1, T3.2 | 0 | 0 | 0 | 0 |
| Phase 4 | T4.0, T4.1, T4.2, T4.3, T4.4 | 1 | 0 | 1 (EC-6) | 0 |
| Phase 5 | T5.1, T5.2 | 1 | 0 | 0 | 1 (EC-4) |
| **Total** | **16** | **6** | **1** | **3** | **2** |

**Veredicto:** PLAN PRECISA DE AJUSTE (1 MUST FIX)

Single MUST FIX is surgical: T2.2 + new T2.2c each add a single `export type * from "./types/{eval,workflow}.js"` line. Without these, the plan literally cannot ship — T3.1 + T3.2 + T4.4 will fail typecheck because `EvalRun`, `Scorer`, `WorkflowDefinition`, etc. won't be reachable through the new sub-paths.

Three SHOULD TEST adds halt-loop checkpoints to T1.2 (transitive include fan-out cap), T2.3 (delete in reverse line-number order), T4.3 (verify fresh dist resolution in examples).

Two DOCUMENT items confirm safety (peer-deps already satisfy 1.5.0; probe command path mechanics).

**Bump sugerido:** plan v1.0 → v1.1 incorporating only EC-1 as a task amendment + EC-2/EC-3/EC-6 as acceptance-criteria additions. EC-4 and EC-5 stay as DOCUMENT-only (no plan edit required, just awareness).
