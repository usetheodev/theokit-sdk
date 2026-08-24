# Changelog

## 1.0.0

### Major Changes

- 643192a: **Breaking:** `CacheEmbedderError` is removed.

  Nothing ever constructed it, so `catch (e) { if (e instanceof CacheEmbedderError) … }` was a branch
  that could not run. Every embedder failure — on `consult`, on `remember`, and on both plugin hooks —
  degrades to a cache miss or a skipped write, warns on stderr, and increments
  `CacheStats.embedderFailures`, because a cache is an optimisation and must not take the request
  down with it. That counter is how a broken embedder is detected, and the README now says so.

  Nothing to migrate: any handler for this class was already dead code.

### Minor Changes

- ad8f9b9: The `"json"` persistence backend now keeps the promise it was sold on.

  `Cache.ready()` — which the code's own comment referred to long before it existed — resolves once
  the snapshot has been read, and `consult` / `remember` await hydration themselves, so a lookup
  issued right after construction no longer races the read and misses an entry that is on disk.

  `Cache.flush()` writes the debounced snapshot and keeps every entry. Writes are debounced 200ms, so
  a once-per-invocation CLI — the process this backend exists for — used to persist nothing unless it
  happened to live longer, and `clear()` was the only public call that forced a write. Nothing
  flushes on teardown: call `flush()` before exiting.

  Two caches built with the same `dir` and `namespace` now share one store instead of each writing a
  full snapshot and erasing the other's entries. The first construction's `maxEntries` applies.

### Patch Changes

- e3f2a82: Public-API documentation reviewed file by file, and corrected wherever it disagreed
  with the code. The docblocks ship in the `.d.ts`, so these read as behaviour changes
  in an editor even though no behaviour changed.

  The corrections that change what a caller would do:

  - **`sdk-cache` documented its own premise backwards.** The header example labelled a
    semantic hit as if it avoided the provider call. `asPlugin()` returns the cached
    answer as `recalledContext`, which the agent loop injects as a `<memory-context>`
    block _before_ the prompt — the request still goes to the provider. The two modes
    are now labelled separately, with a table saying which one short-circuits and which
    one seeds.
  - **`sdk-handoff`'s five error classes said "throw".** Under the plugin wiring the
    handler never throws; every failure becomes a tool result `{"ok":false,…}` handed
    back to the model. Each class now says where it is actually observable. The header
    also told readers to `import { Handoff } from "@theokit/sdk"`, from which it was
    extracted.
  - **`sdk-budget`'s `charge()` claimed idempotency across concurrent calls.** The mutex
    serialises, it does not deduplicate: two identical calls record twice. Related, and
    newly documented: with `maxUsd` set, a model missing from the pricing table denies
    every request rather than passing it — and the table matches by exact string, so
    `"openai/gpt-4o"` does not match `"gpt-4o"`.
  - **The three `memory-*` adapters advertised an env-var fallback they do not read**,
    and their peer dependencies are required rather than optional. Their behavioural
    differences are now stated where they break the "interchangeable adapter"
    assumption — honcho ignores `k` and always throws on `delete`; mem0 recalls across
    sessions by design; supermemory ignores `sessionId` entirely.
  - **`sdk-memory`'s `truncated` flag was documented as its own inverse**, and its
    dreaming sweep claimed a mutex it never takes against the writer it names.
  - **`sdk-tools`** corrected `run_vitest`'s unreachable `no_vitest` code, `truncation`'s
    replacement-character claim, and two return shapes missing a live error code.
  - **`acp`/`cli`** corrected sixteen statements including a named error class that is
    not the one raised, a handler documented as calling `fork()` that refuses
    unconditionally, handlers described as pure that mint ids and mutate a store, a
    config loader credited to Zod in a package that does not import it, and a `--force`
    scaffold described as atomic that deletes the destination before the rename.

  Undocumented public symbols were documented across every package, with each claim
  checked against the implementation rather than inferred from the name.

