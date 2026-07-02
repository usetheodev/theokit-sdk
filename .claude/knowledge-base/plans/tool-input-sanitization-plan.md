# Plan: Public, isolated Tool-Input Sanitization system for `@theokit/sdk`

> Version 1.1 · slug `tool-input-sanitization` · 2026-07-01 · consumes blueprint `.claude/knowledge-base/discoveries/blueprints/tool-calling-robustness-blueprint.md` (SHIPPABLE 98.0). (v1.1 absorbed 4 MUST-FIX + 3 SHOULD-TEST from `.claude/knowledge-base/reviews/tool-input-sanitization-edge-cases-2026-07-01.md`: EC-1 non-object guard, EC-2 round-trip number guard, EC-3 repairJson json-looking gate, EC-4 schema-object-only coercion, EC-5/6/7 tests.)

## Goal

Ship a public, isolated `sanitizeToolInput` primitive (new `@theokit/sdk/sanitize` subpath) plus a declarative `defineTool({ sanitize })` opt-in, verified by a new `tests/sanitize/**` suite (≥ 24 behavior cases across trim / coerce / repair / malformed / no-op) passing green AND `pnpm validate` (publint + attw) accepting the new subpath export.

- Metric: `pnpm --filter @theokit/sdk exec vitest run tests/sanitize` exits 0 with ≥ 24 passing cases AND `pnpm --filter @theokit/sdk validate` exits 0.

## Context

The P0 fix `@theokit/sdk@2.13.1` trimmed leaked-dialect parameter values inside the internal extractor. That revealed a reusable product surface: **every consumer writing a custom tool with `defineTool` receives raw model-emitted args and must hand-roll defensive parsing** (a qwen3-coder tool call can carry `"\npackage.json\n"`, `"true"` where a bool is expected, or a JSON-encoded-string where an array is expected). This plan exposes the same input-hygiene the SDK now does internally as a **first-class, isolated, PUBLIC primitive** that custom tools opt into, and refactors the internal recovery to reuse it (DRY). Design decisions and prior-art citations are locked in the blueprint (SHIPPABLE 98.0), grounded in openclaw / agentfw (MIT) / opencode / cline / vercel-ai-sdk. Compliance: `rules/architecture.md` (DIP — the sanitizer is a pure domain primitive, no transport import), `rules/testing.md` (edge + negative cases), `rules/parsimony-ladder.md` (reuse `jsonrepair`, don't hand-roll), `rules/error-handling.md` (typed, non-swallowing).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last touch | Role today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/define-tool.ts` | 66 | `65763b9`-era (2026-07) | `defineTool<T>` wraps handler with `spec.inputSchema.parse(input)` (line 61); Zod lazy-loaded (SDK's zod-optional decision, per the `define-tool.ts` doc-comment) | zod stays lazy/optional; handler still returns `string`; parse still enforces the full contract |
| `packages/sdk/src/internal/llm/hermes-tool-extract.ts` | 88 | `65763b9` (2026-07-01, P0) | `parseHermesParams` trims key+value (line ~78, post-P0); recovers leaked dialect | leaked-dialect recovery behavior unchanged; values stay strings (doc-comment `:26-30`) |
| `packages/sdk/src/sanitize/sanitize-tool-input.ts` | (NEW) | — | the pure `sanitizeToolInput` primitive | pure, sync, no transport import |
| `packages/sdk/src/sanitize/types.ts` | (NEW) | — | `SanitizeOptions`, `SanitizeResult` public types | — |
| `packages/sdk/src/sanitize/index.ts` | (NEW) | — | subpath barrel | exports only the public surface |
| `packages/sdk/package.json` | ~ | — | `exports` map (has `./subscription`, `./compaction`, `./cron`, `./errors`) | dual ESM+CJS shape per existing entries |
| `packages/sdk/tsup.config.ts` | ~ | — | entry map incl. `"subscription/index": "src/subscription/index.ts"` (line 34) | DTS-via-tsc onSuccess pattern for subpaths |
| `docs.md` | ~ | — | canonical public API contract | any new public surface reflected here (SDK CLAUDE.md checklist) |
| `packages/sdk/tests/sanitize/*.test.ts` | (NEW) | — | RED suites | `tests/**/*.test.ts` picked up by vitest (`vitest.config.ts:12`) |

### Current callers / dependents

