# Wiring Review — m1-sdkmessage-readers

review_target: M1-5 `@theokit/sdk/messages` subpath wiring triad + subpath integrity
plan: .claude/knowledge-base/plans/m1-sdkmessage-readers-plan.md (ADR D4)
verdict: WIRING COMPLETE — no BLOCKER/HIGH/MEDIUM findings. 1 INFO.

## Summary

The wiring triad and 4-file subpath integrity are fully and correctly implemented,
matching the `path-safety` leaf-subpath pattern exactly. Build emits all four
`dist/messages.{js,cjs,d.ts,d.cts}` artifacts; the cts mirror (the known
highest-risk file) is present, byte-identical to the d.ts, and resolves cleanly
under attw. All 15 tests (13 unit + 2 wiring) pass green.

### 4-file subpath integrity (cross-checked against `path-safety`)

| File | messages | path-safety | Match |
|---|---|---|---|
| package.json `exports` | `./messages` block, import+require, types+default (`:51-60`) | `./path-safety` (`:61-70`) | EXACT |
| tsup.config.ts `entry` | `messages: "src/messages.ts"` (`:9`) | `"path-safety": "src/path-safety.ts"` (`:11`) | EXACT (both EXCLUDED from rollup `dts.entry` — correct) |
| tsconfig.tools-dts.json `include` | `"src/messages.ts"` (`:13`) | `"src/path-safety.ts"` (`:14`) | EXACT |
| mirror-dts-to-cts.mjs `targets` | `join(DIST, "messages.d.ts")` (`:32`) | `join(DIST, "path-safety.d.ts")` (`:34`) | EXACT |

### Triad confirmation

- (a) Public exports `assistantText` / `extractToolUses` / `costAmountUsd` are
  reachable via the `@theokit/sdk/messages` subpath — the consumer surface itself
  (no-orphan public-primitive exception applies, same as `path-safety` / `withRetry`).
  No main-barrel export, per ADR D4 (verified absent in `src/index.ts`).
- (b) Integration test `tests/messages-readers-wiring.test.ts` EXERCISES all three
  symbols in the Act phase (not just imports): `assistantText(msg)`,
  `extractToolUses(msg).map(...)`, `costAmountUsd(c)` + the undefined-honesty path.
  Plus a subpath-declared assertion against package.json. Both tests GREEN.
- (c) Runtime metric — N/A (declared so in plan Final Phase). Pure in-memory readers,
  no I/O; consistent with the M0 / path-safety primitives. Correctly N/A, not gamed.

### Build + attw evidence

- `dist/messages.js`, `dist/messages.cjs`, `dist/messages.d.ts`, `dist/messages.d.cts`
  all present and fresh (built 15:39-15:40, after src mtime).
- `dist/messages.d.cts` is byte-identical to `dist/messages.d.ts` (`diff` clean) and
  contains `export declare function` for all three readers.
- attw `@theokit/sdk/messages`: node16(CJS) GREEN, node16(ESM) GREEN, bundler GREEN.
  No "Masquerading as ESM" warning — the cts mirror does its job.

## [INFO] node10 resolution fails for `@theokit/sdk/messages` — pre-existing project-wide baseline
- file: packages/sdk/package.json:51
- detail: attw reports `node10: Resolution failed` for `@theokit/sdk/messages`. This is NOT a messages-specific defect — the legacy non-`exports`-aware node10 resolver fails identically for EVERY subpath in the package (`./errors`, `./path-safety`, `./cron`, etc.). The three resolution modes that matter for a 2026 dual-format package (node16 CJS, node16 ESM, bundler) are all GREEN. `messages` matches the established baseline exactly.
- fix: None required. If the project ever wants node10 support across subpaths, that is a package-wide decision (add top-level `typesVersions` or per-subpath fallbacks) unrelated to this feature. Not a blocker for M1-5.
