# V2-3 — Theo Harness Capability Map: discovery blueprint

**Date:** 2026-06-23 · **Slug:** v2-3-harness-capability-map · **Repo:** theokit-sdk (develop)

## Objective
Make the harness capabilities DISCOVERABLE: a single navigable doc mapping every harness primitive to its real import-path + signature + 1 example, plus promote the highest-value sealed `@internal` cluster to a STABLE public subpath.

## Reality (grounded inventory — live `node` import of every public subpath)

The GAP_AUDIT (§2, 53 rows) was a SNAPSHOT. After V1 (M0–M8) + V2-2, the actual status of the 53 primitives is:
- **~25 already PUBLIC** in `@theokit/sdk` (21 subpaths) + `@theokit/sdk-tools` (single `.`). Verified by live import. E.g. `compactTranscript`/`buildCheckpoint`/`shouldCompact`/`estimateTokens` (`@theokit/sdk/compaction`), `isTransientError` (`@theokit/sdk/errors`), `withRetry` (`@theokit/sdk/retry`), `mapWithConcurrency` (`@theokit/sdk/concurrency`), `discoverSkills` (`@theokit/sdk/skills`), `readProjectInstructions` (`@theokit/sdk/project`), `safeFilenameForId` (`@theokit/sdk/path-safety`), `resolveModelCapabilities`/`parseModelId`/`toModelOption` (`@theokit/sdk/models`), `assistantText`/`extractToolUses` (`@theokit/sdk/messages`), `provisionRepo` (`@theokit/sdk/sandbox`), `Eval`/`Scorers`/`loadJsonl` (`@theokit/sdk/eval`), `withSubagentToolScope` (`@theokit/sdk/subagents`), `buildReplayHistory` (`@theokit/sdk`), and the sdk-tools toolbox (`buildRepoMap`/`buildEnvContext`/`isBlockedIp`/`screenedFetch`/`catastrophicShellReason`/`createWebFetchTool`/etc).
- **~10 OUT-OF-REPO** — target `@theokit/ui` (sibling `theo-ui/`), `theokit`/`theokit/client` (sibling `theokit/`), `@theokit/orm`, `@theokit/sdk-memory`, `@theokit/sdk-budget`, `@theokit/agents`, `@theokit/server/cost`. The map points at their repos; out of scope to document their internals here.
- **3 NOT-SHIPPED as a public symbol** — runtime-behavior gaps with no corresponding export: `budgetTracker.nextIteration()` enforcement (#1), `agent.runToCompletion` continuation driver (#16), hook-`stop` reflection (#18). The map records these honestly as "not a standalone primitive" (the relevant public pieces — `createCounterBudgetTracker`, `buildReplayHistory` — are documented).
- **APP-BOUNDARY** — `<memories>`, OpenRouter key, logger middleware (n/a for the SDK map).
- **SEALED-INTERNAL** — the promotion target. The `@theokit/sdk/internal/persistence` cluster (`appendJsonl`, `readJsonlIds`, `loadJsonl`, `replaceFileAtomic`, `atomicWriteText`, `atomicWriteJson`, `withFileLock`, `openSqliteResilient`, `applyWalWithFallback`) is reachable ONLY via the `internal/` subpath, which `tsup.config.ts` + README label "internal API — semver-exempt." `appendJsonl`/`readJsonlIds`/`loadJsonl` carry `referencia:` provenance to theocode's `swebench-batch.ts`/`swebench-dataset.ts` (extracted FROM the consumer). This is exactly the V2-2 follow-up (V2-2E-1 / V2-2F-2): the consumer can't adopt its own contributed pattern back without coupling to a semver-exempt internal path.

## Scope decision

**Part A — Capability Map doc** (`docs/harness-capability-map.md`): the navigable inventory of every harness primitive, grouped by theme, each PUBLIC primitive with `import { X } from '@theokit/sdk/<subpath>'` + signature + a 1-line example; OUT-OF-REPO primitives with a repo pointer; NOT-SHIPPED behavior gaps noted honestly. Linked from `packages/sdk/README.md` + `packages/sdk-tools/README.md`.

**Part B — Promote the persistence cluster** to a STABLE, semver-protected public subpath `@theokit/sdk/persistence` (re-exporting the consumer-grade helpers from `internal/persistence`), with the full SDK ceremony (src barrel + tsup entry + package.json `exports` + docs.md section + subpath test + changeset + CHANGELOG). This closes V2-2E-1 / V2-2F-2: consumers (theocode) adopt `appendJsonl`/`readJsonlIds`/`replaceFileAtomic`/etc from a stable path, not `internal/`.

Out of scope (YAGNI): promoting `internal/plugins` (3rd-party plugin authoring not a goal), `internal/observability` (`*ForTests` must stay sealed). `internal/security` redaction (`redactSecrets`/`maskToken`) is noted as a future candidate but deferred (no consumer demand surfaced in V2-2).

## DoD (from ROADMAP-v2 §V2-3)
A third party finds `compactTranscript`/`buildRepoMap`/`isTransientError` (and the rest) without reading source; every documented import resolves; the map is linked from each package README; the persistence cluster is publicly importable from a stable subpath.
