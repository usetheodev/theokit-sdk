# Test-Quality Review — m1-sdkmessage-readers (M1-5)

Target: `packages/sdk/tests/messages-readers.test.ts` (13 unit tests) + `packages/sdk/tests/messages-readers-wiring.test.ts` (2 integration tests). Production: `packages/sdk/src/messages.ts`.

Verdict: ADEQUATE — coverage is complete against the plan's declared TDD list + EC-1/EC-2 + the D2 lifecycle boundary. 15/15 green (verified), typecheck clean. No vacuous assertions. Findings below are LOW/INFO only — no BLOCKER/HIGH/MEDIUM.

## [INFO] Plan TDD list, EC-1/EC-2, and D2 boundary all covered — no scenario missing
- file: packages/sdk/tests/messages-readers.test.ts:46-134
- detail: Every RED test the plan declared (§ T1.1 TDD lines 203-214) maps to a real assertion: concatenates_text_blocks (47), empty_for_non_assistant (51), ignores_tool_use_blocks (60), extractToolUses returns/empty_non_assistant (74/79), costAmountUsd undefined-never-zero (109), real-zero (113), undefined-cost (117), do_not_mutate_inputs (123), empty_content_array x2 EC-1 (64/89), joins_multiple_text_blocks_in_order EC-2 (68). The honesty contract (D3 / repo ADR D377) is split into three distinct tests (undefined-never-0, real-0 preserved, undefined-cost→undefined), which is exactly the right decomposition — it pins the unknown-vs-free distinction that the whole plan hinges on. AAA structure is clean (single-line Arrange via the `text`/`toolUse`/`assistant`/`cost` factories, Act+Assert in the `expect`). Test names describe behavior, no "and". Determinism is total: pure in-memory transforms, no clock/RNG/IO. Coverage is adequate; nothing to add for correctness.
- fix: none

## [INFO] D2 lifecycle-boundary test exceeds the plan — high-value addition
- file: packages/sdk/tests/messages-readers.test.ts:93-105
- detail: `test_extractToolUses_empty_for_tool_call_lifecycle_message` is NOT in the plan's TDD list but directly locks ADR D2's most subtle claim — that `extractToolUses` reads assistant `content` blocks and ignores the SEPARATE `SDKToolUseMessage` (`type:"tool_call"`) lifecycle stream. This is the one place a future maintainer could wrongly "fix" the reader to also scoop tool_call events. The test fixture matches the real `SDKToolUseMessage` shape (`call_id`, `name`, `status:"running"`) verified against types/messages.ts:89-99. Exactly the kind of boundary regression-lock the edge-case philosophy wants.
- fix: none — keep it

## [LOW] Two assistantText tests assert the identical input→output, under different names
- file: packages/sdk/tests/messages-readers.test.ts:60-62, 68-70
- detail: `test_assistantText_ignores_tool_use_blocks` (`[text("a"), toolUse("read"), text("b")]` → `"ab"`) and `test_assistantText_joins_multiple_text_blocks_in_order` (`[text("a"), toolUse("x"), text("b")]` → `"ab"`) exercise the same behavior with the same shape and same expected output — the tool_use name differs but is irrelevant to the assertion. Both map to plan intents (D2 ignore-tool_use and EC-2 ordered-join), so neither is dead, but EC-2's stated purpose ("no reordering, no separator surprise", per edge-cases review line 29-30) is not maximally exercised: with text "a" and "b" the join `"ab"` would still pass if the impl accidentally sorted/deduped. A stronger EC-2 fixture would use a non-alphabetical order and >2 text blocks (e.g. `[text("zeta "), toolUse, text("alpha "), text("9")]` → `"zeta alpha 9"`) so an accidental sort or separator insertion actually fails the test. As written, EC-2 is a correct-but-weak regression lock.
- fix: strengthen the EC-2 fixture to `[text("zeta "), toolUse("x"), text("alpha "), text("9")]` asserting `"zeta alpha 9"` — distinct source-order chars + a trailing space prove order-preservation AND no-separator in one shot, removing the overlap with the ignores_tool_use test.

