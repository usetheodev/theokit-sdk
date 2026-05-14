# Architecture

`theokit-sdk` is a TypeScript monorepo with one publishable package (`@usetheo/sdk`) at `packages/sdk/`. Everything else is configuration, documentation, or read-only reference material.

## Monorepo layout

```
theokit-sdk/
├── packages/
│   └── sdk/                    # @usetheo/sdk — the publishable package
├── docs/                       # this folder — human-friendly documentation
├── docs.md                     # canonical machine-readable API contract
├── referencia/                 # read-only reference projects (pi, openai-agents-python, ...)
├── package.json                # workspace root (private)
├── pnpm-workspace.yaml         # workspace globs
├── tsconfig.base.json          # shared TS config — extended by each package
├── biome.json                  # lint + format (excludes referencia/)
├── .changeset/                 # Changesets config and in-flight entries
├── .nvmrc                      # Pinned Node version
├── README.md                   # public front door
├── CLAUDE.md                   # contract for AI agents working here
├── CHANGELOG.md                # workspace-level changelog
└── LICENSE                     # MIT
```

## Inside `packages/sdk/`

```
packages/sdk/
├── package.json                # @usetheo/sdk
├── tsconfig.json               # extends ../../tsconfig.base.json
├── tsup.config.ts              # dual ESM + CJS build config
├── vitest.config.ts            # test runner config
├── README.md                   # package-level README (shown on npm)
├── CHANGELOG.md                # per-package changelog
├── LICENSE
├── src/
│   ├── index.ts                # public barrel
│   ├── agent.ts                # Agent static class
│   ├── cron.ts                 # Cron static class
│   ├── theokit.ts              # Theokit static class
│   ├── errors.ts               # error class hierarchy
│   ├── types/
│   │   ├── index.ts            # type barrel
│   │   ├── agent.ts
│   │   ├── conversation.ts
│   │   ├── cron.ts
│   │   ├── mcp.ts
│   │   ├── messages.ts
│   │   ├── run.ts
│   │   ├── theokit.ts
│   │   └── updates.ts
│   └── internal/
│       └── env.ts              # THEOKIT_API_KEY resolver
├── tests/
│   └── smoke.test.ts           # public-API smoke test
└── dist/                       # build output (gitignored)
```

## Layering

```
┌──────────────────────────────────────┐
│ Public API surface                   │  src/index.ts → src/{agent,cron,theokit,errors}.ts
├──────────────────────────────────────┤
│ Type contract                        │  src/types/*
├──────────────────────────────────────┤
│ Runtime adapters (future)            │  src/runtimes/{local,cloud}/* — not yet implemented
├──────────────────────────────────────┤
│ Internals                            │  src/internal/*
└──────────────────────────────────────┘
```

The public API surface is the *only* layer consumers should import from. Internal modules under `src/internal/` are explicitly NOT part of the published contract — they may change in minor releases without a major version bump.

## The contract relationship

[`../../docs.md`](../../docs.md) at the repository root is the **single source of truth** for the public API. Every change to the public surface MUST be reflected in `docs.md` in the same PR.

The TypeScript source code in `src/` implements that contract. When the two disagree:

- If the implementation is wrong: fix the implementation.
- If the contract is wrong: propose the change in a separate PR with rationale.

This separation lets the contract evolve more deliberately than the implementation.

## Build pipeline

```
src/*.ts  ──tsup──▶  dist/{index,errors,cron}.{js,cjs,d.ts,d.cts}
                              │
                              ├── ESM    .js   (with sourcemaps)
                              ├── CJS    .cjs  (with sourcemaps)
                              ├── DTS    .d.ts    (for the import condition)
                              └── DTS    .d.cts   (for the require condition)
```

Dual ESM + CJS with a types-first `exports` map. Validated by `publint` (package.json shape) and `@arethetypeswrong/cli` (resolution matrix) on every `pnpm validate`.

## Subpath exports

Three publishable subpaths today:

| Subpath | Source | What it exports |
| --- | --- | --- |
| `@usetheo/sdk` | `src/index.ts` | Everything — main barrel |
| `@usetheo/sdk/cron` | `src/cron.ts` | `Cron` only (tree-shaking) |
| `@usetheo/sdk/errors` | `src/errors.ts` | Error classes only (tree-shaking) |

To add a subpath:

1. Add an entry to `tsup.config.ts` → `entry`.
2. Add a matching `exports[<path>]` block to `package.json` (mirror the existing shape).
3. Re-run `pnpm validate` — `publint` and `attw` catch most mistakes.

## Decisions captured elsewhere

- **Locked names** (npm package, env var, namespace shapes, config paths) — see [`CLAUDE.md`](../../CLAUDE.md) `Locked names`.
- **Locked toolchain** (pnpm, tsup, Vitest, Biome, Changesets, Zod peer dep range, Node engines) — see [`CLAUDE.md`](../../CLAUDE.md) `Locked toolchain`.
- **Open decisions** (model id catalog, cron scheduler library, scheduler persistence format, etc.) — see [`CLAUDE.md`](../../CLAUDE.md) `Open decisions`.

## Next

- [Conventions](./conventions.md) — code style, naming, TDD
- [Testing](./testing.md) — Vitest patterns
- [Releasing](./releasing.md) — Changesets workflow
