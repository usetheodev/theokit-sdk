# Development setup

How to bring this repository from `git clone` to a green `pnpm validate` on your machine.

## Prerequisites

| Tool | Version | Install hint |
| --- | --- | --- |
| Node.js | 22.12+ | `nvm install 22 && nvm use 22` (`.nvmrc` pins the minimum) |
| pnpm | 9.15.0 | `corepack enable && corepack prepare pnpm@9.15.0 --activate` |
| Git | any recent | system package manager |

We standardize on `pnpm` for workspace management and `corepack` to pin the exact pnpm version per `package.json`'s `packageManager` field. Do not use `npm install` or `yarn install` at the repo root.

## First-time setup

```bash
git clone <repo-url> theokit-sdk
cd theokit-sdk
nvm use                                  # respects .nvmrc → Node 22+
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install
```

Verify everything is green:

```bash
pnpm -w run validate
```

This runs, in order:

1. `pnpm check` — Biome lint + format check
2. `pnpm typecheck` — `tsc --noEmit` across packages
3. `pnpm build` — tsup builds the SDK to `packages/sdk/dist/`
4. `pnpm test` — Vitest runs the smoke tests
5. `pnpm validate:publint` — package.json shape check
6. `pnpm validate:attw` — `arethetypeswrong` types-resolution check

All six must pass. Treat any red gate as a blocker.

## Per-task commands

```bash
pnpm typecheck                # tsc --noEmit
pnpm test                     # vitest run
pnpm test:watch               # vitest watch mode
pnpm build                    # tsup → dist/
pnpm check                    # biome check (read-only)
pnpm check:fix                # biome check --write (apply fixes)
```

All script entries live in the root `package.json` and are invoked with `pnpm -w run <name>` from anywhere in the workspace.

## Environment variables

| Variable | Required for | Notes |
| --- | --- | --- |
| `THEOKIT_API_KEY` | Any real Theo API call | Not required for typecheck, build, or smoke tests. |

Smoke tests in `packages/sdk/tests/` do not hit the network — they only verify the public API surface compiles and stub methods reject correctly.

## Reference projects

`referencia/` contains read-only reference projects (notably the `pi` agent harness and `openai-agents-python`). They are NOT part of the workspace:

- Do not `npm install` or `pip install` inside `referencia/`.
- Do not edit them.
- Do not import from them in production code.

They exist for design inspiration. See [`CLAUDE.md`](../../CLAUDE.md) `Working with referencia/` for the full rules.

## Next

- [Architecture](./architecture.md) — what each folder does
- [Conventions](./conventions.md) — code style, naming, TDD
- [Testing](./testing.md) — writing new tests
