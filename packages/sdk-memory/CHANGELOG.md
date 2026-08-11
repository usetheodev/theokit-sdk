# Changelog — @theokit/sdk-memory

## 0.3.1

### Patch Changes

- 8790f70: Refuse a `workspace:` range before it can reach npm.

  Five of this repo's twelve publishable packages declare internal dependencies as `workspace:^`, which
  is correct on disk and becomes an unrecoverable defect if the publish goes out through a tool that
  does not rewrite it: `pnpm` resolves the protocol while packing, `npm` ships the manifest verbatim.
  A version published that way fails to install for everyone and cannot be corrected — only
  deprecated.

  Every publishable package now runs the guard in `prepublishOnly`, so it fires whichever way the
  publish is invoked, and `pnpm release` runs it once across the repo before `changeset publish`.

  Note for anyone reading a published manifest: the `prepublishOnly` entry points at a path inside
  this repository. It never runs for a consumer — the hook only fires when the package itself is
  published — and guarding the entry point that a hand-run `npm publish` actually uses was worth the
  cosmetic wart of shipping the line.

## 0.3.0

### Minor Changes

- a4a9920: `@theokit/sdk-memory` now uses the SDK's embedding runtime instead of its own copy (theokit#160).

  The two packages each carried a full copy of `createOpenAiCompatibleRuntime`, and the satellite's
  catalog replaces the SDK's at runtime when installed — so the copy that ran was not the copy most
  people read. That duplication is what produced the two-month adapter gap fixed in theokit#128, and
  every fix since had to be applied to both files by hand.

  There is now one implementation, imported from `@theokit/sdk/internal/memory-adapters` — a
  semver-exempt sub-path in the same family as `internal/persistence` and `internal/security`, which
  exist for exactly this reason.

  **Behaviour change for `@theokit/sdk-memory` consumers:** embedding batches now run with bounded
  parallelism instead of serially, and the embedding cache is process-wide instead of per-adapter.
  Both are what the SDK already did; the satellite had silently missed both improvements.

