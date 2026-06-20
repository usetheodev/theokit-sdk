# Architecture review — M2-1 `@theokit/sdk/compaction`

Scope: `packages/sdk/src/compaction.ts`, `packages/sdk/tests/compaction*.test.ts`, and the subpath wiring
(`package.json`, `tsup.config.ts`, `tsconfig.tools-dts.json`, `scripts/mirror-dts-to-cts.mjs`).
Reviewed against `.claude/rules/architecture.md` and the plan ADRs D1-D5.

## [MEDIUM] Checkpoint markers leak through compactTranscript (plan pseudo-code drift)
- file: packages/sdk/src/compaction.ts:44
- detail: `compactTranscript` filters `m.role === "system"` into the always-preserved `system`
  array. `buildCheckpoint` (line 58-60) produces a `role: "system"` turn. Therefore any checkpoint
  marker turn embedded in a transcript is classified as system and survives compaction verbatim —
  growing the compacted output with sentinel turns. The plan's T1.2 pseudo-code explicitly guarded
  against this: `system = messages.filter(m => m.role === "system" && !content.startsWith(CHECKPOINT_MARKER))`.
  The implementation dropped the `!startsWith(CHECKPOINT_MARKER)` guard. No test covers the
  combined checkpoint+compact path: `test_compactTranscript_preserves_system` only asserts `out[0]`,
  and the wiring test asserts SUMMARY presence + first/last turns but never asserts marker absence.
  This is design-consistency drift from the locked plan, not a documented-surface correctness blocker
  (the two helpers are independently documented), so MEDIUM rather than HIGH.
- fix: Either (a) restore the plan's guard so checkpoint markers are NOT treated as preservable
  system turns and are dropped/summarized with the older window, plus add a regression test
  (`compactTranscript` over a transcript containing a `buildCheckpoint()` turn asserts the marker is
  absent from the older-dropped output); or (b) if the intended behavior is to preserve markers,
  amend ADR D1/D2 + docs.md to state that markers survive compaction, and add the asserting test.
  Pick one and make plan, code, and a test agree.

## [LOW] keepRecent has no lower-bound guard (negative/zero passthrough to slice)
- file: packages/sdk/src/compaction.ts:43
- detail: `keepRecent` is forwarded to `selectCompressionWindow(nonSystem, keepRecent)`. A caller
  passing `keepRecent: 0` makes `messages.slice(-0)` return the whole array (so toCompress becomes
  empty → no-op), and a negative value makes `slice(0, -(-n))` / `slice(n)` behave surprisingly.
  The plan does not promise validation and the default (6) is safe, so this is advisory — but a public
  primitive accepting arbitrary numbers should fail fast on invalid input per the project's
  fail-fast error-handling rule rather than silently no-op.
- fix: Optionally clamp/validate `keepRecent` (e.g. throw a `ConfigurationError` when `keepRecent < 0`,
  or `Math.max(0, keepRecent)`), and document the boundary. Low priority; not blocking.

## [INFO] DIP boundary is correct — reaches only the allowed internal/runtime/compression
- file: packages/sdk/src/compaction.ts:14-16
- detail: Imports are exactly: `TheokitAgentError` from the public `./errors.js` root; `selectCompressionWindow`
  (value) from `./internal/runtime/compression/compression-helpers.js`; `CompressibleMessage` (type)
  from `./internal/runtime/compression/compression-summarizer.js`. This is the same allowed public→
  internal/runtime reach that `retry.ts` and `concurrency.ts` already have (architecture.md §2 — adapters
  reuse, no cross-feature deep reach). No import escapes into other internals (no error-mappers, no agent
  loop, no persistence). Boundary verdict: clean.

## [INFO] DRY claim holds — selectCompressionWindow reused, no duplicate window algorithm
- file: packages/sdk/src/compaction.ts:46
- detail: Verified via grep: `selectCompressionWindow` is imported (line 15) and called (line 46);
  there is no re-implemented slice/keep-recent algorithm in compaction.ts. `compression-helpers.ts:27`
  is the single authoritative split (`toCompress`/`toPreserve`, `preserveLast=6`), and compaction's
  default `keepRecent ?? 6` matches it. DRY (Unbreakable Rule 9 / plan ADR D1) satisfied.

## [INFO] Design-pattern choice correct — plain functions over a strategy hierarchy (KISS/YAGNI)
- file: packages/sdk/src/compaction.ts:39,58,66,81
- detail: Per ADR D4, the surface is five free functions + one re-exported type on a dedicated subpath,
  matching the SDK's `withRetry`/`mapWithConcurrency` convention rather than adk-js's class hierarchy.
  No invented pattern, no premature abstraction (no interface with a single implementer), no
  speculative extension point. SRP holds: each function has one reason to change; the module answers
  one question ("public compaction/context helpers"). KISS/YAGNI respected.

## [INFO] LSP respected in isContextOverflowError + subclass test
- file: packages/sdk/src/compaction.ts:81
- detail: `isContextOverflowError` checks `err instanceof TheokitAgentError`, so any subclass
  (verified: `RateLimitError extends TheokitAgentError`, errors.ts:189) carrying `code:"context_too_long"`
  is detected. The predicate reads both `.code` and `.metadata?.code` (ADR D3 dual-field) with no
  message regex. `test_isContextOverflowError_true_on_subclass` exercises exactly this substitutability.
  Sound.

## [INFO] Subpath wiring mirrors retry/concurrency across all four config files
- file: packages/sdk/package.json (./compaction), packages/sdk/tsup.config.ts:11, packages/sdk/tsconfig.tools-dts.json:15-16, packages/sdk/scripts/mirror-dts-to-cts.mjs:34
- detail: `./compaction` exports block is byte-identical in shape to `./retry` (dual import/require,
  `.d.ts`/`.d.cts`); tsup entry `compaction: "src/compaction.ts"`; tools-dts include adds both
  `src/compaction.ts` and `src/internal/runtime/compression/**/*` (the tsc-cycle-exception path, correct
  because compaction has a VALUE import from internal/runtime — same rationale as retry/concurrency);
  mirror script adds `compaction.d.ts`. ADR D5 implemented faithfully. Module hygiene clean: kebab-case
  file, PascalCase types, camelCase functions, UPPER-ish const, no `any`, no `console.log`, ES modules only.

## [INFO] Module cohesion + no orphan risk
- file: packages/sdk/src/compaction.ts
- detail: compaction.ts has real value edges (imports + a runtime caller via the integration test and
  the documented public surface), so the dep-cruiser `no-orphans` exclusion that the type-only `messages.ts`
  needed does NOT apply here — consistent with the plan's Baseline Context analysis. The integration test
  (`compaction-wiring.test.ts`) plus docs.md provide the public-primitive reachability that
  `no-stubs-no-mocks-no-wired.md` requires.
