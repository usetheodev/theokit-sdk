---
slug: m3-rich-errors
created_at: 2026-06-21
goal: Add a composable `withToolResultGuidance(tool, guidance)` wrapper + `DEFAULT_TOOL_GUIDANCE` map to sdk-tools that injects an LLM-actionable `guidance` string into a tool's `{ok:false,error}` payload (additive, idempotent, never-throw), measured by tests/tool-guidance.test.ts passing green.
---

# Plan: M3-4 — Rich errors (self-correction on tool fail)

> **Version 1.1** (edge-case-plan absorbed: EC-1 non-object-JSON passthrough folded into T1.1 TDD) — Close roadmap gap M3-4: ship a composable `withToolResultGuidance(tool, guidance): CustomTool` wrapper (+ a pure `injectGuidance`, a curated `DEFAULT_TOOL_GUIDANCE` error-code→hint map, and `withDefaultGuidance(tool)`) in `@theokit/sdk-tools` that augments a failing tool's `{ok:false,error}` JSON payload with an LLM-actionable `guidance` string — additive only, idempotent, and never-throw (a non-JSON or `ok:true` result passes through unchanged). Composes over the existing 13 built-in tools (and custom tools) instead of editing each factory. Design locked by blueprint `m3-rich-errors` (discover-confidence SHIPPABLE 100, five ADRs covering wrapper/contract/passthrough/default-map/placement).

## Goal

> "Ship `withToolResultGuidance(tool, guidance)` + `DEFAULT_TOOL_GUIDANCE` in `@theokit/sdk-tools` that injects an actionable `guidance` string into `{ok:false,error}` payloads — additive, idempotent, never-throw — measured by `tests/tool-guidance.test.ts` passing green."

## Context

Roadmap gap M3-4 (`docs/gap-audit/ROADMAP.md:126`, med sev, size M, Tema C). Greenfield (confirmed): no tool attaches `guidance`; no wrapper exists. `defineTool`'s handler returns a JSON STRING (`packages/sdk/src/define-tool.ts:25`), so guidance is injected INSIDE the stringified `{ok:false,error,...}` object. The 13 built-in tools return flat `{ok:false,error:<code>,...}` shapes (read-file `not_found`/`forbidden_path`/...; edit-file `no_match`; shell-exec `timeout`/`catastrophic_command`; web-fetch `ssrf_blocked`; etc) with no recovery hint. M3-4 composes a wrapper over them (KISS — no 13-factory edits). Respects `rules/architecture.md` §2 + `rules/no-stubs-no-mocks-no-wired.md`. Zero new deps (JSON string transform).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk-tools/src/internal/tool-guidance.ts` (NEW) | 0 | — | (the wrapper + map) | — |
| `packages/sdk-tools/src/index.ts` | 63 | 6ef9eae | sdk-tools barrel | additive exports only |
| `packages/sdk-tools/tests/tool-guidance.test.ts` (NEW) | 0 | — | unit tests — RED first | — |
| `docs.md` | (contract) | — | public API contract | additive tool-guidance note |
| `CHANGELOG.md` (root) + `.changeset/` (NEW) | — | — | changelog + changeset | additive Added entry |

### Current callers / dependents

- **NEW** `withToolResultGuidance`/`withDefaultGuidance`/`DEFAULT_TOOL_GUIDANCE`/`injectGuidance` — barrel-exported reusable wrappers. A consumer wraps their tool list with them. Exercised through the barrel + against a real built-in tool (`createReadFileTool`) in tests → no orphan (the wrapper actually wraps a real tool in an integration test). Consistent with the `formatCode`/`buildRepoMap` LEGO-piece precedent (barrel-exported tooling helpers).
- **`defineTool` / `CustomTool`** (`@theokit/sdk`) — the wrapped contract (handler returns string). Existing peer dep.

### Domain glossary

- **guidance** — a short, LLM-actionable hint added to a failed tool result telling the model how to self-correct (e.g. `not_found` → "use list_dir to find the path").
- **additive injection** — the wrapper only ADDS a `guidance` field on `ok:false`; it never alters or removes existing fields and never touches `ok:true`.
- **passthrough** — a non-JSON handler output, an `ok:true` result, an unknown error code, or a result that already has `guidance` is returned UNCHANGED.

