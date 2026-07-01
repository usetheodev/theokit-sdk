# Implementation summary — tool-input-sanitization

Plan: `.claude/knowledge-base/plans/tool-input-sanitization-plan.md` (SHIPPABLE_WITH_CAVEATS 86)
Blueprint: `.claude/knowledge-base/discoveries/blueprints/tool-calling-robustness-blueprint.md` (SHIPPABLE 98.0)
Verdict: **IMPLEMENTATION_COMPLETE** · 2026-07-01 · branch `develop`

## Commits (TDD, atomic per task)

| Task | Commit | What |
|---|---|---|
| T1.1 | `6ee4217` | `sanitizeToolInput` primitive (`src/sanitize/{sanitize-tool-input,coerce,types,index}.ts`) — 27 TDD cases; adds `jsonrepair ^3.13.2` (lazy) |
| T1.2 | `df266b8` | `@theokit/sdk/sanitize` subpath (tsup entry + tsconfig.tools-dts + package.json exports + mirror-dts) — publint/attw green |
| T2.1 | `026be71` | `defineTool({ sanitize })` opt-in — 4 TDD cases; existing defineTool suite unchanged |
| T3.1 | `e357214` | internal DRY: `parseHermesParams` delegates trim to the primitive — 13 cases (incl. P0 regressions + EC-7) |
| T4.1 | `4bc6306` | end-to-end integration test + `docs.md` public surface |

## Wiring triad

- **Caller**: `defineTool({ sanitize })` (`src/define-tool.ts`) + internal `parseHermesParams` (`src/internal/llm/hermes-tool-extract.ts`) both call `sanitizeToolInput` at runtime; public via the `@theokit/sdk/sanitize` subpath barrel.
- **Integration test**: `tests/sanitize/integration.test.ts` (end-to-end defineTool→handler with coercion) + `subpath-export.test.ts` (barrel contract).
- **Observability**: `SanitizeResult.notes` records a line per change (logging/debug seam).

## EC guards implemented (from `/edge-case-plan`)

- EC-1 non-object input → returned as-is, never throws (total contract).
- EC-2 numeric coercion round-trip + finite guard → ID-like / leading-zero / NaN/Infinity strings stay strings (no silent corruption).
- EC-3 `repairJson` only on `{`/`[`-looking values → plaintext never mangled.
- EC-4 schema-aware coercion only for `z.object` → union/record/effects fall back safely.
- EC-5/6/7 whitespace-only trim, bounded deep recursion, key-trim delegation.

## Gate evidence

- `tests/sanitize/**`: **35 passed** (27 + 2 + 4 + 2).
- Full SDK suite: **3010 passed | 36 skipped (3046)**, exit 0 — no regression.
- `typecheck`: clean. `biome`: clean. `wc -l sanitize-tool-input.ts` = 101 (< 120).
- `pnpm build` emits `dist/sanitize/index.{js,cjs,d.ts,d.cts}`. `publint`: All good. `attw`: No problems 🌟 (sanitize subpath validated).
- `docs.md` documents `@theokit/sdk/sanitize` + `defineTool({ sanitize })`; `.changeset/tool-input-sanitization.md` (minor).

## Deferred (by ADR — out of scope, follow-up plans)

Blueprint R5 (request-scoped tool-name matching), R6 (doom-loop no-progress guard), R7 (stream-boundary normalization) — harden the internal recovery, not the public sanitizer. Tracked for follow-up cycles.