## [LOW] assistantText non-assistant coverage tests only `system`; plan TDD names `system/tool_call/user`
- file: packages/sdk/tests/messages-readers.test.ts:51-58
- detail: `test_assistantText_empty_for_non_assistant` covers only the `system` variant. The plan's TDD line (plan:204) reads "system/tool_call/user → \"\"". The implementation (messages.ts:21) guards with a single `msg.type !== "assistant"` early-return, so all non-assistant variants take the same branch — behaviorally one test is sufficient and adding three would be testing the same line thrice (correctly avoided per testing.md § "test behavior, not implementation"). This is a documentation/intent mismatch, not a coverage hole: `extractToolUses` covers the `user` variant (line 79) and `tool_call` variant (line 93), so across the two readers the named variants ARE exercised. Flagging only so the reviewer knows the single-variant choice is deliberate and defensible.
- fix: none required. Optionally add a one-line comment at line 51 noting the single `type !== "assistant"` guard makes one non-assistant variant representative, so the intent is explicit.

## [INFO] system-message fixture uses a double cast — acceptable, minimal
- file: packages/sdk/tests/messages-readers.test.ts:52-56
- detail: The `system` fixture is built as `{ type:"system", agent_id, run_id } as unknown as SDKMessage` — `SDKSystemMessage` (types/messages.ts:32) genuinely has no required fields beyond those, so the object is structurally valid; the `as unknown as` is only needed because the literal omits optional fields and TS narrows the object literal too tightly for the union. This is the lightest possible way to get a non-assistant message and does not weaken the assertion (the reader's `type` guard is what's under test). Contrast: the `user` (line 80) and `tool_call` (line 96) fixtures are fully typed with no `unknown` cast — preferred. Not worth changing the system one, but if a future edit touches it, drop to a single `as SDKSystemMessage`.
- fix: none

## [INFO] Purity test is genuine, not vacuous — snapshots both inputs via JSON round-trip
- file: packages/sdk/tests/messages-readers.test.ts:122-133
- detail: `test_readers_do_not_mutate_inputs` snapshots `msg` and `cost` with `JSON.stringify` BEFORE calling all three readers, then re-stringifies and compares. This genuinely catches in-place mutation (e.g. an accidental `.sort()` / `.push()` on `content`, or writing back to `cost`). It does have a known JSON-snapshot limitation (would not catch mutation of a `function`/`undefined`/`Symbol` field, since JSON drops those) — irrelevant here because the inputs are plain data with only `string`/`number`/array fields, all JSON-faithful. The assertion is meaningful and the readers are in fact non-mutating (verified in messages.ts — `filter`/`map` return new arrays, `cost?.amountUsd` is a read). Adequate.
- fix: none

## [INFO] Wiring test is a real integration test through the consumer boundary + a config-contract guard
- file: packages/sdk/tests/messages-readers-wiring.test.ts:16-52
- detail: `test_readers_importable_and_work_on_realistic_message` (17) builds a realistic `SDKAssistantMessage` (interleaved text + tool_use with real `input`) + a `CostBreakdown` and asserts all three readers end-to-end including the honesty re-check (unknown cost → undefined, line 43) — this is the "boundary a consumer hits" and satisfies cycle-implement wiring pillar (b) integration test. `test_subpath_declared_in_package_json` (46) reads the real package.json and asserts `exports["./messages"]` is defined — a genuine config-contract lock for the D4 subpath wiring (matches plan T2.1 AC line 293). Both assertions are substantive, not smoke. Note the spirit of the no-stubs/real-LLM rule does not apply here — these readers are pure transforms with zero LLM path, so fixture-free in-memory data IS the correct integration surface (consistent with the M0/path-safety primitive convention the plan cites).
- fix: none
