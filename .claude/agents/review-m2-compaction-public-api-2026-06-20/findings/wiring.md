# Wiring Review — M2-1 `@theokit/sdk/compaction`

**Verdict: WIRING COMPLETE.** The `@theokit/sdk/compaction` subpath is wired correctly across all four files via the tsc-DTS pattern, exactly mirroring `retry`/`concurrency` (modules that also reach `internal/runtime`). Build emits all four artifacts, integration test exercises every public symbol, dep-cruiser does not flag orphan, attw resolves node16 🟢. No BLOCKER/HIGH/MEDIUM findings.

## Evidence summary

### Subpath wiring across all 4 files (ADR D5 — tsc-DTS path)

| File | Requirement | Status |
|---|---|---|
| `packages/sdk/package.json:51-60` | `./compaction` exports block (import+require, types+default) | PRESENT — byte-identical shape to `./retry` (`:91-100`) and `./concurrency` (`:81-90`); CJS condition points at `./dist/compaction.d.cts` |
| `packages/sdk/tsup.config.ts:11` | entry `compaction: "src/compaction.ts"` | PRESENT — NOT in the rollup `dts.entry` block (`:42-50`), correct (rollup leaf path is only for leaf-type-only modules; compaction has value imports) |
| `packages/sdk/tsconfig.tools-dts.json:15-16` | include `src/compaction.ts` AND `src/internal/runtime/compression/**/*` | BOTH PRESENT (lines 15 and 16) — mirrors the `concurrency`+`internal/runtime/concurrency/**/*` pairing (`:17-18`) and `retry`+`internal/runtime/retry/**/*` (`:19-20`) |
| `packages/sdk/scripts/mirror-dts-to-cts.mjs:34` | `compaction.d.ts` in targets | PRESENT — `join(DIST, "compaction.d.ts")` alongside `retry.d.ts` (`:42`) and `concurrency.d.ts` (`:41`) |

Cross-check against the exact `retry`/`concurrency` pattern: identical in all 4 files. The wiring is a faithful copy of the proven tsc-DTS-reaching-internal/runtime convention.

### Build emits dist/compaction.{js,cjs,d.ts,d.cts}

Fresh `pnpm --filter @theokit/sdk build` emitted all four:
- `dist/compaction.js` (2221 B, ESM), `dist/compaction.cjs` (2379 B, CJS)
- `dist/compaction.d.ts` (2555 B), `dist/compaction.d.cts` (2555 B) — byte-identical (the cts mirror copied the d.ts as designed)

### attw resolution

`@theokit/sdk/compaction`: node16 (from CJS) 🟢, node16 (from ESM) 🟢, bundler 🟢, node10 💀. The node10 failure is the documented pre-existing baseline — EVERY subpath fails node10 (cron, errors, messages, path-safety, concurrency, retry, compaction all identical). Not a defect introduced by this feature.

### dep-cruiser

`pnpm run quality:depcruise` → "no dependency violations found (416 modules, 814 dependencies cruised)". `compaction.ts` NOT flagged as orphan — it has real value edges (`selectCompressionWindow` from `compression-helpers.js`, `TheokitAgentError` from `errors.js`). No `.dependency-cruiser.cjs` exclusion needed (correctly, none was added — unlike `messages.ts` which is type-only).

### Public exports reachable + integration test exercises them (no-orphan public-primitive exception)

`src/compaction.ts` exports: `CHECKPOINT_MARKER`, `CompactTranscriptOptions`, `compactTranscript`, `buildCheckpoint`, `filterFromLatestCheckpoint`, `isContextOverflowError`, and re-exports type `CompressibleMessage`. All reachable via the `./compaction` subpath.

`tests/compaction-wiring.test.ts` EXERCISES (not just imports) every symbol in the Act phase:
- `filterFromLatestCheckpoint(transcript)` called + asserted (`:33`)
- `compactTranscript(...)` called with a fake summarizer (delegation path) + asserted (`:36-42`)
- `buildCheckpoint("after-setup")` called inside the transcript (`:27`)
- `isContextOverflowError(...)` called on a real `TheokitAgentError` for both true and false cases (`:45-50`)
- `test_subpath_declared_in_package_json` asserts `pkg.exports["./compaction"]` defined (`:53-59`)

21/21 tests pass (19 unit in `compaction.test.ts` + 2 wiring). Matches the plan's Final-Phase acceptance (21/21).

### Reuse is real (DRY, not fabricated)

`selectCompressionWindow<M>(messages, preserveLast=6)` (`compression-helpers.ts:27`) returns `{toCompress, toPreserve}` — exactly the shape `compaction.ts:46` destructures. `CompressibleMessage` (`compression-summarizer.ts:27`) is `{role, content}` — the type compaction adopts and re-exports. No second window algorithm was written.

### Runtime metric — N/A (pure helpers)

Plan Global DoD § Runtime-metric proof explicitly declares N/A: "pure helpers, consistent with the M0/retry/messages primitives". The compaction module performs no I/O (checkpoint/overflow are pure; compactTranscript delegates summarization to a caller callback). The retry/messages/concurrency primitives set the precedent: subpath helper primitives declare no runtime metric. Correctly N/A, not a gamed pillar (c).

### Quality gates

- `pnpm --filter @theokit/sdk typecheck` → exit 0
- `pnpm quality:dead` (knip) → exit 0, zero findings for compaction symbols
- `pnpm run quality:depcruise` → 0 violations

## Note (INFO only — no action)

## [INFO] CHECKPOINT_MARKER uses NUL-guarded sentinel (matches risk mitigation)
- file: packages/sdk/src/compaction.ts:24
- detail: The marker is `"\0theokit:checkpoint\0 "` (NUL bytes, not spaces — the Read tool renders NUL as a space). Source and dist agree byte-for-byte (verified via `od -c`). This is the plan's documented collision mitigation ("a unicode-guarded token unlikely in prose") from the Drawbacks & Risks table. Correct and intentional — no action.
- fix: none

## Findings count

- BLOCKER: 0
- HIGH: 0
- MEDIUM: 0
- LOW: 0
- INFO: 1
