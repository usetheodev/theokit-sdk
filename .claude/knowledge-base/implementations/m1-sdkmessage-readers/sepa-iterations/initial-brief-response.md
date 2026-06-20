# SEPA Initial Brief — M1-5 (2026-06-20)

**Verdict: plan is sound.** No design defects.

## Findings
1. **Type shapes all correct** — TextBlock(:9-12), ToolUseBlock(:19-25), SDKAssistantMessage.content(:58-66), SDKMessage(:161-170), CostBreakdown.amountUsd: number|undefined (usage.ts:56, D377 honesty in JSDoc :51-54). D3 `?? 0`-forbidden is sound.
2. **Citation-path note (not a defect)** — plan cites `theocode/server/lib/sdk-mappers.ts` as in-repo; the real file is the sibling project `../theocode/server/lib/sdk-mappers.ts`. Its assistantText(:17-23) + costToDomain(:56-58, `amountUsd ?? null`) match the claims. plan-confidence M3 doesn't check src refs so it passed. Implementer: don't grep local tree for it.
3. **Path-safety wiring pattern confirmed across 4 files** — path-safety is in tsup `entry` (NOT `dts.entry` which lists only index/errors/cron/server :38-46), present in tsconfig.tools-dts.json:13 + mirror-dts-to-cts.mjs:32. Plan's EC-3 baseline correction (tsc-DTS path) is right.
4. **Highest-risk wiring: the cts mirror** (`scripts/mirror-dts-to-cts.mjs`). Hand-maintained literal list; add file-form `join(DIST, "messages.d.ts")` (like path-safety.d.ts:32). Omission still builds GREEN but `dist/messages.d.cts` silently absent → attw "Masquerading as ESM". Verify: `ls dist/messages.d.cts` + attw/publint. Other 3 files fail loudly.
5. **extractToolUses type-guard correct** — `(b): b is ToolUseBlock => b.type === "tool_use"` narrows soundly (disjoint discriminant vs TextBlock "text").
6. **Missing test (add a 13th)** — `test_extractToolUses_empty_for_tool_call_lifecycle_message`: feed an `SDKToolUseMessage` (type:"tool_call", messages.ts:89) and assert `[]`. Pins the D2 boundary (lifecycle `tool_call` event ≠ assistant `tool_use` content block) — the one untested confusion risk D2 calls out.
