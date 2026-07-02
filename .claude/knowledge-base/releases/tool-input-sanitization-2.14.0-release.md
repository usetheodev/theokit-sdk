# Release @theokit/sdk@2.14.0

**Date:** 2026-07-01
**Verdict:** RELEASED
**Mechanism:** changesets (npm publish) — NOT the generic semver develop→main PR flow (this SDK ships via changesets; tags are `@theokit/sdk@X.Y.Z`, published to npm).
**Source review:** `.claude/knowledge-base/reviews/tool-input-sanitization-review-2026-07-01.md` (READY_TO_MERGE)
**Bump:** minor (`2.13.1` → `2.14.0`) — new public API surface.
**Release commit:** `7cd73c4` (`chore(release): @theokit/sdk@2.14.0`) on `develop`.
**Tag:** `@theokit/sdk@2.14.0` (annotated, pushed).
**npm:** published + verified (`npm view @theokit/sdk@2.14.0` → 2.14.0, dist-tags.latest 2.14.0; `./sanitize` subpath present in the published `exports`).

## What shipped

Public, isolated tool-input **sanitization** system:
- `@theokit/sdk/sanitize` — `sanitizeToolInput(input, options?)` (trim default; coerce/repairJson opt-in; schema-aware; deep bounded; total contract — never throws; guarded against silent numeric/ID corruption).
- `defineTool({ sanitize })` — declarative opt-in; sanitizes raw model args before `inputSchema.parse`.
- Internal leaked-dialect recovery (`hermes-tool-extract`) reuses the same primitive (DRY).
- New dep: `jsonrepair ^3.13.2` (lazy-loaded, opt-in behind `repairJson`).

## Cycle provenance

Full CYCLE (discover→plan→implement→code-quality→review→release), all gates:
- Discover blueprint SHIPPABLE 98.0 · Plan SHIPPABLE_WITH_CAVEATS 86 (hard_caps cleared) · deps-audit PASS.
- Implement: 5 TDD tasks; suite 3020 passed / 36 skipped; `pnpm validate` (Tier 1) exit 0.
- Review READY_TO_MERGE (5 specialist agents + correctness re-review). One real HIGH bug (repair clobbers schema-confirmed string) found, fixed (`86facc8`), re-reviewed FINDING_1_RESOLVED_CLEAN.

## Deferred (by ADR)

Blueprint R5 (request-scoped tool-name matching), R6 (doom-loop no-progress guard), R7 (stream-boundary normalization) — follow-up cycles.

## Release notes

See `packages/sdk/CHANGELOG.md § 2.14.0` and the root `CHANGELOG.md § [Unreleased] Added`.
