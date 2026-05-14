# Conventions

Code style and discipline for `@usetheo/sdk`. The TL;DR: match what's already in `src/` and the inviolable rules from [`CLAUDE.md`](../../CLAUDE.md).

## TypeScript strictness

`tsconfig.base.json` enables:

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `noImplicitOverride: true`
- `noFallthroughCasesInSwitch: true`
- `verbatimModuleSyntax: true`
- `isolatedModules: true`

This means:

- Every `import` of a type must use `import type` (or inline `{ type X }`).
- Every `override` keyword must be explicit (`override readonly name: string = "...";`).
- Indexed access returns `T | undefined`; check before use.

## Naming

| Kind | Convention | Example |
| --- | --- | --- |
| Public types | PascalCase | `AgentOptions`, `SDKMessage`, `CronJob` |
| Public classes / namespaces | PascalCase | `Agent`, `Cron`, `TheokitAgentError` |
| Module files | kebab-case-ish but match the export | `agent.ts`, `cron.ts`, `error-handling.md` (docs) |
| Internal helpers | camelCase functions in `src/internal/` | `resolveApiKey` |
| Env vars | `THEOKIT_*` | `THEOKIT_API_KEY` |
| Config paths | `.theokit/<thing>` | `.theokit/cron/jobs.json` |

The agent itself is "the **Theo** agent" in prose. The SDK surface uses the `Theokit` prefix for consistency with the env var and project name. These are different things — don't collapse them.

## Error classes

All errors extend `TheokitAgentError` (or `Error` for `UnsupportedRunOperationError`). When adding a new error class:

```typescript
export class FooError extends TheokitAgentError {
  override readonly name: string = "FooError";

  constructor(message: string, options: { code?: string; cause?: unknown } = {}) {
    super(message, { ...options, isRetryable: false });
  }
}
```

Always type `name` as `: string` (not as a literal) so subclasses can override.

The base `TheokitAgentError` carries `isRetryable`, `code`, `protoErrorCode`, and `cause`. Subclasses choose `isRetryable` based on semantics (rate-limit = retry; auth = don't).

## Static-only namespaces

`Agent`, `Cron`, and `Theokit` are classes with private constructors. Instantiation is intentionally blocked — the static method set IS the API.

```typescript
export class Foo {
  private constructor() {
    // Static-only namespace.
  }

  static doThing(_options: FooOptions): Promise<FooResult> {
    return Promise.reject(new ConfigurationError("Foo.doThing: not implemented"));
  }
}
```

Stub methods reject with `ConfigurationError` carrying a `"Foo.method: Not implemented yet — see CHANGELOG.md and docs.md"` message until the runtime adapter wires them up.

## Imports and exports

- Re-export from `src/index.ts` (the public barrel) for everything users should consume.
- Use `export type *` for type-only re-exports under `src/types/index.ts`.
- Sort exports alphabetically by source filename. Biome enforces this.

## Comments

- Default to no comments. Well-named identifiers self-document.
- Add a JSDoc `@public` block above every exported declaration in the public surface (`src/{agent,cron,theokit,errors}.ts` and `src/types/*`).
- Use `@internal` for `src/internal/*` helpers.
- Comments that exist must explain the **why**, not the **what**.

## TDD discipline

Per [`CLAUDE.md`](../../CLAUDE.md) inviolable rule 5:

- Bug fixes start with a failing regression test, then fix.
- New functionality lands with tests in the same PR — never "tests later".
- Tests live in `packages/sdk/tests/`.
- See [Testing](./testing.md) for patterns.

## Don't reinvent

Per inviolable rule 7 and the locked toolchain — prefer libraries already in our stack:

- **Build**: tsup
- **Test**: Vitest
- **Lint**: Biome
- **Validation**: publint + attw
- **Runtime validation** (optional): Zod (peer dep)

Adding a new dev dependency to the root `package.json` is a deliberate choice, not a refactor. Document the why in the PR description and in `CHANGELOG.md`.

## Changelog discipline

Every code change updates a `CHANGELOG.md` entry under `[Unreleased]`:

- Workspace-level changes → root `CHANGELOG.md`
- Package-level changes → `packages/sdk/CHANGELOG.md`

Format: [Keep a Changelog](https://keepachangelog.com/). Categories: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.

## Next

- [Testing](./testing.md) — Vitest patterns
- [Releasing](./releasing.md) — Changesets workflow