- `defineTool` — exported from `packages/sdk/src/index.ts` (public barrel); consumed by SDK examples + user code. Handler is registered via `internal/tool-registry/registry.ts:57-58` (`handler: custom.handler`). Changing the handler wrapper is backward-compatible as long as `sanitize` is optional and absent ⇒ identical behavior.
- `parseHermesParams` — internal to `hermes-tool-extract.ts`; sole caller is `extractHermesToolCalls` (same file, line 64). Consumed by the OpenAI accumulator recovery path (`internal/llm/openai.js`, per P0). No external callers (internal symbol).
- `@theokit/sdk/subscription` — the subpath-export precedent: `package.json exports["./subscription"]`, `tsup.config.ts:34`, DTS via tsc onSuccess (`tsup.config.ts:61`). The `./sanitize` subpath mirrors it exactly.

### Domain glossary

- **Sanitize** — normalize model-emitted raw args before schema validation: trim whitespace (default), optionally coerce string→typed, optionally JSON-repair malformed JSON-strings. Never changes a value's *meaning*, only its *hygiene/representation*.
- **Coerce** — type conversion of a string to the type the schema expects (`"true"`→`true`, `"5"`→`5`, `'["a"]'`→`["a"]`). Opt-in (D3).
- **Leaked dialect** — a model emitting its tool-call dialect as assistant TEXT instead of native `tool_calls` (qwen3-coder `<function=><parameter=>`).
- **Subpath export** — a secondary entry point of the package (e.g. `@theokit/sdk/sanitize`) with its own dual ESM+CJS + `.d.ts`.

### Architecture boundaries affected

- New public module `src/sanitize/` is a **domain primitive** (pure, no dependency on `internal/llm/*` or transport). Per `rules/architecture.md` DIP, dependency flows infra→domain: `internal/llm/hermes-tool-extract.ts` (infra-ish) MAY import `src/sanitize/` (domain), never the reverse.
- New public API surface (`@theokit/sdk/sanitize` + `DefineToolSpec.sanitize`) → `docs.md` MUST be updated in the same PR (SDK CLAUDE.md § Checklist).

## Prior Art & Related Work

- Internal blueprint `.claude/knowledge-base/discoveries/blueprints/tool-calling-robustness-blueprint.md` (SHIPPABLE 98.0) — the design source; ADRs D1-D5 map to this plan's ADRs.
- agentfw `coerceParameter` (`.claude/knowledge-base/references/agentfw/packages/agentfw/src/daemon/translate/xml-tool-calls.ts:191`) — the per-value trim+coerce cascade this primitive mirrors; its test inventory (`…/xml-tool-calls.test.ts`) is the RED-set template.
- cline `jsonrepair ^3.13.2` (`.claude/knowledge-base/references/cline/sdk/packages/shared/package.json:59`) — the mature JSON-repair lib to reuse (parsimony-ladder Rung 2/4).
- No `*-patterns` skill exists in `skills/` for this domain (verified `ls skills/*-patterns/` empty) — the blueprint is the sole prior-art anchor.

## Objective

- [ ] SG1 — `sanitizeToolInput(input, options?)` pure primitive: trim (default on), coerce (opt-in), repairJson (opt-in), optional schema-aware coercion, `deep` recursion opt-in; returns `{ value, changed, notes }`.
- [ ] SG2 — `@theokit/sdk/sanitize` subpath builds (dual ESM+CJS + `.d.ts`) and `pnpm validate` accepts it.
- [ ] SG3 — `defineTool({ sanitize })` opt-in sanitizes raw input before `inputSchema.parse`; absent ⇒ byte-identical behavior.
- [ ] SG4 — internal `parseHermesParams` delegates trim to `sanitizeToolInput` (DRY); all existing hermes tests stay green.
- [ ] SG5 — `docs.md` documents the new public surface; full integration gate green.

## ADRs

### D1 — Two entry points: standalone `sanitizeToolInput` + declarative `defineTool({ sanitize })`
**Decision:** ship both a pure exported function and a `defineTool` opt-in field.
**Rationale:** DRY (Rule 12) + two real consumer shapes (blueprint D1). Power users sanitize manually inside `execute`; most want a one-flag opt-in. `rules/architecture.md` — one implementation, two adapters.
**Rejected alternative:** function-only — most users won't wire it, so the value (fewer tool-arg bugs) never lands. Rejected.

