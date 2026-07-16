# Changelog

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
