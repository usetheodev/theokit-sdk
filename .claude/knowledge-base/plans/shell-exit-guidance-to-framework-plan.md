---
slug: shell-exit-guidance-to-framework
created_at: 2026-06-26
goal: Move withShellExitGuidance into @theokit/sdk-tools (alongside withDefaultGuidance) so theocode deletes its app-side rich-errors.ts.
---

# Plan: promote `withShellExitGuidance` to `@theokit/sdk-tools` (delete theocode's last guidance residue)

> **Version 1.0** — The just-merged `rich-errors-adopt-default-guidance` left theocode with one app-side guidance file: `server/tools/rich-errors.ts` (`withShellExitGuidance`) — a wrapper adding `guidance` to a `shell_exec` `{ ok:true, exit_code≠0 }` soft failure (the case the framework's `ok:false`-only `injectGuidance` does not cover). But `shell_exec` is a FRAMEWORK tool (`createShellTool`) and the non-zero-exit soft failure is universal to ANY consumer — so the radar thesis says this belongs in `@theokit/sdk-tools`, next to `withDefaultGuidance`, NOT app-side. This plan adds `withShellExitGuidance` to `@theokit/sdk-tools` (`src/internal/tool-guidance.ts` + barrel export) so theocode imports it from the framework and DELETES `rich-errors.ts` entirely (zero app-side guidance residue).

## Goal

> "Add `withShellExitGuidance` to `@theokit/sdk-tools` (exported from the barrel) so a `shell_exec` `{ ok:true, exit_code≠0 }` result gains a `guidance` hint, measured by `pnpm --filter @theokit/sdk-tools test` passing with a new test asserting the wrapper, enabling theocode to delete `rich-errors.ts` and import it from the framework."

## Context

theocode is the radar: each app-side reimplementation/residue reveals a framework gap. `rich-errors.ts` is the last guidance residue — a wrapper over the framework's own `shell_exec` tool. The framework already owns the guidance-wrapper pattern (`withDefaultGuidance`/`withToolResultGuidance`/`injectGuidance` in `src/internal/tool-guidance.ts`); `withShellExitGuidance` is the natural sibling for the `ok:true` soft-failure of `shell_exec`.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Why it exists | Invariant to preserve |
|---|---|---|---|
| `packages/sdk-tools/src/internal/tool-guidance.ts` | ~60 | `injectGuidance`/`withToolResultGuidance`/`withDefaultGuidance` + `DEFAULT_TOOL_GUIDANCE` | existing exports UNCHANGED; add `withShellExitGuidance` |
| `packages/sdk-tools/src/index.ts` | — | barrel; exports the guidance wrappers (lines 59-61) | add `withShellExitGuidance` to the export |
| `packages/sdk-tools/tests/tool-guidance.test.ts` | — | tests the guidance wrappers | add `withShellExitGuidance` cases |

### Current callers / dependents (empirically verified)

- `src/internal/tool-guidance.ts`: `injectGuidance` (ok:false-only, idempotent, never-throw), `withToolResultGuidance`, `withDefaultGuidance`, `DEFAULT_TOOL_GUIDANCE`. Exported via `src/index.ts:59-61`.
- `createShellTool` (`src/shell-exec.ts:156-159`) returns `{ ok:true, stdout, stderr, exit_code }` — a non-zero `exit_code` is a soft failure with NO guidance today (the gap).
- theocode `server/tools/rich-errors.ts` holds the exact `withShellExitGuidance` logic to be promoted; theocode `server/tools/index.ts` composes it after `withDefaultGuidance`.

### Domain glossary

- **shell soft-failure** — `shell_exec` returns `{ ok:true, exit_code≠0 }`: the TOOL ran, the COMMAND failed. Not an `ok:false`, so the framework's `ok:false`-only `injectGuidance` does not cover it.
- **guidance wrapper** — a `withX(tool): CustomTool` that augments a tool's handler output with an actionable `guidance` hint (framework's composition pattern).

### Architecture boundaries affected

