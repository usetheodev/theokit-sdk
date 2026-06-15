# Changelog

## 0.1.1

### Patch Changes

- 461c020: Add `METADATA_KEYS.SQUAD` (`"usetheo:di:squad"`) and `METADATA_KEYS.STEP` (`"usetheo:di:step"`) — new metadata keys backing the `@Squad()` and `@Step()` decorators in `@theokit/di-agent`. Shipped as a patch (additive values on the existing exported `METADATA_KEYS`) to keep `@theokit/di-agent` and the in-progress `@theokit/orm` (prerelease `0.1.0-next.1`) inside their `^0.1.0` peer range — a `minor` (`0.2.0`) would fall outside `^0.1.x` and force both dependents to `1.0.0`.

  Also: broke the `container.ts ↔ internal/module-loader.ts` type-only cycle (arch-review ADR 0001) — `loadModule` now depends on a narrow `ModuleRegistrar` interface from the leaf `types.ts` instead of the concrete `Container`. No behavior change; `Container` satisfies it structurally.

All notable changes to `@theokit/di` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `METADATA_KEYS.SQUAD` (`"usetheo:di:squad"`) — metadata key backing the `@Squad()` decorator in `@theokit/di-agent`.
- `METADATA_KEYS.STEP` (`"usetheo:di:step"`) — metadata key backing the `@Step()` decorator in `@theokit/di-agent`.

### Changed

- Broke the `container.ts ↔ internal/module-loader.ts` type-only dependency cycle (arch-review ADR 0001). `loadModule` now takes a narrow `ModuleRegistrar` interface (just `register(...)`) from the leaf `types.ts` instead of importing the concrete `Container`. No behavior change — `Container` satisfies it structurally; all 69 tests GREEN, `madge --circular` clean.

### Changed

- **Documentation only:** expanded JSDoc header on `Container` class (`src/container.ts:87`) acknowledging auditor finding PV#10 from the 2026-06-06 architecture audit. The 812 LOC class size is above the 500 LOC heuristic file budget but justified as the Single-Point-of-Truth for DI resolution (registry lookup, lifecycle SINGLETON/TRANSIENT/REQUEST, `@Injectable` metadata read, alias resolution, request-scope ALS propagation, dispose chain). Splitting would fragment cohesion per `rules/architecture.md § 3` + KISS / YAGNI. ADR D422 tracks ongoing Extract-Method refactor at the method level. No code change. Plan `arch-review-fixes-2026-06-06` T11.2 records the trade-off.

## [0.1.0] - 2026-05-31

> First GA release. Promotes `0.1.0-next.0` to stable with the EC-R3-1 single-flight Promise cache fix (shipped in `0.1.0-next.0` commit `520fe7d`) plus the biome-cleanup refactors below. API contract preserved — no breaking changes from `0.1.0-next.0`.

### Changed

- Refactored `Container.constructClassWithAsyncFallback<T>` (complexity 18 → ≤10) via Extract Method: introduced 4 private helpers (`validateMetadata`, `handlePrimitiveParam`, `tryResolveSync`, `resolveAllAsync`). Behavior preserved; reflect-metadata error ordering + async-fallback semantics unchanged. (theokit-sdk-biome-cleanup)
- Refactored `Container.fromFactoryProvider` (complexity 11 → ≤10) via Extract Method: introduced `tryResolveSyncDeps` private helper returning a discriminated union for sync/async dispatch. (theokit-sdk-biome-cleanup)
- Removed redundant `export` on `MODULE_METADATA_KEY` (internal-only — never part of public surface). (theokit-sdk-biome-cleanup)
- See ADR D422 for the consolidated rationale (parameter decorators enabled in biome + container Extract Method refactor).

## [0.1.0-next.0] - 2026-05-29

### Added

- Initial release of `@theokit/di` — lightweight TypeScript dependency injection container.
- `Container` class with `register()` / `registerModule()` / `resolve()` / `resolveAsync()` / `analyze()` / `dispose()`.
- 5 decorators: `@Injectable()`, `@Inject(token)`, `@Optional()`, `@Module({...})` — NestJS-compatible API.
- 4 provider types: `useClass`, `useFactory`, `useValue`, `useExisting`.
- 3 lifecycle scopes: `SINGLETON` (default), `TRANSIENT`, `REQUEST` (via `AsyncLocalStorage`).
- Cycle detection at resolve-time (Promise-lock cache with cycle-first ordering per v1.2 EC-R2-1 prevents async deadlocks).
- Cache cleanup on Promise rejection (v1.2 EC-R2-2) — transient factory failures do NOT poison the REQUEST cache.
- `runInRequest()` try/finally guarantees REQUEST instances are disposed even on callback throw (v1.1 EC-3).
- `validateClassProvider()` centralized validation — both declarative `providers: []` and imperative `register()` reject undecorated classes (v1.1 EC-1).
- Container freezes after first `resolve()`; `allowDynamicRegistration: true` opt-out for tests (v1.2 EC-R2-5).
- Module loading with cycle detection (DFS), export validation at register-time, BFS-style transitive provider import.
- Typed errors: `TokenNotFoundError`, `CyclicDependencyError`, `AsyncProviderInSyncResolveError`, `ScopeViolationError`, `MissingInjectableError`, `ContainerDisposedError`, `ContainerFrozenError`, `InvalidModuleError`, `InvalidExportError`, `CyclicModuleImportError`, `ReflectMetadataMissingError`.
- Disposal lifecycle: `dispose()` calls `Symbol.asyncDispose` (preferred) or `dispose()` on each instance in reverse construction order; aggregates errors via `AggregateError`.
- Foundation for `@theokit/orm` (P2) and `@theokit/http-decorators` (P3). Agent-first integration ships as separate `@theokit/di-agent` package (zero coupling per ADR D8).

### Bundle / Coverage

- Tests: 58 unit + integration tests passing. Coverage: 95.55% statements / 88.21% branches / 98.82% functions / 95.55% lines.
- Bundle: ESM 11.55 KB / CJS 11.32 KB (gzipped est.).
- Dual ESM + CJS, target Node 22.12+, dts emitted.

### Polyglot strategy (read ADR D11)

`@theokit/di` is **intentionally TS-only**. DI containers are intrinsically language-specific runtime constructs. The polyglot story for the theokit ecosystem lives in the contract layer — `@theokit/orm` (P2, schema export to JSON Schema + SQL migrations) and `@theokit/http-decorators` (P3, OpenAPI 3.x emit from `@Controller` decorators). Python/Go SDKs will be generated from those specs (Supabase/Appwrite pattern), NOT by porting the DI container.