- e368fc1: Every published declaration file now compiles without `skipLibCheck` (#345). The
  DTS rollup emitted symbols as a re-export from a chunk while omitting them from
  that chunk's `import`, and dropped type-only imports from external packages —
  leaving 51 unresolved references across ten of the twelve packages. Nothing broke
  at runtime, and `tsc` stayed green for anyone with `skipLibCheck` on, but a
  consumer running type-aware lint saw every type reached through one degrade to
  `error`.

  The declarations are repaired at build time from the compiler's own diagnostics.
  No source or API change.

- e699569: **The repository moved to the official `usetheokit` organization.** Every `repository`, `bugs` and `homepage` field now points there, along with the README, `CONTRIBUTING.md`, `SECURITY.md` and the issue templates. Existing clones and any URL already published keep working — GitHub redirects a transferred repository permanently — so this is a correctness fix for the metadata npm renders, not a break.

  **The Apache-2.0 text every package ships was replaced with the official one.** The copy distributed until now had paragraph 4(d) truncated: it read "except as required for describing the origin of the Work and reproducing the content of the NOTICE file", dropping "reasonable and customary use" from the licensed clause. §4(d) governs what a redistributor must do with attribution notices, and the omission narrowed it.

  That matters more than a typo would. The manifests declare the SPDX identifier `Apache-2.0`, which is an assertion that the terms are _the_ Apache-2.0 terms — a licence scanner resolves the identifier and never reads the file. A consumer's compliance review, which does read the file, would find a body that no longer matches the identifier and has no name of its own. Every `LICENSE` in this repository is now byte-identical to the canonical text, with the appendix filled in.

  Nothing else about the terms changed: the licence is the same licence it has always been meant to be, and no package changes what it grants.

- e3f2a82: `@opentelemetry/api` is now declared as an optional peer dependency, so the spans these two
  packages emit can actually reach a collector.

  Both lazily `require("@opentelemetry/api")` from their own directory, but neither manifest
  declared it in any dependency field. Under an isolated `node_modules` layout the specifier is
  therefore not linked under the package, the require throws, the loader caches a `null` tracer,
  and every span degrades to a no-op — silently, with no warning, unlike `@theokit/sdk`, which
  prints one when telemetry is enabled and OTel is absent. For `sdk-cache` that covered both of
  its main paths (`cache.lookup` on every send, `cache.store` on every reply), so an operator
  reading a trace saw no cache activity at all and had no way to tell that from a cache that was
  never consulted.

  The declaration matches `@theokit/sdk`'s: `peerDependencies` plus `peerDependenciesMeta.optional`,
  so nothing is installed for anyone who does not want OTel, and users who do want it get their
  copy linked where the require can find it.

- 8d1feaa: `PostAssistantReplyContext` now carries `usedTools`, and `@theokit/sdk-cache` stops caching
  tool-using turns in plugin mode.

  The cache's D266/EC-10 guard exists because replaying an answer produced by a `write_file` / HTTP
  POST / payment call re-serves the text without the side effect having happened. The
  `post_assistant_reply` hook had no tool signal to key on and passed a literal `false`, so the guard
  never fired on the path that runs automatically — only a hand-written `cache.remember(..., {
usedTools: true })` reached it.

  The runtime derives the flag from the run's replayed event stream. A hook handler written against
  the previous shape keeps working; code that CONSTRUCTS a `PostAssistantReplyContext` (test doubles,
  custom emitters) now has to supply the field.

- c7385d2: Test runs no longer claim every core on the host.

  None of the package configs capped `maxWorkers`, so vitest's default applied: `os.availableParallelism()`,
  one fork per core, each booting a full test environment. The repo's `test` script is
  `turbo run test --filter='./packages/*'`, so that default is paid once per package _concurrently_ —
  nproc forks times turbo's concurrency, on nproc cores. Measured on a 12-thread machine during an
  unrelated investigation, two vitest pools alone were enough to reach load average 33.89 with the
  desktop unusable; a full fan-out is several times that.

  `@theokit/sdk` is the interesting case. B-104 recorded on 2026-08-19 that the `poolOptions.forks.*`
  block was 100% dead in Vitest 4, deleted it, and noted that `fileParallelism: false` was forcing
  `maxWorkers` to 1 unconditionally, so a fork-count knob could not act. B-059 then flipped
  `fileParallelism` to `true` on 2026-08-20, which made the knob able to act again — and nothing
  reintroduced one, so the package silently went back to the uncapped default. That comment has been
  corrected along with the config; it claimed no knob existed, which is no longer true.

  The cap leaves 4 cores free (`Math.max(2, cpus().length - 4)`), scaling with the runner rather than
  hard-coding one machine's core count. It costs no wall-clock: measured in `theokit-ui`, the full
  suite ran 73.96s at 4 workers against 74.36s at 12, so the parallelism above the cap was already
  noise. Verified as resolved config rather than as file contents — `createVitest` reports
  `maxWorkers: 8` on a 12-thread host, which is the formula, not the default.

  This changes no published behaviour; it is test tooling only. Refs usetheokit/theokit-ui#51.

## 0.3.2

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

## 0.3.1

### Patch Changes

- 453ad2d: SE43 — system-design audit fixes (public-surface changes).

  - **`@theokit/sdk` (minor):** the shared persistence kernel is now reachable from the sanctioned public `@theokit/sdk/persistence` barrel — `withCwdMutex`, `sanitizeFts5Query`, and `PersistenceSchema` are added (joining `replaceFileAtomic` / `openSqliteResilient` / `atomicWriteText` / `atomicWriteJson`). The `@theokit/sdk/internal/persistence` export is now **deprecated**: it re-exports its full surface unchanged for one release (back-compat) and is scheduled for removal in a future major. No breaking change; existing imports keep working.
  - **Satellites (patch):** `sdk-tools` / `sdk-memory` / `sdk-cache` / `sdk-handoff` / `sdk-budget` tightened their `@theokit/sdk` peer-range floor from `>=1.7.0` to `>=4.0.0`, matching the v4-only surfaces they import (prevents a non-workspace install resolving an incompatible old sdk).

## 0.3.0

### Minor Changes

- 08539f0: Fix a cross-model semantic-cache false hit and add session revert (#67). (1) **Model-scoped cache:** the semantic-search path filtered eligible entries by embedder + namespace + dim + expiry but NOT `modelId`, so two models sharing an embedder could return each other's cached response; `semanticSearch` / `isEligibleForSearch` now require `modelId` equality (the composite KV key already included it). (2) **Session revert:** `ConversationStorageAdapter.truncateConversation(id, keepCount)` reverts a transcript back to its first `keepCount` messages ("undo the last turn(s)"), rewriting the JSONL atomically under the same cross-process lock as append/compaction; the FS + in-memory adapters implement it. `keepCount <= 0` empties, `keepCount >= length` is a no-op.

## 0.2.0

### Minor Changes

- ac3f77d: @theokit/sdk: resolveModelCapabilities catalog gains cheap OpenRouter slugs (qwen3-coder, deepseek v4-flash/v3.2, glm-4.7-flash, gemini-2.5-flash-lite/pro) so they resolve real context windows instead of the 4096 default. @theokit/sdk-tools: new createGenericHttpSearchAdapter (env-keyed generic HTTP WebSearchCallback alongside Brave); buildEnvContext gains git-branch detection + an injectable clock. @theokit/sdk-cache: ships createLexicalEmbedder (zero-dependency token-hash lexical embedder built-in).

All notable changes to `@theokit/sdk-cache` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

(No unreleased changes.)

## [0.1.0] — 2026-06-08

### Added

- Initial extraction from `@theokit/sdk@1.7.0` (`internal/cache/` subsystem + `cache.ts` public surface + `types/cache.ts`).
- Public API: `Cache.semantic({...})`, `cache.asPlugin()`, `cache.stats()`, `cache.clear()`.
- Errors: `CacheEmbedderError`, `CacheInvalidTtlError`.
- Stores: `InMemoryCacheStore`, `JsonFileCacheStore`.
- Telemetry: `startCacheLookupSpan`, `startCacheStoreSpan` (OTel-compatible).
- Peer-deps: `@theokit/sdk@>=1.7.0`, `zod@^3.25.0 || ^4.0.0`.

### Notes

- Cache integrates with `Agent` via the Plugin protocol — `cache.asPlugin()` returns a `Plugin` consumed by `Agent.create({ plugins })`.
- The internal API `@theokit/sdk/internal/persistence` is consumed for `atomicWriteText` + `PersistenceSchema` (semver-exempt; not part of `@theokit/sdk` public surface).
- All 7 unit tests from `packages/sdk/tests/cache/cache-create.test.ts` migrated here.
