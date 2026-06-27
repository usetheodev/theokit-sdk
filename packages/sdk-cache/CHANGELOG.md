# Changelog

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
