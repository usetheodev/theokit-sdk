# Changelog

All notable changes to `@theokit/sdk-cache` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