### Architecture boundaries affected

Per `rules/architecture.md` §2: `tool-guidance.ts` is pure domain logic (string transform, no I/O) in sdk-tools `internal/`, barrel-exported. It imports `CustomTool`/`defineTool` from `@theokit/sdk` (public). No DIP boundary crossed.

## Prior Art & Related Work

- **Internal blueprint** `knowledge-base/discoveries/blueprints/m3-rich-errors-blueprint.md` (five ADRs).
- **In-repo precedent** the `formatCode`/`buildRepoMap` LEGO-piece exports (`packages/sdk-tools/src/index.ts`); the `defineTool` string-return contract (`packages/sdk/src/define-tool.ts:25`).
- **Reference precedent** opencode `tool/invalid.ts` actionable failure output + `tool/edit.ts` fuzzy edit feedback (`.claude/knowledge-base/reference/opencode/packages/opencode/src/tool/invalid.ts`); codex `apply_patch.rs` `FunctionCallError::RespondToModel("patch rejected: {reason}")` (`.claude/knowledge-base/reference/codex/codex-rs/core/src/apply_patch.rs`); in-repo Hermes recovery-hint pattern (`.claude/knowledge-base/sdk-references/tool-call-failure-recovery.md`).

## Objective

- [ ] `tool-guidance.ts` exports `withToolResultGuidance(tool, guidance)`, `withDefaultGuidance(tool)`, `DEFAULT_TOOL_GUIDANCE`, `injectGuidance(output, guidance)`, `ToolGuidanceMap`.
- [ ] `injectGuidance` adds `guidance` ONLY when the parsed result is an object with `ok===false`, a hint exists for `error`, and no `guidance` is already present.
- [ ] Passthrough (unchanged) for: non-JSON output, `ok:true`, not-our-shape, unknown code, existing guidance. Never throws.
- [ ] `withToolResultGuidance` returns a `CustomTool` preserving name/description/inputSchema, wrapping the handler.
- [ ] `DEFAULT_TOOL_GUIDANCE` covers the common codes (not_found, path_traversal, forbidden_path, no_match, no_matches, timeout, ssrf_blocked, catastrophic_command, binary_file, too_large).
- [ ] Zero new deps; barrel exports; docs.md + CHANGELOG + changeset.
- [ ] `tests/tool-guidance.test.ts` green; typecheck + Biome clean; build emits dist.

## ADRs

### D1 — Composable wrapper, not 13 factory edits
**Decision:** ship `withToolResultGuidance(tool, guidance)` + `withDefaultGuidance` + `DEFAULT_TOOL_GUIDANCE` + pure `injectGuidance` — compose over existing tools.
**Rationale:** KISS/YAGNI + low risk; works for built-in AND custom tools; satisfies the roadmap's "attach guidance" via composition.
**Alternatives considered:** edit all 13 factories (rejected — risky diffs, no extra value); a base-class (rejected — tools are factories).

### D2 — Guidance injected INSIDE the JSON string (handler contract)
**Decision:** parse the handler's returned string → augment → re-stringify; `guidance` is a field in the `{ok:false}` object.
**Rationale:** matches `defineTool`'s string-in/string-out contract; the model already parses the JSON.
**Alternatives considered:** outer wrapper object (rejected — breaks the `{ok,...}` shape consumers parse).

### D3 — Additive + idempotent + never-throw passthrough
**Decision:** inject ONLY when `ok===false` AND a hint exists AND no `guidance` present; non-JSON / `ok:true` / unknown code / parse error → return original unchanged; never throw.
**Rationale:** the wrapper must never corrupt a result or break a custom tool returning non-JSON (EC-1/EC-2/EC-3).
**Alternatives considered:** overwrite existing guidance (rejected); throw on non-JSON (rejected — breaks non-JSON tools).

### D4 — Curated DEFAULT_TOOL_GUIDANCE for common codes
**Decision:** ship hints for the cross-tool common codes; unknown/rare codes get none; consumers can supply their own map.
**Rationale:** common codes carry the most self-correction value; YAGNI on the long tail.
**Alternatives considered:** exhaustively map all 31 codes (rejected — churn, diminishing returns).

