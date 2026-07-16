# CLAUDE.md — theokit-sdk

Contract between Claude and the **`@theokit/sdk`** project (the **Harness** pillar of the Theo stack). Read this file before editing anything here.

---

## What this project is

`@theokit/sdk` is the **TypeScript SDK for the Theo agent harness**. It implements the public contract defined in [`./docs.md`](./docs.md) — `Agent.create()`, `Agent.send()`, `Run.stream()`, MCP servers, hooks, subagents — as a standalone TypeScript package.

The SDK is implemented from scratch against the public contract in `docs.md`, with no runtime dependency on any third-party framework.

Layout:

```
theokit-sdk/
├── README.md           # Public-facing front door
├── CLAUDE.md           # This file
├── docs.md             # Canonical public API contract (source of truth)
├── docs/               # Human-friendly documentation (3 files; the code is the docs)
├── CHANGELOG.md        # Workspace-level changelog (per-package changelogs in each package)
├── package.json        # Workspace root (private, pnpm)
├── pnpm-workspace.yaml # Workspace member globs
├── tsconfig.base.json  # Shared TS config — extended by each package
├── biome.json          # Lint + format
├── .changeset/         # Changesets config and in-flight entries
├── .nvmrc              # Pinned Node version (22.12+)
├── packages/
│   └── sdk/            # @theokit/sdk — the publishable package
│       ├── src/
│       │   ├── index.ts         # public barrel
│       │   ├── agent.ts         # Agent façade (static class)
│       │   ├── theokit.ts       # Theokit namespace (static class)
│       │   ├── errors.ts        # Error class hierarchy
│       │   ├── types/           # Public type contract from docs.md
│       │   └── internal/        # Implementation details
│       └── tests/
└── .theokit/          # example/local agent config (mcp, hooks, memory)
```

The pillar split (UI · Harness · Skills · Runtime) is locked. Do not propose copy that drifts from "this is the Harness".

## Source of truth for the public API

[`./docs.md`](./docs.md) is the canonical contract for the public API.

- Any change that affects the public surface (`Agent`, `Run`, `SDKMessage`, `InteractionUpdate`, error types, env vars, config dirs) MUST be reflected in `docs.md` in the same PR.
- The `README.md` is the front door. It summarizes `docs.md` and points to it for deep reference. It does **not** invent API.
- If the implementation drifts from `docs.md`, fix the implementation. If the spec is wrong, propose the change in a separate PR with rationale.

## Locked names

Resolved 2026-05-14. Changing any requires updating `docs.md`, `README.md`, and a `CHANGELOG.md` entry in the same PR.

| Item | Value | Notes |
| --- | --- | --- |
| npm package | `@theokit/sdk` | Under the `@theokit` scope, alongside `@theokit/ui`. |
| Env var (API key) | `THEOKIT_API_KEY` | All SDK env vars namespace under `THEOKIT_` to leave `THEO_` available for future Theo PaaS tooling. |
| API namespace object | `Theokit` | E.g. `Theokit.me()`, `Theokit.models.list()`, `Theokit.repositories.list()`. |
| Error base class | `TheokitAgentError` | All errors extend this. |
| Local agent ID prefix | `agent-` | Per `docs.md`. |
| Cloud agent ID prefix | `bc-` | Used to auto-detect runtime in `Agent.resume()` / `Agent.get()`. |
| Project config dir | `.theokit/` | `.theokit/mcp.json`, `.theokit/hooks.json`, `.theokit/agents/*.md`, `.theokit/cron/jobs.json`. |
| User config dir | `~/.theokit/` | `~/.theokit/mcp.json`, `~/.theokit/hooks.json`. |
| Pagination cursor field | `nextCursor` | Renamed from the `nextTheo` placeholder in the original `docs.md`. |
| Top-level API namespaces | `Agent`, `Cron`, `Theokit` | Static classes with private constructors. |

> **Naming note.** The agent itself is "the Theo agent" in prose (matches the locked Theo narrative). The **SDK surface** uses the `Theokit` prefix for consistency with the env var and project name. Two different things — don't collapse them.

## Locked toolchain

Resolved 2026-05-14. Changing any of these is a strategic decision, not a refactor.

