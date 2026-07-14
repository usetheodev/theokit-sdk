# Architecture

`theokit-sdk` is a pnpm-workspaces + turbo TypeScript monorepo. The flagship publishable package is `@theokit/sdk` at `packages/sdk/`; alongside it ship the rest of the Harness package set (extensions, memory adapters, CLI, ACP, codemods). See [`packages/README.md`](../../packages/README.md) for the family + status table.

## Monorepo layout

```
theokit-sdk/
├── packages/                   # 13 publishable packages (see packages/README.md)
│   ├── sdk/                    # @theokit/sdk — the flagship package
│   ├── sdk-tools/              # @theokit/sdk-tools — built-in coding tools (read/write/edit/glob/search)
│   ├── sdk-budget/             # @theokit/sdk-budget — budget/cost extension
│   ├── sdk-cache/              # @theokit/sdk-cache — semantic cache extension
│   ├── sdk-handoff/            # @theokit/sdk-handoff — agent handoff extension
│   ├── sdk-memory/             # @theokit/sdk-memory — memory extension
│   ├── memory-honcho/         # memory adapter (Honcho)
│   ├── memory-mem0/           # memory adapter (Mem0)
│   ├── memory-supermemory/    # memory adapter (Supermemory)
│   ├── cli/                    # @theokit/cli
│   ├── acp/                    # @theokit/acp — Agent Client Protocol server
│   └── codemod-sdk-2-0/, codemod-sdk-3-0/  # migration codemods
├── docs/                       # this folder — human-friendly documentation
├── docs.md                     # canonical machine-readable API contract
├── package.json                # workspace root (private); scripts run through turbo
├── pnpm-workspace.yaml         # workspace globs
├── turbo.json                  # turbo pipeline (build / test / typecheck caching)
├── tsconfig.base.json          # shared TS config — extended by each package
├── biome.json                  # lint + format
├── .changeset/                 # Changesets config and in-flight entries
├── .nvmrc                      # Pinned Node version (22.12+)
├── README.md                   # public front door
├── CLAUDE.md                   # contract for AI agents working here
├── CHANGELOG.md                # workspace-level changelog
└── LICENSE                     # Apache-2.0
```

> Reference peers (pi, a peer SDK, …) are **no longer vendored in-tree**. They are cloned on demand under `.claude/knowledge-base/reference/` (gitignored) — read-only study material, never imported.

## Inside `packages/sdk/`

```
packages/sdk/
├── package.json                # @theokit/sdk
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
| `@theokit/sdk` | `src/index.ts` | Everything — main barrel |
| `@theokit/sdk/cron` | `src/cron.ts` | `Cron` only (tree-shaking) |
| `@theokit/sdk/errors` | `src/errors.ts` | Error classes only (tree-shaking) |

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
