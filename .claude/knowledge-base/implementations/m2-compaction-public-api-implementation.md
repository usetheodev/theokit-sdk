# Implementation: M2-1 — Public compaction API (`@theokit/sdk/compaction`)

**Slug:** `m2-compaction-public-api`
**Plan:** `knowledge-base/plans/m2-compaction-public-api-plan.md` (SHIPPABLE 93.2)
**Blueprint:** `knowledge-base/discoveries/blueprints/m2-compaction-public-api-blueprint.md` (SHIPPABLE 98.8)
**Promise:** IMPLEMENTATION_COMPLETE

## Task list

| # | Plan ref | Status | Commit |
|---|---|---|---|
| T1.1 | Phase 1 helpers (isContextOverflowError + checkpoint trio) | committed | `1fdfff0` |
| T1.2 | Phase 1 compactTranscript | committed | `1fdfff0` (same file) |
| T2.1 | Phase 2 subpath wiring + docs | committed | `5b8c9e7` |

## What shipped

`src/compaction.ts` (88 LoC) exporting `compactTranscript`, `buildCheckpoint`, `filterFromLatestCheckpoint`, `CHECKPOINT_MARKER`, `isContextOverflowError` + re-export `CompressibleMessage`. Wired as `@theokit/sdk/compaction` (tsc-DTS path like retry/concurrency — reaches internal/runtime/compression).

- **D1** `compactTranscript` reuses internal `selectCompressionWindow` (no second algorithm); optional `summarize` callback delegates to the internal LLM summarizer.
- **D2** checkpoint = string sentinel + backward-scan filter.
- **D3** `isContextOverflowError` reads typed `context_too_long` (both `code` + `metadata.code`).
- **D5** subpath on tsc-DTS path, zero new deps.

## Validation gate: PASS

| Check | Result |
|---|---|
| Unit tests (`compaction.test.ts`) | 19/19 |
| Integration test (`compaction-wiring.test.ts`) | 2/2 |
| Full SDK suite | 375 files / 2756 passed, 35 skipped, 0 failed (+21 from M1-5 baseline) |
| Typecheck | exit 0 |
| Biome | clean on changed files |
| knip | clean |
| dep-cruiser | clean (compaction.ts not orphan — value edges) |
| Build | dist/compaction.{js,cjs,d.ts,d.cts} emitted |
| attw | `@theokit/sdk/compaction` 🟢 node16 CJS/ESM (node10 pre-existing package-wide baseline) |

## Wiring triad
- (a) Public surface: `@theokit/sdk/compaction` declared in package.json exports (no-orphan public-primitive exception, like retry/messages).
- (b) Integration test: `compaction-wiring.test.ts` exercises all 5 symbols end-to-end.
- (c) Runtime metric: N/A (pure helpers).
