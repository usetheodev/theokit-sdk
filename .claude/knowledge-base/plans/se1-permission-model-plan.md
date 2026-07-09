---
slug: se1-permission-model
milestone_id: SE1
created_at: 2026-07-09
goal: Evolve the existing PermissionEngine into a first-class permission model — a PermissionMode layer + an enriched canUseTool gate — grounded in the OpenCode/Codex proven patterns, provider-agnostic.
---

# Plan — SE1: Permission model

## Baseline (what EXISTS — evolve, not greenfield)
- `packages/sdk/src/permission-engine.ts` — `PermissionEngine.evaluate(name, args) => "allow"|"deny"|"ask"`, `PermissionRule {tool, args?(ArgMatcher), action}`, fail-closed default `ask` (#55). This is EXACTLY OpenCode's engine (`permission.ts:102-112`).
- `packages/sdk/src/permission-plugin.ts` — `createPermissionPlugin(engine, {onAsk})` wires the engine into the `pre_tool_call` veto seam; `onAsk(toolName)` resolves the `ask` verdict, fail-closed default.

## Gap (from the Anthropic comparison + OpenCode/Codex research)
1. No `PermissionMode` — a per-run setting adjusting behavior globally.
2. `onAsk(toolName)` is too thin vs the proven gate shape — it should receive `(toolName, input, ctx)` and return a richer decision (`allow` + `updatedInput` | `deny` + `message`).

## Design (grounded — see blueprint se1-permission-model-blueprint.md)
- **`PermissionMode = "default" | "plan" | "acceptEdits" | "bypass"`** — a PURE post-processor of the engine verdict (no tool-safety metadata needed, so it fits BYO-tools):
  | mode | allow | deny | ask | unmatched(default) |
  |---|---|---|---|---|
  | default | allow | deny | ask | ask |
  | plan | allow | deny | deny | deny |
  | acceptEdits | allow | deny | ask | allow |
  | bypass | allow | deny | allow | allow |
  - **Load-bearing invariant (both OpenCode+Codex):** `deny` is immune to EVERY auto-approve path. `bypass` never un-denies; `plan` never un-denies. Asserted by tests.
- **`canUseTool(toolName, input, ctx) => PermissionGateDecision`** — the enriched gate, invoked ONLY on an `ask` verdict:
  - `PermissionGateDecision = { behavior: "allow"; updatedInput?: unknown } | { behavior: "deny"; message?: string }`
  - `ctx = { toolName, mode }` (minimal; extend later). Default/absent/throwing gate ⇒ **deny** (fail-closed — Codex `ReviewDecision::default()==Denied`, OpenCode ACP reject-on-error).
  - `onAsk` kept as a `@deprecated` alias (backward-compat — `createPermissionPlugin` is `@public`).

## Coverage Matrix (DoD → task)
| DoD (SE1) | Task |
|---|---|
| `PermissionMode` resolved per run; documented precedence | T1 — `PermissionMode` + `applyMode()` pure fn in permission-engine.ts |
| `canUseTool` gate before dispatch, bridged to fail-closed HITL | T2 — enrich permission-plugin.ts: `mode` + `canUseTool`; keep `onAsk` deprecated |
| Rules with arg pattern (already have) | ✅ existing (#55) — regression-guarded |
| TDD: fail-closed; mode precedence; ask→gate; denied typed result | T1+T2 tests |
| Public-API change → docs + Changeset | T3 — export from index + Changeset |

## Tasks
### T1 — PermissionMode + applyMode (permission-engine.ts)
Add `export type PermissionMode`; add a pure `export function applyMode(verdict: PermissionAction, mode: PermissionMode): PermissionAction` implementing the table above. Add `evaluate(name, args, mode?)` overload (mode defaults to `default` = current behavior — backward-compat). **RED:** table-driven test asserting all 16 (verdict×mode) cells + the deny-immunity invariant.

### T2 — Enriched gate (permission-plugin.ts)
Add `PermissionGateDecision` type + `canUseTool?` + `mode?` options. On evaluate: apply `mode`; `deny`→block; `ask`→`canUseTool(name,args,{toolName,mode})` (allow[+updatedInput]/deny[+message]); absent/throws→block (fail-closed). `onAsk` deprecated but honored when `canUseTool` absent. **RED:** gate allow/deny/updatedInput; fail-closed on throw; mode short-circuits; onAsk back-compat.

### T3 — Export + docs + Changeset
Export `PermissionMode`, `PermissionGateDecision`, `applyMode` from `src/index.ts`. `docs.md` note. Changeset (minor).

## Test Plan
- Unit (T1): 16-cell mode table + deny-immunity.
- Unit (T2): gate behaviors + fail-closed + mode + onAsk back-compat.
- Full suite: no regression (baseline 181 pre-existing fails).

## Drawbacks & Risks
1. API creep vs Anthropic's 5-mode+destinations. Mitigation: 4 modes, pure post-processor, no destination tiers.
2. Duplicating TheoKit's HITL/default-DENY. Mitigation: SDK ships the primitive; framework composes. No framework surface here.

## Unresolved Questions
(none — mode semantics, gate shape, precedence all resolved by the OpenCode/Codex research.)

## Prior Art
OpenCode `permission.ts` (rule engine + deny-first + ask-deferred), agents-as-modes (`agent.ts` plan agent), `dangerously-skip-permissions` (`run.ts:735`); Codex `AskForApproval` (`protocol.rs:837-868`), `ReviewDecision::default()==Denied`. Anthropic `PermissionMode`+`canUseTool`+`PermissionResult`.