- 0308f9f: `@theokit/sdk-memory` now serves every embedding provider the SDK advertises (theokit#128).

  `azure-openai`, `cohere`, `jina` and `gemini` landed in the SDK core catalog in June 2026 and the
  satellite never picked them up. That was not cosmetic drift: when `@theokit/sdk-memory` is
  installed, its catalog _replaces_ core's in the routing path, while `Theokit.inspect.embeddingAdapters()`
  kept listing all ten — so asking for one of the four got an "unknown provider" error from a provider
  the SDK itself had just advertised. A cross-package test now fails the build if core ever advertises
  a provider the peer cannot serve.

  Also fixes the Azure OpenAI endpoint in both packages. Azure addresses the deployment in the URL
  path (`/openai/deployments/{deployment}/embeddings`), and the placeholder was never substituted —
  every Azure embedding request went to a URL containing the literal text `{model}` and could only 404. Providers with a static path are unaffected.

- 0bd082f: Three advertised embedding providers now actually work (theokit#159).

  `azure-openai`, `cohere` and `gemini` were in the catalog and rejected on every call. The shared
  runtime spoke exactly one wire — `Authorization: Bearer`, a `{ model, input }` body, a
  `{ data: [{ embedding }] }` response — and none of the three speak it:

  - **Azure** authenticates an API key with the `api-key` header (`Bearer` carries an Entra ID token,
    not the key from `AZURE_OPENAI_API_KEY`), and the deployment is already in the URL path, so
    `model` does not belong in the body.
  - **Cohere**'s `/v2/embed` names the payload `texts`, requires `input_type`, and answers
    `{ embeddings: { float } }`.
  - **Gemini**'s OpenAI-compatible surface is at `/v1beta/openai/embeddings`, not `/v1/embeddings`.

  The runtime gained three optional per-provider hooks — auth headers, request body, response reader —
  whose defaults are exactly the previous behaviour, so the seven providers that were already correct
  are untouched. Each divergence is asserted by a test that records the real request.

  Advertising a provider that cannot work is worse than not advertising it; that is what this closes.

## 0.2.2

### Patch Changes

- 453ad2d: SE43 — system-design audit fixes (public-surface changes).

  - **`@theokit/sdk` (minor):** the shared persistence kernel is now reachable from the sanctioned public `@theokit/sdk/persistence` barrel — `withCwdMutex`, `sanitizeFts5Query`, and `PersistenceSchema` are added (joining `replaceFileAtomic` / `openSqliteResilient` / `atomicWriteText` / `atomicWriteJson`). The `@theokit/sdk/internal/persistence` export is now **deprecated**: it re-exports its full surface unchanged for one release (back-compat) and is scheduled for removal in a future major. No breaking change; existing imports keep working.
  - **Satellites (patch):** `sdk-tools` / `sdk-memory` / `sdk-cache` / `sdk-handoff` / `sdk-budget` tightened their `@theokit/sdk` peer-range floor from `>=1.7.0` to `>=4.0.0`, matching the v4-only surfaces they import (prevents a non-workspace install resolving an incompatible old sdk).

## 0.2.1

### Patch Changes

- 826bca0: Security (#56) — close two residual cross-tenant active-recall cache leaks found by adversarial review.

  - `@theokit/sdk-memory` (publishable) called `cache.get`/`cache.set` with no tenant context, so two callers with the same query text but different identity shared a cached recall — a cross-tenant leak for every consumer of the package. The cache read/write are now keyed by the `{namespace, userId, scope}` tenant tuple (the primitive already supported it).
  - In `@theokit/sdk` the production caller hardcoded `namespace: "default"` and dropped `memoryContext.tenantId`, so two tenants sharing a `userId` collided on one cache entry. The caller now threads `memoryContext.tenantId` into the tenant partition (`namespace`). `sessionId` is intentionally not a key dimension — recall is cross-session by design.

## 0.2.0

### Minor Changes

- 809418a: M4-3 — typed categorized memory store (plan `m4-categorized-memory`).

  - `createCategorizedMemory({ root, categories })` — a typed, category-partitioned markdown memory store. `add(category, text)` validates `category` against the closed `categories` taxonomy (fail-loud `ConfigurationError(code: "unknown_category")` before any I/O), redacts secrets, and appends a bullet to `<root>/<category>.md` (frontmatter header + `## Facts`) atomically and serialized per category file (`withCwdMutex` — no lost update under concurrent adds). `list(category?)` returns `CategorizedFact[]` for one category or all; never throws (a missing file → no facts). Construction validates the taxonomy is non-empty, unique, sanitizable, and sanitized-unique.
  - `MemoryFact` gains an optional `category?: string` (backward-compatible — flat-store facts omit it).

  Composes the shipped `safePathJoin`/`sanitizeIdentifier` (`@theokit/sdk/path-safety`), `redactSecrets`, and `replaceFileAtomic`/`withCwdMutex` (`@theokit/sdk/internal/persistence`). Zero new dependencies — explicitly NOT adding `zod` (the closed `categories` set is the runtime-checked schema).

## [Unreleased]

### Changed

- Reorganized the flat 43-file `src/internal/` god folder into 5 sub-concern folders (arch-review M5): `embedding/` (10), `index/` (12), `active-memory/` (5), `dreaming/` (3), `store/` (7); 6 cross-cutting files (`adapter-catalog`, `adapter-http-error`, `circuit-breaker`, `memory-scope`, `memory-types`, `tools`) remain at the `internal/` root. Pure file moves + import-path updates — no behavior/API change (the package barrel `index.ts` re-exports identically); all 324 tests GREEN, `madge --circular` clean.

### Security (drift sync — iter 112/114/115, 2026-06-09)

Three security/perf hardenings shipped in `@theokit/sdk`'s
`internal/memory/` copies AFTER Stage 3 source-move completed
(iter 44-75) were silently absent from `@theokit/sdk-memory`'s
hybrid copies. Per ADR 0002 Stage 4 byte-equivalence invariant,
they have now been synced. Consumers routing through
`@theokit/sdk-memory` get the hardened behavior. The drift detector
(iter 93) caught each gap and flipped to PASS after the sync.

- **T4.9 — cross-tenant cache-key collision (iter 112)** —
  `active-memory-cache.ts`'s `cacheKey` now accepts an optional
  `TenantContext` (`namespace`/`userId`/`scope`) and NUL-separates
  every key part. Pre-sync, two users sharing a process with the
  same query could receive each other's cached result (DR4 finding
  #9 — CRITICAL cross-tenant data leak).

- **T4.6 — dreaming O(N²) sweep cap (iter 114)** —
  `dreaming-phases.ts`'s `remPhase` accepts an optional
  `maxFactsPerSweep` (default 500) and deterministically
  subsamples when input exceeds the cap. Pre-sync, a 5000-fact
  sweep ran 12.5M cosine-similarity comparisons (unacceptable).

- **T5.2 — Lance SQL escape hardening (iter 115)** —
  `lance-index.ts`'s `escapeSqlValue` now rejects NUL bytes,
  C0 control chars, and DEL via `ConfigurationError({code:
'sql_injection_blocked'})`, and escapes backslashes (`\` →
  `\\`) in addition to single quotes. Pre-sync, only `'` → `''`
  was applied — `\'` could escape the closing quote on engines
  that interpret backslash-escapes.

### Added (Stage 3 source-move COMPLETE — iter 44-75, 2026-06-08 → 2026-06-09)

38/38 source files from sdk-core's `internal/memory/*` now have
canonical hybrid copies in this package. sdk-core retains its copies
for v1.x back-compat; consumers installing this package get the
canonical surface that sdk-core's Stage 4 routing delegates to.

**Closed clusters:**

- Dreaming (iter 54+59+60): `dreaming-phases.ts`, `dreaming-diary.ts`,
  `dreaming-run.ts` + `active-memory-types.ts` (iter 48)
- Sessions (iter 61+62): `session-summary-writer.ts`, `session-loader.ts`
- Storage (iter 53+55-58+62): `markdown-store.ts`, `chunk-markdown.ts`,
  `reader.ts`, `transcript-store.ts`, `wiki-loader.ts`
- Index (iter 47+49-50+65-72): `index-manager-contract.ts`,
  `index-schema.ts`, `memory-index.ts`, `index-db.ts`,
  `sqlite-vec-loader.ts`, `vec-index.ts`, `lance-index.ts`,
  `lance-memory-adapter.ts`, `index-manager-dispatch.ts`,
  `index-manager.ts`
- Migration (iter 63+71): `migration.ts`, `migrate-sqlite-to-lance.ts`
- Adapters (iter 45+46+73+74): `embedding-adapter.ts`,
  `embedding-cache.ts`, `openai-compatible.ts` + inlined
  `adapter-http-error.ts` + 6 provider adapters
  (openai/mistral/openrouter/voyage/deepinfra/ollama) +
  `adapter-catalog.ts`
- Core (iter 44+51+52+64+75): `circuit-breaker.ts`,
  `active-memory-cache.ts`, `memory-types.ts`, `tools.ts`,
  `active-memory.ts`

**Optional peers** (sdk-memory dynamically loads when present):

- `better-sqlite3` (iter 65)
- `sqlite-vec` (iter 66)
- `@lancedb/lancedb` (iter 68)

**287 GREEN tests** across 38 files document every move's behavior;
**zero unexpected drift** between sdk-core and sdk-memory copies
(verified by the Stage 3 drift detector, iter 93).

### Added (Phase 1 Stage 3 prep — iter 33-35, 2026-06-08)

- `createInMemoryMarkdownProvider.recordSessionSummary` ships REAL
  filesystem-backed impl (was no-op). Writes
  `${cwd}/.theokit/memory/sessions/${sanitizeRunId(runId)}.md` via
  `replaceFileAtomic` imported from `@theokit/sdk/internal/persistence`
  (ADR-008 sub-path resolution). Mirrors sdk-core's legacy
  `writeSessionSummary` semantics — YAML frontmatter + User/Assistant
  sections, 2000-char truncation, runId sanitization.
- `runActivePass()` now reads previously-written session summaries
  from disk + substring-matches against the user message — closes
  the "write but never read" gap. In-process Map facts AND disk-recall
  hits both contribute to `systemPromptAdditions`. Capped at 5 hits
  per pass.
- NEW LLM-facing tool: `memory_search(query)` — surfaced in
  `buildTools` alongside `memory_remember`. The LLM can explicitly
  query the disk sessions corpus when the user references past
  conversations. Returns JSON `{ok, count, results: [{id, snippet}]}`.

### Changed (Phase 1 physical Stage 1 — iter 19, 2026-06-08)

- `createInMemoryMarkdownProvider` now implements the new optional
  `sync(handle)` port method (no-op for the in-process impl — facts
  are written synchronously to the Map at handler-call time; nothing
  to re-index post-run). Future LanceDB-backed impl will fire
  `IndexManager.sync()` here. Back-compat preserved: existing impls
  that omit `sync` are still valid per the optional-method spec.

## [0.1.0] — 2026-06-08

### Added

- Initial release. Consumes the `MemoryProvider` port from `@theokit/sdk@>=1.7.0`
  (SDK 2.0 Phase 1 / T1.6).
- `createInMemoryMarkdownProvider()` — first concrete impl. In-process
  fact store; LLM-facing `memory_remember` tool; `runActivePass()` emits
  `systemPromptAdditions` for recalled facts; full lifecycle compliance.

### Notes

- LanceDB / embeddings / circuit-breaker / dreaming-sweep deferred to future
  versions. This release ships the package foundation + a working impl so
  the SDK 2.0 cohort can publish (Phase 7).
- `peerDependency`: `@theokit/sdk >= 1.7.0` (where the port was shipped).