### D2 — Isolation: dedicated `@theokit/sdk/sanitize` subpath, pure, zero transport import
**Decision:** the primitive lives in `src/sanitize/`, exported as its own subpath.
**Rationale:** the user's explicit ask ("de forma isolada"); openclaw ships it as an isolated package (blueprint Corner 3); DIP boundary in `rules/architecture.md`. Subpath precedent: `@theokit/sdk/subscription`.
**Rejected alternative:** bury it inside `internal/llm/` — not reusable by custom tools, violates the ask. Rejected.

### D3 — Default = trim-only; coerce/repairJson opt-in
**Decision:** `trim` defaults on; `coerce` and `repairJson` default off.
**Rationale:** trim is safe hygiene (the P0 lesson); coercion changes types and must be explicit (the SDK's locked "values are strings; Zod coerces" decision, `hermes-tool-extract.ts:26-30`; `rules/parsimony-ladder § Never on the chopping block` — don't weaken the typed boundary silently).
**Rejected alternative:** coerce-by-default — silent type changes surprise users and can mask schema bugs. Rejected.

### D4 — Reuse `jsonrepair` (lazy-loaded), don't hand-roll
**Decision:** the opt-in `repairJson` rung wraps `jsonrepair ^3.13.2`, lazy-loaded via `createRequire` (mirrors zod's lazy load in `define-tool.ts`).
**Rationale:** `rules/parsimony-ladder` Rung 2/4 (Unbreakable Rule 9 — don't reinvent parsers); cline trusts it. Lazy load keeps it out of the hot path for consumers who never set `repairJson`.
**Rejected alternative:** hand-rolled repair — maintenance + correctness risk on a solved problem. Rejected. **Alternative considered:** make jsonrepair a hard dep — rejected in favor of lazy optional to keep install lean.

### D5 — Internal recovery reuses the public primitive
**Decision:** `parseHermesParams` calls `sanitizeToolInput` for its trim (P0 behavior preserved, now delegated).
**Rationale:** DRY (Rule 12) — the public primitive and internal recovery must never diverge (that divergence is the P0 bug class). Direction infra→domain is DIP-correct.
**Rejected alternative:** keep the inline `.trim()` — duplicates knowledge, risks re-drift. Rejected.

## Drawbacks & Risks

| # | Risk | Severity | Mitigation | Owner |
|---|---|---|---|---|
| R1 | New public API surface is a forward-compat commitment (can't easily remove `sanitize` field / subpath later) | MEDIUM | Keep the surface minimal (one function + one options type + one `defineTool` field); document as stable only what we're sure of; `notes` field gives us an extension seam without new params | paulo |
| R2 | `jsonrepair` new (optional) dependency → supply-chain + CVE surface | MEDIUM | Lazy-load (D4), pin `^3.13.2`, `/deps-audit` gate must pass before implement | paulo |
| R3 | Coercion could change a value the user actually wanted as a string (`"true"` meant literally) | LOW-MED | coerce is opt-in (D3); schema-aware mode only coerces where the schema expects a non-string; `notes` records every coercion for debuggability | paulo |
| R4 | `deep` recursion on a huge nested arg could be O(n) heavy | LOW | `deep` opt-in + a bounded depth guard (mirrors openclaw's 256K cap philosophy); default shallow | paulo |

## Unresolved Questions

(none — every decision is resolved at plan time.) The items below are ADR-scoped deferrals, not open questions:

- (Deferred by ADR, not open) The blueprint's R5 (request-scoped tool-name matching), R6 (doom-loop no-progress guard), and R7 (stream-boundary normalization) are **out of scope for this plan** — they harden the *internal recovery*, not the *public sanitizer*. They become follow-up plans once this public surface ships. This plan delivers the user's explicit ask (public sanitization for custom tools) as a coherent, independently-shippable increment. No open questions block implementation.

## Dependencies

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| `jsonrepair` (NEW) | `^3.13.2` | npm | Evaluated: (a) **hand-roll** — rejected (Rule 9: structural JSON repair is a solved, spec-adjacent problem; maintenance + correctness risk); (b) **`json5`** — rejected (a permissive-JSON *parser*, not a *repairer* — does not fix truncated/unquoted-control-char output); (c) **`best-effort-json-parser`** — rejected (less maintained, smaller adoption than jsonrepair). | Purpose-built structural repairer; zero transitive deps (verified `npm view jsonrepair dependencies` = empty); cline (`.claude/knowledge-base/references/cline/sdk/packages/shared/package.json:59`) trusts this exact range; `^3.13.2` resolves to current 3.14.x. Lazy-loaded, opt-in only (D4). |

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `zod` | `^4.0.0` | npm | Already a dependency; reused for optional schema-aware coercion. No new entry. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Dependency Graph

```
Phase 1 (core primitive + subpath)  ──► Phase 2 (defineTool opt-in)
        │                                        │
        └───────────────► Phase 3 (internal DRY reuse) ◄─┘
                                   │
                                   ▼
                         Final Phase (Integration Validation)
```
Phase 1 blocks 2 and 3 (both import the primitive). Phase 2 and Phase 3 are independent of each other (parallelizable). Final phase depends on all.

## Phase 1: Core `sanitizeToolInput` primitive + isolated subpath

### T1.1 — Pure `sanitizeToolInput` primitive + public types

#### Objective
Implement the pure sanitizer: trim (default), coerce (opt-in, heuristic or schema-aware), repairJson (opt-in), `deep` (opt-in, bounded), returning `{ value, changed, notes }`.

#### Why this step (action + reasoning)
Action: create `src/sanitize/sanitize-tool-input.ts` + `src/sanitize/types.ts` with the primitive and its public types.
Why now: it is the foundation both other phases import (Dependency Graph); building it first with a full RED set (from agentfw's test inventory, Prior Art) means Phases 2-3 wire a proven primitive, not a moving target. Cites ADR D1/D3/D4.

#### Evidence
agentfw `coerceParameter` cascade (`.claude/knowledge-base/references/agentfw/packages/agentfw/src/daemon/translate/xml-tool-calls.ts:191`) + its coercion test (`…/xml-tool-calls.test.ts:90`) define the exact coerce contract; blueprint Corner 4 T2.

#### Files to edit
```
packages/sdk/src/sanitize/sanitize-tool-input.ts — (NEW) the primitive
packages/sdk/src/sanitize/types.ts — (NEW) SanitizeOptions, SanitizeResult
packages/sdk/tests/sanitize/sanitize-tool-input.test.ts — (NEW) RED first
```

#### Deep file dependency analysis
- New leaf files; no downstream depends on them yet (Phases 2-3 will import in later tasks).
- Zod imported as a TYPE only for the optional `schema` option (mirrors `define-tool.ts` `import type` erasure); `jsonrepair` lazy via `createRequire` only inside the `repairJson` branch.

#### Deep Dives
- Invariants: pure + sync + no transport import (Baseline § Architecture boundaries); default (no options) = trim-only, values stay strings unless `coerce`/`repairJson` explicitly set (D3); never throws on malformed input — records a note and leaves the value (Rule 8: typed, non-swallowing → the function's contract is total).
- **EC-1 (total contract):** guard non-object input at entry — `if (input === null || typeof input !== "object" || Array.isArray(input)) return { value: input, changed: false, notes: [] }`. `Object.entries(null)` must never be reached.
- **EC-2 (no ID/precision corruption):** coerce a string to number ONLY when `Number.isFinite(n) && String(n) === raw.trim()` (round-trip guard) — rejects big-ints (`"123…890"`), leading-zeros (`"007"`), `NaN`/`Infinity`, and `"1e3"`≠`"1000"`, leaving them as strings. This is the single most dangerous coercion bug (silent wrong-but-plausible values).
- **EC-3 (repair only JSON-looking):** the `repairJson` branch fires only when `raw.trim()` starts with `{` or `[`; a plain-text arg is never handed to `jsonrepair`.
- **EC-4 (schema-aware coerce is z.object-only):** schema-aware per-key coercion runs only when the schema exposes `.shape` (a `z.object`); for `z.union`/`z.record`/`z.effects` fall back to heuristic coercion (or no-op) — never access `undefined.shape`, never throw.

#### Pseudo-code / Signatures
```ts
export interface SanitizeOptions { trim?: boolean; coerce?: boolean; repairJson?: boolean; schema?: ZodType; deep?: boolean; maxDepth?: number }
export interface SanitizeResult<T = Record<string, unknown>> { value: T; changed: boolean; notes: string[] }
export function sanitizeToolInput(input: Record<string, unknown>, options?: SanitizeOptions): SanitizeResult
```

#### TDD
Strict RED-GREEN-REFACTOR. RED first:
```
RED: test_trim_is_default_on — { path: "\npackage.json\n" } → { path: "package.json" }, changed=true
RED: test_trim_preserves_internal_newlines — multi-line command keeps internal \n
RED: test_no_options_is_trim_only_strings_stay_strings — { n: "5" } → { n: "5" } (no coerce)
RED: test_coerce_string_number — coerce:true, { n: "5" } → { n: 5 }
RED: test_coerce_string_boolean — coerce:true, { b: "true" } → { b: true }; { b: "false" } → false
RED: test_coerce_string_null — coerce:true, { x: "null" } → { x: null }
RED: test_coerce_json_encoded_array — coerce:true, { a: '["x","y"]' } → { a: ["x","y"] }
RED: test_coerce_json_encoded_object — coerce:true, { o: '{"k":1}' } → { o: { k: 1 } }
RED: test_coerce_non_coercible_stays_string — coerce:true, { s: "hello" } → { s: "hello" }
RED: test_schema_aware_coerce_only_where_schema_expects — schema { n: number, s: string }, { n:"5", s:"5" } → { n:5, s:"5" }
RED: test_repair_json_malformed_string — repairJson:true, { o: '{k:1}' } → { o: { k: 1 } }
RED: test_repair_json_off_by_default — { o: '{k:1}' } (no repairJson) → { o: '{k:1}' } unchanged
RED: test_clean_input_is_noop_changed_false — { path: "a.ts" } → changed=false, notes=[]
RED: test_notes_records_each_change — a coercion + a trim → notes has 2 entries
RED: test_deep_off_by_default_shallow_only — nested { a: { b: " x " } } shallow → inner untouched
RED: test_deep_on_recurses_bounded — deep:true trims nested; maxDepth guard stops runaway
RED: test_non_string_values_untouched — { n: 5, arr: [1,2] } → unchanged
RED: test_empty_input — {} → { value:{}, changed:false, notes:[] }
RED: test_never_throws_on_weird_input — { x: Symbol-ish/circular-safe } → does not throw
RED: test_non_object_input_returns_as_is_no_throw (EC-1) — sanitizeToolInput(null), (["x"]), ("s") → { value: input, changed:false, notes:[] }, no throw
RED: test_coerce_bigint_string_stays_string (EC-2) — coerce:true, { id:"12345678901234567890" } → stays string (round-trip fails)
RED: test_coerce_leading_zero_stays_string (EC-2) — coerce:true, { code:"007" } → stays "007"
RED: test_coerce_nan_infinity_stays_string (EC-2) — coerce:true, { a:"NaN", b:"Infinity" } → stay strings
RED: test_repairJson_leaves_plaintext_untouched (EC-3) — repairJson:true, { note:"hello world" } → unchanged
RED: test_schema_union_or_record_falls_back_no_throw (EC-4) — coerce:true + z.union/z.record schema → no throw, heuristic-or-noop
RED: test_whitespace_only_trims_to_empty (EC-5) — { x:"   " } → { x:"" }, changed=true
RED: test_deep_recursion_bounded_by_maxDepth (EC-6) — nested deeper than maxDepth → stops at cap, no throw/hang, values beyond cap untouched
GREEN: implement the cascade (trim → optional schema-aware/heuristic coerce → optional jsonrepair), agentfw coerceParameter-style, with the EC-1..EC-4 guards
REFACTOR: extract per-value coerce into a small internal helper; keep function < 120 LoC
```

#### Concurrency tests (only when applicable)
(none — single-threaded) pure synchronous function; no shared state, no async.)

#### Failure scenarios
(none — no external I/O; `jsonrepair` is a pure in-process lib call, covered by the repair unit tests above.)

#### Acceptance Criteria
- `tests/sanitize/sanitize-tool-input.test.ts` runs ≥ 20 cases and exits 0.
- `test_no_options_is_trim_only_strings_stay_strings` passes (default call trims only; coerce/repairJson off unless set).
- `test_non_object_input_returns_as_is_no_throw` and `test_never_throws_on_weird_input` pass (total contract — function returns for every input, never throws).
- `test_notes_records_each_change` passes (every mutation is recorded in `notes`).
- `wc -l packages/sdk/src/sanitize/sanitize-tool-input.ts` reports < 120 (per `rules/architecture.md` budget).

#### DoD
- `pnpm --filter @theokit/sdk exec vitest run tests/sanitize/sanitize-tool-input.test.ts` exits 0.
- `pnpm --filter @theokit/sdk typecheck` clean; biome clean on the new files.

### T1.2 — Isolated `@theokit/sdk/sanitize` subpath wiring

#### Objective
Export the primitive + types via a new `@theokit/sdk/sanitize` subpath (dual ESM+CJS + `.d.ts`), mirroring `./subscription`.

#### Why this step (action + reasoning)
Action: add `src/sanitize/index.ts` barrel + `package.json` export block + `tsup.config.ts` entry + DTS onSuccess wiring.
Why now: SG2 requires the subpath to build and pass `pnpm validate`; wiring it in Phase 1 (right after the primitive) means Phase 2/3 and the final gate consume a real, validated export. Cites ADR D2 + Baseline § subscription precedent.

#### Evidence
`package.json exports["./subscription"]` + `tsup.config.ts:34` (`"subscription/index": "src/subscription/index.ts"`) + DTS via tsc onSuccess (`tsup.config.ts:61`) are the exact pattern to mirror.

#### Files to edit
```
packages/sdk/src/sanitize/index.ts — (NEW) barrel: export { sanitizeToolInput } + types
packages/sdk/package.json — add exports["./sanitize"] (mirror ./subscription block)
packages/sdk/tsup.config.ts — add entry "sanitize/index": "src/sanitize/index.ts" (+ DTS list)
packages/sdk/tests/sanitize/subpath-export.test.ts — (NEW) imports from "../../src/sanitize/index.js" asserting public surface
```

#### Deep file dependency analysis
- `index.ts` re-exports T1.1 symbols; the barrel is the public contract (minimal surface).
- `package.json`/`tsup.config.ts` are build config; the subscription entries are the proven template — no import-cycle risk since `src/sanitize/` reaches nothing in `internal/runtime`.

#### Deep Dives
- Invariants: the barrel exports ONLY `sanitizeToolInput`, `SanitizeOptions`, `SanitizeResult` (narrow surface, `rules/architecture.md § Module cohesion`); dual ESM+CJS shape matches sibling subpaths; `.d.ts` + `.d.cts` both emitted.

#### TDD
```
RED: test_barrel_exports_public_surface — import { sanitizeToolInput } from src/sanitize/index.js is a function; types importable
GREEN: write the barrel + config entries
REFACTOR: none (config)
```
Build-level proof (in DoD, not a unit test): `pnpm build` emits `dist/sanitize/index.{js,cjs,d.ts,d.cts}`; `pnpm validate` (publint+attw) accepts `./sanitize`.

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Failure scenarios
(none — no external I/O.)

#### Acceptance Criteria
- `dist/sanitize/index.js`, `.cjs`, `.d.ts`, `.d.cts` all emitted by `pnpm build`.
- `pnpm validate` passes with the new subpath (publint + attw green).
- Barrel exports exactly the three public symbols.

#### DoD
- `pnpm --filter @theokit/sdk build` succeeds and emits the 4 subpath artifacts.
- `pnpm --filter @theokit/sdk validate` exits 0.

## Phase 2: `defineTool({ sanitize })` declarative opt-in

### T2.1 — Wire sanitizer into `defineTool` handler

#### Objective
Add optional `sanitize?: boolean | SanitizeOptions` to `DefineToolSpec`; when set, sanitize the raw `input` (schema-aware, since the tool's Zod schema is present) BEFORE `spec.inputSchema.parse`. Absent ⇒ byte-identical current behavior.

#### Why this step (action + reasoning)
Action: extend `DefineToolSpec<T>` + the handler wrapper in `define-tool.ts` to call `sanitizeToolInput(input, { ...opts, schema: spec.inputSchema })` when `sanitize` is truthy.
Why now: this is the user's headline ask (custom tools consuming sanitization). It depends on Phase 1's primitive (Dependency Graph). Cites ADR D1/D3.

#### Evidence
`define-tool.ts:61` `spec.inputSchema.parse(input)` is the exact seam — sanitize the record just before parse so trimmed/coerced args satisfy the schema.

#### Files to edit
```
packages/sdk/src/define-tool.ts — add `sanitize` field + pre-parse sanitize call
packages/sdk/tests/sanitize/define-tool-sanitize.test.ts — (NEW) RED first
```

#### Deep file dependency analysis
- `define-tool.ts` today (Baseline row): wraps `handler` with `parse(input)`. Adding a pre-parse sanitize is backward-compatible: `sanitize` absent → no call → identical path (the golden-test guard).
- Downstream: `internal/tool-registry/registry.ts:57-58` registers `custom.handler` unchanged — the wrapper shape is preserved.
- `sanitize:true` ⇒ `{ trim:true }` (schema-aware coerce stays opt-in via the object form `sanitize:{ coerce:true }`), honoring D3.

#### Deep Dives
- Invariants: absent `sanitize` ⇒ zero behavior change (byte-identical); `sanitize:true` default trims; the handler still returns `string`; parse still throws `ZodError` on genuinely-invalid input (sanitize is hygiene, not a validity bypass — Rule 8).

#### Pseudo-code / Signatures
```ts
export interface DefineToolSpec<T extends ZodType> { /* …existing… */ sanitize?: boolean | SanitizeOptions }
// handler: const raw = sanitize ? sanitizeToolInput(input, { ...norm(sanitize), schema: spec.inputSchema }).value : input
//          const parsed = spec.inputSchema.parse(raw)
```

#### TDD
```
RED: test_sanitize_absent_is_identical_behavior — no sanitize → \n-wrapped arg still reaches parse untouched (ZodError as today)
RED: test_sanitize_true_trims_then_parses — sanitize:true, { path: "\na.ts\n" } → handler receives { path: "a.ts" }
RED: test_sanitize_coerce_lets_string_number_pass_number_schema — sanitize:{coerce:true}, schema n:number, { n:"5" } → parses, handler gets 5
RED: test_sanitize_does_not_bypass_genuine_validation — sanitize:true, missing required field → still ZodError
GREEN: implement the pre-parse sanitize branch
REFACTOR: normalize boolean|SanitizeOptions once
```

#### Concurrency tests (only when applicable)
(none — single-threaded) handler async but sanitize is sync and stateless.)

#### Failure scenarios
(none — no external I/O.)

#### Acceptance Criteria
- `test_sanitize_absent_is_identical_behavior` passes (absent `sanitize` ⇒ byte-identical current path).
- `test_sanitize_true_trims_then_parses` and `test_sanitize_coerce_lets_string_number_pass_number_schema` pass (opt-in trim + schema-aware coerce reach the handler).
- `test_sanitize_does_not_bypass_genuine_validation` passes (a missing required field still raises `ZodError`).

#### DoD
- `pnpm --filter @theokit/sdk exec vitest run tests/sanitize/define-tool-sanitize.test.ts` exits 0.
- Existing `define-tool` suite stays green; typecheck + biome clean.

## Phase 3: Internal DRY — leaked-dialect recovery reuses the primitive

### T3.1 — `parseHermesParams` delegates trim to `sanitizeToolInput`

#### Objective
Replace the inline `value.trim()` in `parseHermesParams` with a delegation to `sanitizeToolInput` (trim-only), so the public primitive and internal recovery share one source of truth.

#### Why this step (action + reasoning)
Action: import `sanitizeToolInput` in `hermes-tool-extract.ts`; build the params record then `sanitizeToolInput(record, { trim:true }).value`.
Why now: DRY (ADR D5) — the P0 bug was born from ad-hoc, un-shared trimming; delegating guarantees the internal path and the public primitive never diverge. Depends on Phase 1.

#### Evidence
`hermes-tool-extract.ts` `parseHermesParams` (post-P0, line ~78) currently does `input[key.trim()] = value.trim()`; the trim knowledge now lives in the sanitizer.

#### Files to edit
```
packages/sdk/src/internal/llm/hermes-tool-extract.ts — delegate trim to sanitizeToolInput
packages/sdk/tests/internal/llm/hermes-tool-extract.test.ts — add a delegation-holds assertion (existing suite stays green)
```

#### Deep file dependency analysis
- `parseHermesParams` sole caller is `extractHermesToolCalls` (same file:64). The output shape (Record<string,string>) is unchanged — values stay strings (doc-comment invariant `:26-30`), so the accumulator consumer is unaffected.
- Import direction: `internal/llm/*` → `src/sanitize/*` (infra→domain), DIP-correct (Baseline § boundaries).

#### Deep Dives
- Invariants: all 12 existing hermes tests stay green (the P0 regression tests included); recovered values still strings; behavior identical, implementation now shared.

#### TDD
```
RED: test_parseHermesParams_still_trims_via_delegation — the P0 case { path: "\npackage.json\n" } → { path: "package.json" } STILL passes (now through the shared primitive)
RED: test_parseHermesParams_still_trims_key (EC-7) — `<parameter= path >` (spaces around key) still yields key `path` (KEY trim at build time is preserved; sanitizer trims VALUES)
GREEN: swap inline trim for sanitizeToolInput(record,{trim:true}).value
REFACTOR: none
```
(Existing 12 hermes tests are the regression guard — must stay green.)

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Failure scenarios
(none — no external I/O.)

#### Acceptance Criteria
- All existing `hermes-tool-extract.test.ts` cases (incl. P0 regressions) stay green.
- The trim is provably delegated (no inline `.trim()` on the value remains).

#### DoD
- `pnpm --filter @theokit/sdk exec vitest run tests/internal/llm/hermes-tool-extract.test.ts` exits 0 (12+1 cases).
- `grep -n "value.trim()" hermes-tool-extract.ts` returns nothing (delegation complete).

## Coverage Matrix

| Requirement / Sub-goal | Task(s) | Blueprint anchor |
|---|---|---|
| SG1 — pure primitive (trim/coerce/repair/deep) | T1.1 | R1, D1, D3, D4 |
| SG2 — isolated subpath builds + validate | T1.2 | R1, D2 |
| SG3 — `defineTool({ sanitize })` opt-in | T2.1 | R2, D1, D3 |
| SG4 — internal DRY reuse | T3.1 | R4, D5 |
| SG5 — docs + integration gate | Final Phase | (checklist) |
| Reuse `jsonrepair` (don't reinvent) | T1.1 + Dependencies | R3, D4 |
| Never-throw / typed hygiene | T1.1 | error-handling.md |

**Coverage: 5/5 sub-goals + 2 cross-cutting mapped (100%).**

## Failure scenarios (when I/O external)

(none — the entire plan is pure in-process computation. No HTTP/DB/queue/socket/object-store is touched. `jsonrepair` is an in-process pure parser, exercised by unit tests in T1.1.)

## Global Definition of Done

- [ ] All phase tasks' DoD satisfied; `tests/sanitize/**` ≥ 24 cases green.
- [ ] `pnpm --filter @theokit/sdk typecheck` clean; biome clean.
- [ ] `pnpm --filter @theokit/sdk build` emits the `dist/sanitize/*` artifacts.
- [ ] `pnpm --filter @theokit/sdk validate` (publint + attw) exits 0 with the new subpath.
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/define-tool tests/internal/llm/hermes-tool-extract.test.ts` exits 0 (existing suites, no regression).
- [ ] `grep -q "@theokit/sdk/sanitize" docs.md` succeeds AND a `.changeset/*.md` for `@theokit/sdk` exists (Unbreakable Rule 6).
- [ ] `wc -l` on each new `src/sanitize/*.ts` reports < 500 (sanitizer file < 120).
- [ ] `pnpm --filter @theokit/sdk quality:dead` (knip) reports zero orphan exports under `src/sanitize/`.

## Final Phase: Integration Validation

### T4.1 — Full-chain integration gate + public docs

#### Objective
Prove the whole feature works end-to-end and the public contract is documented.

#### Why this step
"Eat your own cooking" — the plan is not done until the full gate is green and the public surface is in `docs.md`.

#### Files to edit
```
docs.md — document @theokit/sdk/sanitize + defineTool({ sanitize })
packages/sdk/CHANGELOG.md OR .changeset/* — Added entry (Rule 6)
packages/sdk/tests/sanitize/integration.test.ts — (NEW) a defineTool({sanitize}) end-to-end: loose args → handler receives clean typed input
```

#### TDD
```
RED: test_end_to_end_defineTool_sanitize — build a real tool with sanitize:{coerce:true}, feed { n:"5", path:"\na.ts\n" }, assert handler ran with { n:5, path:"a.ts" }
GREEN: (feature already implemented in P1-P3; this is the wiring proof)
```

#### Concurrency tests (only when applicable)
(none — single-threaded) the end-to-end tool handler is async but sanitize is synchronous and stateless.)

#### Failure scenarios
(none — no external I/O touched.)

#### Acceptance Criteria / DoD
- `pnpm --filter @theokit/sdk test` (full suite) exits 0.
- `pnpm --filter @theokit/sdk typecheck && pnpm --filter @theokit/sdk lint` both exit 0.
- `pnpm --filter @theokit/sdk validate` exits 0.
- `grep -q "@theokit/sdk/sanitize" docs.md` succeeds and a `@theokit/sdk` changeset file exists.
- `/code-quality` emits a verdict ∉ {FAIL_HARD, INVALID}; `/review` emits `READY_TO_MERGE`.
