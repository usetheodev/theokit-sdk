# Changelog

## [0.1.0-next.1] - 2026-06-01

### Added

- Python SQLAlchemy polyglot smoke test (T6.2) — exported JSON Schema 7 loads into SQLAlchemy `MetaData` + `create_all` succeeds against in-memory SQLite. Proves ADR D11 polyglot story works end-to-end across language boundaries. The smoke test gracefully skips when Python 3.10+ or `sqlalchemy` is unavailable.
- `tests/integration/scripts/load_schema.py` — reference Python harness for consumers that want to load orm-emitted schemas into their own SQLAlchemy models.

## [Unreleased]

### Added

- Package scaffold for `@theokit/orm`: tsup build, vitest setup, tsconfig with `experimentalDecorators` + `emitDecoratorMetadata`.
- `Repository<T>` class with 6 minimum methods (`findById`, `findMany`, `insert`, `update`, `delete`, `query`) over `drizzle-orm`. EC-1 absorbed: throws `OrmConfigurationError` at construction when entity has no primary key. EC-2 absorbed: `findById`/`update`/`delete` validate `id` is non-null, non-empty, string-or-number to prevent data-loss from `DELETE WHERE id IS NULL`.
- `getRepositoryToken(entity, dataSourceName?)` token generator. Mirrors NestJS TypeORM convention (`REPO:${entityName}` / `REPO:${dataSourceName}:${entityName}`).
- `@InjectRepository(entity, dataSourceName?)` parameter decorator wrapping `@Inject` from `@theokit/di`.
- `OrmModule.forRoot(opts)` / `OrmModule.forFeature(entities, dataSourceName?)` provider builders. EC-5 absorbed: `forFeature` throws `OrmConfigurationError` with actionable message if `forRoot` was not called for the dataSource first.
- `withAgentContext({ agentId, runId, conversationId }, fn)` AsyncLocalStorage helper. Repository `insert`/`update` auto-fill matching columns when context is present and column exists on the table.
- `@Transactional()` method decorator wraps `db.transaction(...)` with rollback-on-throw. Tx propagated via `withTxContext` AsyncLocalStorage so injected Repositories transparently use the tx scope. EC-9 absorbed: throws `OrmConfigurationError` with actionable message when the host class is not DI-managed (no DataSource bound).
- `exportSchemas(schema)` / `exportSchema(table)` (from `@theokit/orm/schema-export`): emit JSON Schema 7 from Drizzle tables. 12 column types mapped (text, varchar, integer, bigint, real, numeric, boolean, json, uuid, blob, timestamp, enum). EC-11 absorbed: unknown column types throw `OrmSchemaExportError` with actionable message — no silent fallback.
- `OrmError`, `OrmConfigurationError`, `OrmValidationError`, `OrmSchemaExportError` typed error hierarchy.