| Layer | Choice | Version | Rationale |
| --- | --- | --- | --- |
| Package manager | pnpm | `9.15.0` (via corepack) | pnpm workspaces are the 2026 standard for TS monorepos. |
| Node runtime | Node | `>=22.12.0` (`.nvmrc` pins minimum) | Node 20 reached EOL April 2026. Use `nvm use` to switch. |
| Build | tsup | `^8.5.0` | Standard modern TS bundler; tsdown is the migration path once mature. |
| TypeScript | tsc | `^5.8.0` strict | TS 7 (tsgo) is beta as of April 2026 — do NOT use for emit. |
| Package format | Dual ESM + CJS | — | Stripe / Anthropic SDK / OpenAI SDK still ship dual in 2026. |
| Test | Vitest | `^3.0.0` | Confirmed across modern TS SDKs. |
| Lint + format | Biome | `^2.4.0` | Single tool; greenfield choice. |
| Versioning | Changesets | `^2.31.0` | Standard for pnpm monorepos publishing to npm. |
| Validation | publint + `@arethetypeswrong/cli` | Standard 2026 stack | No credible alternative. |
| Runtime validation | Zod | peer dep `^3.25 \|\| ^4` | Matches the Anthropic / OpenAI provider pattern. Optional peer. |
| HTTP | Native `fetch` | — | Anthropic and OpenAI SDKs migrated off `node-fetch`. Expose injectable `fetch` option. |
| Streaming | `AsyncGenerator` of discriminated `SDKMessage` | — | Matches the streaming shape of modern agent SDKs. |
| Resource disposal | `dispose()` method + `[Symbol.asyncDispose]` (implementation-side) | — | Skeleton interface uses `dispose()` until lib bump to `ESNext.Disposable`. |

## Native bindings discipline

Some dependencies ship native binaries (currently: `better-sqlite3`). Each is compiled against a specific Node.js ABI (`NODE_MODULE_VERSION`). When the installed Node version differs from the ABI the binary was built against, every `require()` of that module throws `Module did not self-register` or `NODE_MODULE_VERSION X required, got Y`.

**How we prevent this:**

1. `engines.node = ">=22.12.0"` in every package.json — pnpm warns on mismatch (does NOT block).
2. `.nvmrc` pins the canonical Node version — `nvm use` switches.
3. `tools/preflight-native-bindings.mjs` runs as the SDK's vitest setup — detects ABI mismatch + auto-rebuilds (one-shot, sentinel-cached at `node_modules/.cache/preflight-native-{abi}.ok`).
4. CI workflows ship an explicit `pnpm rebuild better-sqlite3 --workspace-root` step before tests (defense in depth).

