# Release @theokit/sdk@2.15.1

**Date:** 2026-07-01
**Verdict:** RELEASED
**Mechanism:** changesets (npm publish) — NOT the generic semver develop→main PR flow (this SDK ships via changesets; tags are `@theokit/sdk@X.Y.Z`, published to npm).
**Source review:** `.claude/knowledge-base/reviews/request-scoped-matching-review-2026-07-01.md` (READY_TO_MERGE)
**Bump:** patch (`2.15.0` → `2.15.1`) — a false-positive fix, no new public API surface.
**Release commit:** `43a7b2a` (`chore(release): @theokit/sdk@2.15.1`) on `develop`.
**Tag:** `@theokit/sdk@2.15.1` (annotated, pushed).
**npm:** published + verified (`npm view @theokit/sdk@2.15.1` → 2.15.1; published as `usetheodev` with `--provenance=false`; token written to `~/.npmrc` for the publish and removed immediately after).

## What shipped

**Request-scoped tool-name matching (R5)** for the leaked-dialect recovery:
- `extractHermesToolCalls` (`internal/llm/hermes-tool-extract.ts`) gains an optional `allowedToolNames?: ReadonlySet<string>` gate — a leaked `<function=NAME>` block is promoted only when `NAME` is a tool declared in the current request (exact, case-sensitive). `undefined` → recover-all (back-compat); empty set → recover nothing. EC-5: the residual strips ONLY promoted blocks, so a gated-out block keeps its text visible.
- `OpenAIStreamAccumulator` (`internal/llm/openai.ts`) builds `new Set(request.tools?.map(t => t.name) ?? [])` at `stream()` and threads it to `finish()`'s recovery. The `extractToolCallsFromContent` route flag stays the coarse enable; the allowlist is the within-route false-positive guard.
- Observability: `HermesExtractResult.droppedNames` + a stderr line when the guard drops a leaked block for an undeclared tool.
- No public API change (the allowlist is derived from `request.tools` the consumer already passes). Mirrors openclaw `@openclaw/tool-call-repair`.

## Cycle provenance

Full CYCLE (discover 89.0 → plan 94.8 → implement TDD T1.1/T2.1 → code-quality → review 4-agent → READY_TO_MERGE). Review caught 2 MEDIUM test gaps (exact-match / case-sensitive boundary) + 1 MEDIUM drop-path observability + 3 LOW — all fixed. Commits `bec2077 → 17f2617` (feature) + `43a7b2a` (release).

## Gate evidence

`pnpm validate` green: @theokit/sdk 3076 passed / 36 skipped, publint + attw + knip + depcruise (439 modules, 0 violations) + loc + duplication + bundle-budget all pass.

## Notes

- One earlier full-validate run flaked on `tests/telemetry/agent-send-parent-span.test.ts` — the pre-existing native-binding parallel-contention flakiness documented at `.githooks/pre-push:11` (fixture-mode, code-path-isolated from R5). Clean re-run: 0 failed. Not R5-caused; not a new issue (documented known gap).