### D5 — Placement internal/ + barrel export
**Decision:** `packages/sdk-tools/src/internal/tool-guidance.ts`; barrel-export the five symbols.
**Rationale:** sibling of the tools it wraps; internal/ for logic, barrel for reuse.
**Alternatives considered:** in `@theokit/sdk` core (rejected — it wraps sdk-tools' tools).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Guidance is advisory text, not a machine contract the LLM must obey | Low | documented as best-effort self-correction (D3); the `error` code remains authoritative | SDK |
| A custom tool returning non-JSON could be corrupted | Medium | never-throw passthrough returns non-JSON output verbatim (D3); tested | SDK |
| Exported wrappers with no in-SDK runtime caller (consumer-facing) | Low | barrel-exported LEGO pieces (like `formatCode`/`buildRepoMap`); exercised against a real built-in tool in tests; `no-stubs-no-mocks-no-wired` §3 is scoped to `packages/sdk/src` | SDK |

## Unresolved Questions

- (none — every decision resolved at plan time via the blueprint's five ADRs. Editing the 13 factories inline + mapping all 31 codes are explicitly deferred — YAGNI here.)

## Dependency Graph

```
Phase 1 (injectGuidance + withToolResultGuidance + DEFAULT_TOOL_GUIDANCE + withDefaultGuidance + tests) ──▶ Phase 2 (barrel export + docs + changeset + CHANGELOG) ──▶ Final Phase (integration validation)
```

---

## Phase 1: The wrapper

### T1.1 — `tool-guidance.ts` (injectGuidance + wrapper + default map)

#### Objective
Create `internal/tool-guidance.ts` with the pure `injectGuidance`, the `withToolResultGuidance` wrapper, `DEFAULT_TOOL_GUIDANCE`, and `withDefaultGuidance`.

#### Why this step (action + reasoning)
1. **What** — the pure injection (parse→additive-augment→re-stringify) + the CustomTool-preserving wrapper + the curated default hint map.
2. **Why now** — `injectGuidance` is the load-bearing correctness surface (additive/idempotent/never-throw) and is fully unit-testable with plain strings; the wrapper is a thin handler-compose around it.

#### Evidence
Blueprint D1-D4 + Technique 1/2. `define-tool.ts:25` (handler→string). opencode `invalid.ts` / codex `apply_patch.rs:71` (actionable failure). The 13-tool error inventory.

#### Files to edit
```
packages/sdk-tools/src/internal/tool-guidance.ts — NEW: injectGuidance, withToolResultGuidance, withDefaultGuidance, DEFAULT_TOOL_GUIDANCE, ToolGuidanceMap
packages/sdk-tools/tests/tool-guidance.test.ts — NEW: RED tests first
```

#### Deep file dependency analysis
- `tool-guidance.ts` imports `CustomTool`/`defineTool` from `@theokit/sdk`. No other file changes this task. Wrapper exercised against `createReadFileTool` in T1.1 tests (real tool, no orphan).

#### Pseudo-code / Signatures
```pseudocode
type ToolGuidanceMap = Record<string, string>
function injectGuidance(output: string, guidance: ToolGuidanceMap): string
  try parsed = JSON.parse(output) catch return output
  if not (isObject(parsed) && parsed.ok === false) return output
  if typeof parsed.guidance === "string" return output
  hint = guidance[parsed.error]; if !hint return output
  return JSON.stringify({ ...parsed, guidance: hint })
function withToolResultGuidance(tool, guidance): CustomTool
  return defineTool-like { name, description, inputSchema(from tool), handler: async i => injectGuidance(await tool.handler(i), guidance) }
const DEFAULT_TOOL_GUIDANCE = { not_found:..., path_traversal:..., forbidden_path:..., no_match:..., no_matches:..., timeout:..., ssrf_blocked:..., catastrophic_command:..., binary_file:..., too_large:... }
function withDefaultGuidance(tool) = withToolResultGuidance(tool, DEFAULT_TOOL_GUIDANCE)
```

#### TDD
```
RED: test_inject_adds_guidance_on_known_error() — injectGuidance('{"ok":false,"error":"not_found"}', MAP) → parsed.guidance is a string
RED: test_inject_leaves_ok_true_unchanged() — '{"ok":true,"content":"x"}' → returned UNCHANGED
RED: test_inject_unknown_code_no_guidance() — '{"ok":false,"error":"weird"}' with MAP lacking it → no guidance, unchanged
RED: test_inject_non_json_passthrough() — "not json at all" → returned verbatim (no throw)
RED: test_inject_non_object_json_passthrough() — "[1,2]" / "null" / "5" → returned unchanged (valid JSON but not an {ok:false} object, edge EC-1)
RED: test_inject_preserves_existing_guidance() — '{"ok":false,"error":"not_found","guidance":"mine"}' → unchanged (idempotent)
RED: test_inject_preserves_other_fields() — '{"ok":false,"error":"not_found","path":"/x"}' → still has path, plus guidance
RED: test_default_map_has_common_codes() — DEFAULT_TOOL_GUIDANCE has not_found, no_match, timeout, ssrf_blocked, catastrophic_command
RED: test_wrapper_preserves_tool_shape() — withToolResultGuidance(tool, MAP) → name/description/inputSchema equal the original
RED: test_wrapper_injects_on_real_tool() — withDefaultGuidance(createReadFileTool({projectRoot})).handler({path:"nope.txt"}) → parsed.ok false AND guidance is a string (integration)
RED: test_wrapper_passes_through_success() — withDefaultGuidance(readTool).handler({path: existing}) → parsed.ok true, no guidance
GREEN: implement tool-guidance.ts
REFACTOR: Biome complexity ≤ 10
VERIFY: pnpm --filter @theokit/sdk-tools exec vitest run tests/tool-guidance.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/tool-guidance.test.ts` reports 11/11 tests passed
- [ ] `test_inject_non_json_passthrough` + `test_inject_leaves_ok_true_unchanged` pass (never-throw passthrough, D3)
- [ ] `test_inject_preserves_existing_guidance` passes (idempotent, D3)
- [ ] `test_wrapper_injects_on_real_tool` passes (integration against `createReadFileTool`, no orphan)
- [ ] `pnpm --filter @theokit/sdk-tools exec biome check packages/sdk-tools/src/internal/tool-guidance.ts` reports 0 errors

#### DoD
- [ ] those tests green; `pnpm --filter @theokit/sdk-tools typecheck` exits 0

---

## Phase 2: Export + document

### T2.1 — Barrel export + docs + changeset + CHANGELOG

#### Objective
Export the five symbols from the barrel; add docs.md note, changeset, CHANGELOG entry; barrel re-export test.

#### Why this step (action + reasoning)
1. **What** — add exports to `index.ts`; document; changeset + CHANGELOG.
2. **Why now** — per `no-stubs-no-mocks-no-wired.md` the wrapper needs a reachable surface (barrel + tests); per CLAUDE.md docs.md reflects the public surface change.

#### Evidence
`index.ts` barrel. Blueprint D5. The `formatCode`/`buildRepoMap` LEGO precedent.

#### Files to edit
```
packages/sdk-tools/src/index.ts — export the five tool-guidance symbols
packages/sdk-tools/tests/tool-guidance.test.ts — barrel re-export test
docs.md — tool-guidance note
CHANGELOG.md (root) — [Unreleased] § Added entry
.changeset/m3-rich-errors.md — NEW minor changeset
```

#### Deep file dependency analysis
- `index.ts` additive exports from `./internal/tool-guidance.js`. Barrel test imports from `../src/index.js`.

#### TDD
```
RED: test_tool_guidance_symbols_exported() — import { withToolResultGuidance, withDefaultGuidance, DEFAULT_TOOL_GUIDANCE, injectGuidance } from barrel → defined
GREEN: add barrel exports + docs + changeset + CHANGELOG
REFACTOR: none (additive)
VERIFY: pnpm --filter @theokit/sdk-tools exec vitest run tests/tool-guidance.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/tool-guidance.test.ts` reports all tests passed (11 + 1 barrel)
- [ ] `test_tool_guidance_symbols_exported` passes (barrel)
- [ ] `grep -c "withToolResultGuidance\|guidance" docs.md` returns ≥ 1 AND `ls .changeset/m3-rich-errors.md` exists AND `grep -c "guidance\|withToolResultGuidance" CHANGELOG.md` ≥ 1
- [ ] `pnpm --filter @theokit/sdk-tools exec biome check` clean on changed files

#### DoD
- [ ] tests green; typecheck exit 0; `pnpm --filter @theokit/sdk-tools build` succeeds; docs/changeset/CHANGELOG present

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | No self-correction guidance on tool fail (M3-4) | T1.1 | `injectGuidance` additive on `{ok:false}` (D2/D3) |
| 2 | A reusable wrapper | T1.1 | `withToolResultGuidance(tool, guidance)` (D1) |
| 3 | Each factory attaches guidance (via composition) | T1.1 | `withDefaultGuidance` over existing tools (D1) |
| 4 | Never corrupt / never throw | T1.1 | passthrough on non-JSON/ok:true/unknown (D3) |
| 5 | Idempotent | T1.1 | preserve existing guidance (D3) |
| 6 | Curated hints | T1.1 | `DEFAULT_TOOL_GUIDANCE` common codes (D4) |
| 7 | Zero new deps | T1.1 | JSON transform only (D1/Rule 9) |
| 8 | Document + record + export | T2.1 | barrel + docs.md + changeset + CHANGELOG + barrel test |

**Coverage: 8/8 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk-tools exec vitest run` green
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-tools typecheck`
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk-tools exec biome check`
- [ ] Dead-code gate — `pnpm quality:dead` (knip) exits 0 (NOTE: sdk-tools is not a knip workspace, so this does not prove these exports are wired; orphan-safety is the integration test wrapping `createReadFileTool` + the `formatCode`/`buildRepoMap` LEGO precedent; `no-stubs` §3 is scoped to `packages/sdk/src`)
- [ ] Build clean — `pnpm --filter @theokit/sdk-tools build`
- [ ] File-size budget respected (`tool-guidance.ts` ≤ 500, target ≤ 150)
- [ ] CHANGELOG.md updated under `[Unreleased]` + changeset added (Unbreakable Rule 6)
- [ ] `docs.md` reflects the tool-guidance wrapper
- [ ] Plan-specific: guidance additive on ok:false; ok:true untouched; non-JSON passthrough; existing guidance preserved; integration-tested on a real built-in tool; zero new deps
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merge

## Dependencies

M3-4 introduces ZERO new dependencies — JSON `parse`/`stringify` + the existing `@theokit/sdk` `defineTool`/`CustomTool` peer (Rule 9 / KISS).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` (`defineTool`, `CustomTool`) | workspace | npm/TS | tool contract (existing peer dep) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | A JSON-patch lib was considered + rejected: additive single-field injection is a 3-line spread, not a patch engine. | n/a — in-house |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Failure scenarios

`injectGuidance` is pure (no I/O) and never throws: a parse error or a non-object result returns the original string; `withToolResultGuidance` only adds an `await` + `injectGuidance` around an existing handler, so it cannot introduce a new failure mode beyond what the wrapped tool already has.

## Final Phase: Integration Validation (MANDATORY)

### Execution
```
pnpm --filter @theokit/sdk-tools exec vitest run tests/tool-guidance.test.ts
pnpm --filter @theokit/sdk-tools exec vitest run        # full sdk-tools suite — no regression
pnpm --filter @theokit/sdk-tools typecheck
pnpm --filter @theokit/sdk-tools exec biome check
pnpm quality:dead
pnpm --filter @theokit/sdk-tools build
```

### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/tool-guidance.test.ts` reports 12 tests passed (0 failed)
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run` exits 0 with 0 failed tests (full suite, no regression)
- [ ] `pnpm --filter @theokit/sdk-tools typecheck` exits 0 (0 type errors) and `pnpm --filter @theokit/sdk-tools exec biome check` reports 0 warnings
- [ ] `pnpm quality:dead` exits 0
- [ ] `pnpm --filter @theokit/sdk-tools build` succeeds (dist emitted)
- [ ] Runtime-metric proof — N/A (pure string transform; observable via the injected `guidance` field)

### If Validation Fails
1. Identify plan-caused vs pre-existing failures. 2. Fix all plan-caused. 3. Re-run. 4. Log pre-existing in the PR.