**If you hit the error locally:**
- First: `nvm use` (or `nvm install` if you don't have the pinned version). 95% of cases.
- If you can't switch Node: `pnpm rebuild better-sqlite3 --filter @theokit/sdk`. The preflight does this automatically on first test run.
- If both fail: `node-gyp` prerequisites missing (python3, make, C++ compiler). Install build-essential / Xcode CLI tools.

**If you hit it in CI:**
- Check the workflow ran the rebuild step. If yes and it failed, the runner image lacks build prerequisites.
- `CI=true` is auto-set by GitHub Actions — preflight then fails fast (no auto-rebuild) so the explicit CI step's failure is what users see.

**Do not:**
- Pin a specific binary version — pnpm store deduplicates; use `pnpm rebuild`.
- Add fresh `try/catch` around `require('better-sqlite3')` to "handle" the failure — that masks the bug. Fix the root cause.

**Convention notes:**
- The preflight covers both the SDK's own `node_modules/.pnpm/better-sqlite3@*/...` AND any binding loaded via a workspace-link symlink to a sibling repo (`findRebuildCwd` walks the realpath to route rebuild correctly).
- `NATIVE_DEPS` in the preflight is hardcoded (`['better-sqlite3']`). When shipping a new native dep, add it to that array AND its `exerciseDep()` case so the probe actually triggers dlopen.
- Tests placed under `tests/integration/**` run in a `forks + singleFork` pool (vitest poolMatchGlobs) to avoid contention with the threads pool. New tests there must be process-isolation-tolerant.

`node-22-mandatory` is the standing ABI decision for this repo.

## Voice and Tone

**Applies to (aspirational voice):**

- `README.md` HERO and BODY layers (everything above the `## How it works` delimiter)
- `PITCH.md` — landing-page copy at workspace root
- Future launch material, blog posts, social copy, and site sections referencing the SDK

**Does NOT apply to (stays technical-direct):**

- `docs.md` — the canonical public API contract. Precise, technical, no marketing varnish.
- `README.md` DEEP DIVE layer — everything from `## How it works` downward, including Installation, Authentication, Core concepts, API surfaces (`Agent.create`, `agent.send`, `SDKMessage`), MCP, Cron, Errors, Cloud reference, Configuration reference, Development. Full technical vocabulary is in play.
- This `CLAUDE.md`, `CHANGELOG.md`, internal design notes, and per-package docs.

**Narrative anchors that must hold (regardless of voice):**

- "Harness pillar of Theo" — the SDK is the harness, not the framework and not the runtime (Theo PaaS).
- "Open stack underneath" — the load-bearing differentiator. Apache-2.0 SDK, Apache-2.0 local runtime, multi-provider keys, opt-in cloud, walk-away cost zero.
- "Pre-release honesty" — cloud runtime depends on Theo PaaS, currently pre-release. Cloud-only features must be labeled.
- "No invented integration" — never claim wiring with other Theo pillars that does not yet exist.

## Pre-release honesty (cloud runtime)

The cloud runtime depends on **Theo PaaS**, currently pre-release.

- `README.md` keeps cloud in a clearly labeled "Cloud runtime — pre-release" section.
- Do **not** promise GA features in copy.
- Local runtime is the primary tested path. Cloud examples document the contract for when PaaS ships.
- If a feature is cloud-only (artifacts, `autoCreatePR`, `envVars`, `git` metadata on results), say so explicitly.
- If a feature is local-only (`local.force`, `local.settingSources`, file-based hooks discovery from `cwd`), say so explicitly.

## Relationship to other pillars

| Pillar | Project | Current integration (verify before claiming) | Roadmap |
| --- | --- | --- | --- |
| UI | `@theokit/ui` | None as of 2026-05-14 | Web chat surfaces may consume `@theokit/ui` primitives later. |
| Skills | `theokit` | None as of 2026-05-14 | An "agent layer" integration lands here. |
| Runtime | Theo PaaS | None (PaaS pre-release) | Cloud runtime endpoint is Theo PaaS. |

> "Do not invent integration that does not exist yet." Verify the actual import / dependency before claiming wiring exists in copy or in examples. `grep` first, claim second.

## First-time setup

Node version must be 22.12+. Use nvm:

```bash
nvm use                       # respects .nvmrc → Node 22+
corepack enable               # makes the pinned pnpm available
corepack prepare pnpm@9.15.0 --activate
pnpm install                  # installs workspace deps
pnpm typecheck                # tsc --noEmit across packages
pnpm test                     # vitest
pnpm build                    # tsup → dist/{index,errors}.{js,cjs,d.ts}
pnpm validate                 # everything above plus publint + attw
```

## Inviolable rules

1. **95% confidence gate.** Stop and ask if uncertain.
2. **Task completion gate.** Finish the previous task 100% before starting a new one.
3. **Extreme honesty.** Admit ignorance. Surface risks.
4. **Git rules.** No `git checkout` or `git revert`. No direct work on `main`.
5. **TDD.** Tests before production code. Bug fixes start with a regression test.
6. **Changelog discipline.** Every code change updates `CHANGELOG.md` (workspace-level at root; per-package at `packages/<name>/CHANGELOG.md`).
7. **Don't reinvent.** Prefer mature libraries — the toolchain table above already does this.
8. **No emojis** in code, READMEs, or CLAUDE.md files unless explicitly requested.
9. **Uniform `X.create()` is the canonical API.** Every public capability ships as a static `X.create()` method on a namespace class with a `private constructor` — `Tool.create`, `Provider.create`, `Plugin.create`, `Squad.create`, `Session.create`, `Subscription.create`, `Semaphore.create`, `Auth.create`, `Retry.create`, … — matching the top-level `Agent.create` / `Cron.create` / `Workflow.create`. The previous `define*` / `create*` factory-function surface was collapsed to the uniform `X.create()` form at `@theokit/sdk@3.0.0` (hard break; codemod `@theokit/codemod-sdk-3-0`). Rationale: one mental model across the whole surface. Decorators remain an OPTIONAL convenience layer via the externally-published `@theokit/di` (in the `theokit-di` repo), NOT required of Harness features.

## Checklist before changing public API

- [ ] Updated `docs.md` to reflect the new shape (it is the source of truth).
- [ ] Updated `README.md` if the change is user-visible.
- [ ] Added or updated tests covering the new contract (TDD: regression test first when fixing a bug).
- [ ] `CHANGELOG.md` entry under `[Unreleased]` in `packages/sdk/CHANGELOG.md` (or root `CHANGELOG.md` for workspace changes).
- [ ] No promise of cloud-only features as GA.
- [ ] No silent integration claims with `@theokit/ui` or `theokit` — verify the import exists.
- [ ] No runtime dependency on any third-party framework.

## When this file is wrong

The code is authoritative. If this file disagrees with the code, the code wins — update this file via PR with rationale in the commit message. Locked names and locked toolchain require an explicit decision; do not edit them silently.
