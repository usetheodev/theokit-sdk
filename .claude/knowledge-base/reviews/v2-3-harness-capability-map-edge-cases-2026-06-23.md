# Edge Case Review — V2-3 Harness Capability Map

Date: 2026-06-23
Tasks analyzed: 5 (T1.1, T1.2, T2.1, T2.2, T3.1)
Edge cases found: 3 (MUST FIX: 1, SHOULD TEST: 1, DOCUMENT: 1)

## MUST FIX

### EC-1: the new `persistence` subpath reaches `internal/` → its `.d.ts` must be generated via tsc, not rollup-plugin-dts
- **Affected task:** T1.1
- **Family:** Format / build
- **Scenario:** `tsup.config.ts` only lists `index`/`errors`/`cron`/`server` in its `dts.entry` block; `retry`/`concurrency`/`compaction`/`path-safety` (which reach `internal/runtime`) have their `.d.ts` produced via `tsc` (the `onSuccess`/`tsconfig.tools-dts.json` path) to avoid the `rollup-plugin-dts` import-cycle error. `src/persistence.ts` reaches `internal/persistence`, so it has the SAME constraint.
- **Impact:** if wired only as a tsup `entry` (without the tsc-DTS handling), `pnpm build` either fails on the cycle OR ships a `.js` with a missing/broken `.d.ts` (`@theokit/sdk/persistence` types unusable).
- **Suggested fix:** add `persistence` to the same tsc-DTS mechanism retry uses (the `tsconfig.tools-dts.json` include + the `onSuccess` copy), mirroring retry exactly. Verify `dist/persistence.d.ts` + `dist/persistence.d.cts` exist after build.

## SHOULD TEST

### EC-2: a documented import in the map silently drifts/breaks
- **Affected task:** T2.1 / T3.1
- **Suggested test:** the T3.1 resolve-check MUST extract EVERY `from '@theokit/sdk...'` / `@theokit/sdk-tools` line in the map and `import()` each, asserting the named symbols are present — `test_capability_map_every_import_resolves`. A typo'd primitive name fails the check.

## DOCUMENT

### EC-3: `loadJsonl` exported from both `@theokit/sdk/eval` and `@theokit/sdk/persistence`
- **Accepted risk:** both resolve to the SAME source symbol (no duplication, no drift). The map notes both homes with one canonical example and a one-line "also re-exported from /eval for dataset loading" cross-reference. Not a conflict.

## Summary
| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 1 | 0 | 0 |
| T2.1 | 1 | 0 | 1 | 0 |
| T1.x | 1 | 0 | 0 | 1 |

**Verdict:** PLAN OK (EC-1 absorbed into T1.1 implementation — mirror retry's tsc-DTS wiring)