- None new. Internal addition to `tool-guidance.ts` + a barrel export. No new dependency. `docs.md` (the `@theokit/sdk` API contract) is unaffected (sdk-tools is a sibling package; its ACI surface is documented in its own README/d.ts).

## Prior Art & Related Work

- **Framework guidance wrappers** — `withDefaultGuidance`/`withToolResultGuidance`/`injectGuidance` (`tool-guidance.ts`, blueprint "m3-rich-errors").
- **theocode `rich-errors.ts`** — the `withShellExitGuidance` impl being promoted (proven by theocode's tests + the wired integration test).
- **In-repo precedent** — `@theokit/sdk-tools@0.4.0` SOTA descriptions (same radar pattern: promote app behavior to the framework default).

## Objective

- [ ] `withShellExitGuidance(tool)` added to `tool-guidance.ts`: adds `guidance` on `shell_exec` `{ ok:true, exit_code≠0 }`; no-op for non-shell / exit 0 / non-JSON; idempotent; never-throws.
- [ ] Exported from the barrel (`src/index.ts`).
- [ ] Test coverage for the wrapper (exit≠0 → guidance; exit 0 → unchanged; non-shell → unchanged; idempotent; never-throw).
- [ ] Gates: `pnpm --filter @theokit/sdk-tools test` green; typecheck 0; biome clean; changeset added.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (none changed) | | | Internal addition; no dependency change. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | | | | — |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## ADRs

### D1 — Promote `withShellExitGuidance` as a guidance WRAPPER (not bake into `createShellTool`)

- **Decision:** add `withShellExitGuidance(tool)` next to `withDefaultGuidance` in `tool-guidance.ts`; do NOT bake the guidance into `createShellTool`'s handler.
- **Rationale:** the framework deliberately models guidance as a COMPOSITION concern (opt-in `withX` wrappers), keeping the tool's job (run commands) separate from the cross-cutting guidance concern (SRP). A wrapper is consistent with `withDefaultGuidance`; baking it into the tool would couple concerns + change the tool's default success output for every consumer unconditionally.
- **Alternatives considered:** (a) Bake into `createShellTool` — REJECTED: couples concerns; unconditional output change; inconsistent with the framework's wrapper pattern. (b) Extend `injectGuidance` to handle ok:true — REJECTED: `injectGuidance` is `ok:false`-only by documented contract; widening it breaks that contract for all callers.
- **Consequences:** consumers opt in via `withShellExitGuidance(tool)` (composes with `withDefaultGuidance`); theocode deletes `rich-errors.ts` and imports it.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| A shell-specific wrapper in a generic guidance module | Low | named clearly (`withShellExitGuidance`); it is the concrete framework case (shell_exec's exit_code); generalizing now is YAGNI | maintainer |
| Double-injection if composed with a future ok:true injector | Low | idempotent (skips if `guidance` present); ok:true-only vs withDefaultGuidance ok:false-only (disjoint) | maintainer |

## Unresolved Questions

(none — every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 (add withShellExitGuidance + export + test) ──▶ Final Phase: Integration Validation
```

## Phase 1: Add + export + test `withShellExitGuidance`

### T1.1 — Implement withShellExitGuidance in tool-guidance.ts + barrel export + test

#### Objective
Add `withShellExitGuidance(tool)` to `tool-guidance.ts` (ok:true exit≠0 → guidance; idempotent; never-throw; no-op otherwise), export it from `src/index.ts`, and test it.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — promotes the proven theocode wrapper into the framework's guidance module + barrel, so any consumer (and theocode) gets it from the framework.
2. **Why it is necessary now** — it removes theocode's last app-side guidance residue (the radar thesis) by closing the framework gap.

#### Evidence
`tool-guidance.ts` (the guidance wrappers home); `createShellTool` returns `{ok:true, exit_code}` (shell-exec.ts:156-159); theocode `rich-errors.ts` (the proven impl).

#### Files to edit
```
packages/sdk-tools/src/internal/tool-guidance.ts — add withShellExitGuidance
packages/sdk-tools/src/index.ts — export withShellExitGuidance
packages/sdk-tools/tests/tool-guidance.test.ts — add wrapper tests
```

#### Deep file dependency analysis
- `withShellExitGuidance(tool: CustomTool): CustomTool`: `if (tool.name !== 'shell_exec') return tool`; else wrap handler: parse JSON; if `isRecord && ok===true && typeof exit_code==='number' && exit_code!==0 && !('guidance' in r)` → add `guidance`; else pass through; never throw. Reuse the existing `isRecord` helper in tool-guidance.ts.

#### Deep Dives
- **Idempotent + never-throw** (mirror injectGuidance's discipline).
- **TDD:** RED test first (the export doesn't exist) → implement.

#### Pseudo-code / Signatures
```ts
export function withShellExitGuidance(tool: CustomTool): CustomTool {
  if (tool.name !== "shell_exec") return tool;
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
    handler: async (input) => {
      const out = await tool.handler(input);
      let p: unknown; try { p = JSON.parse(out); } catch { return out; }
      if (isRecord(p) && p.ok === true && typeof p.exit_code === "number" && p.exit_code !== 0 && !("guidance" in p)) {
        return JSON.stringify({ ...p, guidance: `the command exited ${p.exit_code}; read the stderr above, fix the cause, then retry.` });
      }
      return out;
    } };
}
```

#### Tasks
1. RED test in `tool-guidance.test.ts` (import `withShellExitGuidance` — fails until exported).
2. Implement + export.
3. Run the test file + typecheck + biome.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Exported: `grep -q "withShellExitGuidance" packages/sdk-tools/src/index.ts` exits 0
- [ ] Tests green: `pnpm --filter @theokit/sdk-tools test tool-guidance` exits 0
- [ ] Behavior cases asserted: `grep -c "withShellExitGuidance" packages/sdk-tools/tests/tool-guidance.test.ts` returns `>= 4` (exit≠0 / exit0 / non-shell / idempotent)
- [ ] Types compile: `pnpm --filter @theokit/sdk-tools typecheck` exits 0
- [ ] Biome clean: `pnpm --filter @theokit/sdk-tools lint` exits 0

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `pnpm --filter @theokit/sdk-tools test`
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-tools typecheck`
- [ ] Biome clean
- [ ] changeset added (minor bump)

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| G1 | shell soft-failure guidance is app-side residue | T1.1 | promoted to @theokit/sdk-tools as a wrapper (ADR D1) |
| G2 | must be exported for consumers | T1.1 | barrel export |
| G3 | behavior must match the proven theocode impl | T1.1 | same logic + tests (exit≠0/exit0/non-shell/idempotent/never-throw) |
| G4 | no regression to existing guidance wrappers | T1.1, Final | existing exports unchanged; full suite |

**Coverage: 4/4 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk-tools test`
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-tools typecheck`
- [ ] Biome clean — `pnpm --filter @theokit/sdk-tools lint`
- [ ] changeset added (minor)
- [ ] **Plan archived** — after `/review` READY_TO_MERGE AND PR merged

## Failure scenarios (when I/O external)

```
(none — pure JSON transform over a tool handler's string output; no new external I/O)
```

## Final Phase: Integration Validation (MANDATORY)

> Runs AFTER Phase 1. The plan is NOT done until this chain passes.

### Execution
```
pnpm --filter @theokit/sdk-tools test
pnpm --filter @theokit/sdk-tools typecheck
pnpm --filter @theokit/sdk-tools lint
```

### Acceptance Criteria
- [ ] Full sdk-tools suite green: `pnpm --filter @theokit/sdk-tools test` exits 0
- [ ] Zero type errors: `pnpm --filter @theokit/sdk-tools typecheck` exits 0
- [ ] Biome clean: `pnpm --filter @theokit/sdk-tools lint` exits 0
- [ ] `withShellExitGuidance` exported: `grep -q "withShellExitGuidance" packages/sdk-tools/src/index.ts` exits 0
- [ ] changeset present: `ls .changeset/*.md` lists the new entry

### If Validation Fails
1. Identify plan-caused vs pre-existing failures.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Log pre-existing issues in the PR description.
