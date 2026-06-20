# Architecture Review — M1-5 `@theokit/sdk/messages` readers

Review target: M1-5 changes in commits `69763c7` + `a21949f` (plan `m1-sdkmessage-readers`).
Scope: `packages/sdk/src/messages.ts`, the two test files, and the `./messages` subpath wiring
(`package.json`, `tsup.config.ts`, `tsconfig.tools-dts.json`, `scripts/mirror-dts-to-cts.mjs`).

Verdict: architecturally sound. No BLOCKER/HIGH/MEDIUM issues. Findings below are INFO/LOW.

## [INFO] DIP boundary respected — readers depend only on leaf types
- file: packages/sdk/src/messages.ts:11-12
- detail: The module imports ONLY `type { SDKMessage, ToolUseBlock }` from `./types/messages.js` and `type { CostBreakdown }` from `./types/usage.js`. No `internal/runtime`, no I/O, no concrete adapter. Verified transitively: `types/messages.ts` imports only `ModelSelection` from `./agent-prims.js` (a leaf, zero imports), and `types/usage.ts` imports nothing. The plan's D4 invariant ("leaf-type-only deps, no internal/runtime reach") holds, which is also what keeps it on the tsc-DTS path without tripping the rollup cycle. `grep "internal/" src/messages.ts` returns nothing.
- fix: none — exemplary DIP compliance.

## [INFO] SRP — three cohesive pure readers, one reason to change
- file: packages/sdk/src/messages.ts:20-52
- detail: Each function is a single pure transform over an `SDKMessage`/`CostBreakdown`. No orchestration mixed with extraction, no hidden state, no side effects. Module cohesion answers one question ("read a value out of an SDKMessage") per architecture.md §3. File is 53 lines (budget 500, target 80). Purity is asserted by `test_readers_do_not_mutate_inputs`.
- fix: none.

## [INFO] D2 discriminant filtering applied correctly (type-narrowing predicate)
- file: packages/sdk/src/messages.ts:24-27,41
- detail: Both extractors use the discriminated-union `block.type` discriminant with a type predicate (`(block): block is ToolUseBlock => block.type === "tool_use"`), matching ADR D2's "SDK discriminated blocks, not duck-typing" decision. `assistantText` uses `Extract<typeof block, { type: "text" }>` to narrow to `TextBlock` — equivalent and correct. This is type-safe filtering, not a fragile `switch`/`case` or property-presence sniff. The `SDKToolUseMessage` lifecycle event (`type:"tool_call"`) is correctly excluded — proven by `test_extractToolUses_empty_for_tool_call_lifecycle_message`.
- fix: none. Optional consistency nit below.

## [LOW] Minor stylistic asymmetry between the two block filters
- file: packages/sdk/src/messages.ts:25 vs :41
- detail: `assistantText` narrows with an inline `Extract<typeof block, { type: "text" }>` predicate while `extractToolUses` narrows to the named `ToolUseBlock` interface. Both are correct and type-safe; the asymmetry is purely cosmetic (there is no exported `TextBlock`-returning reader needing the named type). Not a DRY violation — the two filters encode different knowledge (text vs tool_use) per ADR D2.
- fix: optional — for symmetry, `assistantText` could narrow with `block is TextBlock` (TextBlock is already imported as a type elsewhere in tests; it is a public type). Zero functional impact; safe to leave as-is.

## [INFO] D3 cost-honesty contract preserved (no `?? 0` coercion)
- file: packages/sdk/src/messages.ts:50-51
- detail: `costAmountUsd` returns `cost?.amountUsd` verbatim as `number | undefined`. `grep -c "?? 0"` returns 0. A real `$0` (subscription-included) is preserved and `undefined` (unknown) is never coerced — the exact financial-honesty invariant from repo ADR D377. Both branches are tested (`test_costAmountUsd_preserves_real_zero`, `test_costAmountUsd_preserves_undefined_never_zero`).
- fix: none.

## [INFO] OCP/LSP/ISP — not applicable, correctly avoided (KISS + YAGNI)
- file: packages/sdk/src/messages.ts:20-52
- detail: No inheritance, no interfaces with single implementers, no abstraction introduced. `SDKMessage` is a data union and these are free functions over it (ADR D1 rejected a wrapper class on KISS grounds). There is no premature extension point — correct application of YAGNI per the project's principles. No LSP surface (no subtyping); no ISP surface (no interfaces). Inventing any of these would have been the defect.
- fix: none.

## [INFO] No naming collision with the internal `assistantText` fixture builder
- file: packages/sdk/src/messages.ts:20
- detail: `src/internal/runtime/fixtures/fixture-scripts.ts` uses an unrelated `assistantText(request, text)` builder (2-arg, internal, different semantics). The new reader lives in a dedicated subpath module (`src/messages.ts`) and is NOT added to the main barrel (`index.ts`), so the names never meet in one scope. ADR D4's "no main-barrel export" decision plus the dedicated subpath keep the surfaces separate. Plan glossary documents the `src/messages.ts` vs `src/types/messages.ts` distinction too.
- fix: none.

## [INFO] Subpath wiring mirrors the established `path-safety`/tsc-DTS pattern exactly
- file: packages/sdk/package.json (exports `./messages`); packages/sdk/tsup.config.ts (entry `messages`); packages/sdk/tsconfig.tools-dts.json (include `src/messages.ts`); packages/sdk/scripts/mirror-dts-to-cts.mjs (`messages.d.ts`)
- detail: The four wiring edits added by the M1-5 commits are precisely the four touchpoints the plan's D4 prescribes — exports block (import+require with `.d.ts`/`.d.cts`), tsup build entry, tsc-DTS include, and the cts mirror entry. This matches the convention used by `path-safety`, `concurrency`, `retry`, etc. No existing entry was mutated (additive only). `test_subpath_declared_in_package_json` guards the exports key; `pnpm build` emits `dist/messages.{js,cjs,d.ts,d.cts}`. No coupling introduced, no circular dependency (the readers' leaf-only deps are why D4's baseline correction over blueprint EC-3 holds).
- fix: none.

## [INFO] Tests + module hygiene clean
- file: packages/sdk/tests/messages-readers.test.ts; packages/sdk/tests/messages-readers-wiring.test.ts
- detail: 15/15 tests green (13 unit + 2 wiring). Files are kebab-case; functions camelCase; no `any` in `src/messages.ts` (the two `any` grep hits are in JSDoc prose, "any non-assistant message"); no `console.*`; ES modules only (`.js` import specifiers). The wiring test exercises the real public surface end-to-end (realistic assistant message with text+tool_use+text + a CostBreakdown), satisfying the no-orphan public-primitive exception.
- fix: none.

## Summary
- BLOCKER: 0
- HIGH: 0
- MEDIUM: 0
- LOW: 1 (cosmetic filter-predicate asymmetry — optional)
- INFO: 8
