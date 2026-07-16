# CLAUDE.md — theokit-sdk

Contract between Claude and the **`@theokit/sdk`** project (the **Harness** pillar of [Theo](../CLAUDE.md)). Read this file **and** the root `CLAUDE.md` before editing anything here.

This file complements `/home/user/Projetos/usetheo/CLAUDE.md` and `/home/user/.claude/CLAUDE.md`. Root rules apply unconditionally. SDK-specific rules layer on top.

---

## What this project is

`@theokit/sdk` is the **TypeScript SDK for the Theo agent harness**. It implements the public contract defined in [`./docs.md`](./docs.md) — `Agent.create()`, `Agent.send()`, `Run.stream()`, MCP servers, hooks, subagents — as a standalone TypeScript package.

The SDK is implemented from scratch, informed by reference projects (notably `the local runtime` and the `a peer SDK` SDK). Those peers are no longer vendored in-tree — they are cloned on demand under `.claude/knowledge-base/reference/` (gitignored; each dev may hold a different clone set). The reference material is read-only; we study it, we do not depend on it.

Layout:

```
theokit-sdk/
├── README.md           # Public-facing front door
├── CLAUDE.md           # This file
├── docs.md             # Canonical public API contract (source of truth)
├── docs/               # Human-friendly documentation site (markdown)
├── CHANGELOG.md        # Workspace-level changelog (per-package changelogs in each package)
├── package.json        # Workspace root (private, pnpm)
├── pnpm-workspace.yaml # Workspace member globs
├── tsconfig.base.json  # Shared TS config — extended by each package
├── biome.json          # Lint + format (excludes referencia/)
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
└── .claude/            # Plan-cycle ecosystem; knowledge-base/reference/ holds SOTA study peers (cloned on demand, gitignored — NOT workspace members)
```

The pillar split (UI · Harness · Skills · Runtime) is locked in the root `CLAUDE.md`. Do not propose copy that drifts from "this is the Harness".

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

Resolved 2026-05-14 with research backing in [the SOTA validation report](#sota-validation-report) (background-agent output captured in the conversation). Changing any of these is a strategic decision, not a refactor.

| Layer | Choice | Version | Rationale |
| --- | --- | --- | --- |
| Package manager | pnpm | `9.15.0` (via corepack) | Matches sibling `theokit` project; pnpm workspaces are the 2026 standard for TS monorepos. |
| Node runtime | Node | `>=22.12.0` (`.nvmrc` pins minimum) | Node 20 reached EOL April 2026. Use `nvm use` to switch. |
| Build | tsup | `^8.5.0` | a peer vendor AI ships on tsup. tsdown is the migration path once mature. |
| TypeScript | tsc | `^5.8.0` strict | TS 7 (tsgo) is beta as of April 2026 — do NOT use for emit. |
| Package format | Dual ESM + CJS | — | Stripe / Anthropic SDK / OpenAI SDK still ship dual in 2026. |
| Test | Vitest | `^3.0.0` | Confirmed across MCP SDK, a peer vendor AI, OpenAI Agents. |
| Lint + format | Biome | `^2.4.0` | Single tool; greenfield choice. ESLint still incumbent in older SDKs. |
| Versioning | Changesets | `^2.31.0` | Standard for pnpm monorepos publishing to npm. |
| Validation | publint + `@arethetypeswrong/cli` | Standard 2026 stack | No credible alternative. |
| Runtime validation | Zod | peer dep `^3.25 \|\| ^4` | Matches Anthropic / OpenAI / a peer vendor pattern. Optional peer. |
| HTTP | Native `fetch` | — | Anthropic and OpenAI SDKs migrated off `node-fetch`. Expose injectable `fetch` option. |
| Streaming | `AsyncGenerator` of discriminated `SDKMessage` | — | Matches `@anthropic-ai/claude-agent-sdk`. |
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
- The preflight covers both the SDK's own `node_modules/.pnpm/better-sqlite3@*/...` AND any binding loaded via a workspace-link symlink to a sibling repo (EC-1 — `findRebuildCwd` walks the realpath to route rebuild correctly).
- `NATIVE_DEPS` in the preflight is hardcoded (`['better-sqlite3']`). When shipping a new native dep, add it to that array AND its `exerciseDep()` case so the probe actually triggers dlopen.
- Tests placed under `tests/integration/**` run in a `forks + singleFork` pool (vitest poolMatchGlobs) to avoid contention with the threads pool. New tests there must be process-isolation-tolerant.

ADR D01 (this repo): `node-22-mandatory`. Plan: [`../.claude/knowledge-base/plans/dogfood-regressions-fix-plan.md`](../.claude/knowledge-base/plans/dogfood-regressions-fix-plan.md) v1.1.

## Voice and Tone

**Locked 2026-05-15.** TheoKit-SDK has adopted the aspirational voice originally scoped to TheoKit. The operational guide — three communication layers (HERO / BODY / DEEP DIVE), vocabulary translation, banned terms list, storytelling rules, before/after examples — lives in [`../theokit/CLAUDE.md`](../theokit/CLAUDE.md). Read it before writing any public copy for this project. This file does not duplicate it.

**Applies to:**

- `README.md` HERO and BODY layers (everything above the `## How it works` delimiter)
- `PITCH.md` — landing-page copy at workspace root
- Future TheoKit-SDK launch material, blog posts, social copy, and site sections referencing the SDK

**Does NOT apply to (stays technical-direct):**

- `docs.md` — the canonical public API contract. Precise, technical, no marketing varnish.
- `README.md` DEEP DIVE layer — everything from `## How it works` downward, including Installation, Authentication, Core concepts, API surfaces (`Agent.create`, `agent.send`, `SDKMessage`), MCP, Cron, Errors, Cloud reference, Configuration reference, Development. Full technical vocabulary is in play.
- This `CLAUDE.md`, ADRs, `CHANGELOG.md`, internal design notes, and per-package docs.

**Cross-project narrative anchors that must hold (regardless of voice):**

- "Harness pillar of Theo" — the SDK is the harness, not the framework (TheoKit) and not the runtime (Theo PaaS).
- "Open stack underneath" — the load-bearing differentiator. Apache-2.0 SDK, Apache-2.0 local runtime via `pi/`, multi-provider keys, opt-in cloud, walk-away cost zero.
- "Pre-release honesty" — cloud runtime depends on Theo PaaS, currently pre-release. Cloud-only features must be labeled.
- "No invented integration" — never claim wiring with other Theo pillars that does not yet exist (Cross-Project Rule 2).

If a piece of TheoKit-SDK copy contradicts the locked narrative in [`../CLAUDE.md`](../CLAUDE.md) or the operational rules in [`../theokit/CLAUDE.md`](../theokit/CLAUDE.md), the root and TheoKit rules win — surface the conflict before publishing.

## Pre-release honesty (cloud runtime)

The cloud runtime depends on **Theo PaaS**, currently pre-release per the root `CLAUDE.md` (3.49/4.0).

- `README.md` keeps cloud in a clearly labeled "Cloud runtime — pre-release" section.
- Do **not** promise GA features in copy.
- Local runtime is the primary tested path. Cloud examples document the contract for when PaaS ships.
- If a feature is cloud-only (artifacts, `autoCreatePR`, `envVars`, `git` metadata on results), say so explicitly.
- If a feature is local-only (`local.force`, `local.settingSources`, file-based hooks discovery from `cwd`), say so explicitly.

## Relationship to other pillars

| Pillar | Project | Current integration (verify before claiming) | Roadmap |
| --- | --- | --- | --- |
| UI | `@theokit/ui` | None as of 2026-05-14 | Web chat surfaces may consume `@theokit/ui` primitives later. |
| Skills | `theokit` | None as of 2026-05-14 | `theokit` README mentions an "agent layer" — that integration lands here. |
| Runtime | Theo PaaS | None (PaaS pre-release) | Cloud runtime endpoint is Theo PaaS. |

> "Do not invent integration that does not exist yet." (Root `CLAUDE.md` rule 2.)
>
> Verify the actual import / dependency before claiming wiring exists in copy or in examples. `grep` first, claim second.

## Working with reference material

Study peers are **read-only study material** for the SDK implementation. They are not part of the pnpm workspace, not imported, and never modified from this project. They are **no longer vendored in-tree** as `referencia/` submodules — they are cloned on demand under `.claude/knowledge-base/reference/` (gitignored; the `/to-reference` skill clones the set a task needs). Distilled implementation guides land at `.claude/knowledge-base/reference/{topic}.md`.

Reference projects studied (clone on demand; not all present in every checkout):

- **`the local runtime`** — fork of [`the-open-runtime`](the open local runtime). Primary inspiration for `the-agent-core` (Agent runtime), `the-provider-layer` (multi-provider LLM API), and `the-coding-agent` (CLI patterns).
- **`cookbook`** — the open runtime's example recipes. Useful for understanding intended API ergonomics.
- **`a peer SDK`** — OpenAI Agents Python SDK. Useful for `Agent` / `Run` / streaming API design.
- Others cloned as tasks require (e.g. `peer-project`, `a peer framework`, `a peer project`, `peer-agent`, `codex`).

Rules when consulting reference material:

1. **Read, do not run.** Reference projects have their own dependencies, lockfiles, and engines. Do not `npm install` or `pip install` inside a clone. If you need to run them, do so outside this repo.
2. **Never edit.** If you find a bug in a reference project, file it upstream or note it in our `docs.md` rationale. Do not patch.
3. **Cite when borrowing patterns.** When the SDK implementation copies a pattern from a reference, add a code comment: `// referencia: runtime/packages/agent/src/foo.ts` so future maintainers can trace the lineage.
4. **No transitive dependencies.** The SDK must not import from any reference clone. If you find yourself wanting to, you are wrapping rather than implementing — surface the decision (see Open Decisions).

`biome.json` still carries a vestigial `!referencia` exclusion (harmless now that the tree is gone); `.claude/knowledge-base/reference/` is gitignored. Do not change those exclusions silently.

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

## Decided ADRs

**430 ADRs registradas** em [`./.claude/knowledge-base/adrs/`](./.claude/knowledge-base/adrs/) (D1–D430).

Para consultar: `ls .claude/knowledge-base/adrs/` ou `grep -l "<keyword>" .claude/knowledge-base/adrs/*.md`.

Ranges por domínio:
- D1–D14: Core SDK (Node, toolchain, memory, errors)
- D22–D50: Agent DX (getOrCreate, factory, builder, defineTool, React, SSE, streamObject)
- D51–D85: Infrastructure (persistence, path-guard, security, redaction, config format)
- D86–D133: Agent loop (tool-dispatch, iteration budget, compression, plugins, hooks, tools, providers, fork)
- D134–D169: Advanced features (batch, memory adapters, context files, personalities)
- D170–D302: Gateways + providers (Telegram, Discord, Slack, WhatsApp, Teams, Email, SMS, Mattermost, LINE, Matrix, Ollama, LMStudio, llama.cpp, Bedrock, Vertex)
- D303–D348: v1.4 expansion (gateway-whatsapp, teams, email, google-workspace)
- D349–D388: v1.5 (ACP, tasks, budget)
- D389–D421: Gateway Tier 1 (SMS, Mattermost, LINE, Matrix)
- D422: Biome parameter decorators
- D423–D430: G8 streaming (subscription, SSE, WS, resume tokens)


Open question that remained:
- **Supported cloud SCM providers at GA** — out of scope for v1.0 because cloud runtime is pre-release. Will be decided alongside Theo PaaS release.

## Roadmap

> **Consolidated 2026-06-01.** SDK Roadmap (Hermes parity) + Adoption Roadmap v1.3/v1.4/v1.5/Gateway Tier 1 + Backend DX packages roadmap moveram pro single source of truth em [`../CLAUDE.md`](../CLAUDE.md) (meta-repo). Sub-repo só mantém Locked names + Locked toolchain + Native bindings + Voice & Tone + Decided ADRs (que ficam in-repo per ADR D67/D68/etc — referenciados pelo meta).

Status SDK 2026-06-01 (resumo — detalhes no meta):

- **v1.0-v1.2 base + Hermes parity 23/23**: 122 ADRs registradas (`./.claude/knowledge-base/adrs/D1`-`D122`).
- **v1.3 Adoption (8 items)**: 7/8 DONE 2026-05-22 → 2026-05-23 — CLI, Eval, Handoffs, Workflows, Cache, Slack gateway, Bedrock+Vertex (Docs superseded por v1.4 #1).
- **v1.4 Adoption (5 items)**: 5/5 DONE 2026-05-23 → 2026-05-25 — Docs site, WhatsApp, Teams, Email, Google Workspace skills.
- **v1.5 Adoption (2 items)**: 2/2 DONE 2026-05-27 — ACP server, Tasks observability.
- **v1.5 Gateway Tier 1 (4 items)**: 4/4 DONE 2026-05-28 — SMS, Mattermost, LINE, Matrix.
- **Backend DX P1 (DI + di-agent)**: DONE 2026-05-29, GA 0.1.0 published 2026-05-31. P2 (`@theokit/orm`) + P3 (`@theokit/http-decorators`) ⏳ next.
- **G8 streaming (WebSocket + W3C SSE + opaque resume tokens, ADRs D423-D430)**: DONE 2026-06-04 — `@theokit/sdk@1.7.0` ships `@theokit/sdk/subscription` sub-path with `defineSubscription` + `subscribe` + `tracked` + Node `ws` canonical adapter. 45 tests GREEN + 1 honest-SKIP (real Node WS server roundtrip + lastEventId resume + real-LLM env-gated composition with `Agent.streamObject`). CF Workers/Bun/Deno adapters deferred v1.8.x.

Total ADRs registradas: 430 (`./.claude/knowledge-base/adrs/D1` até `D430`).

## Inviolable rules (carried from root and global)

1. **95% confidence gate.** Stop and ask if uncertain.
2. **Task completion gate.** Finish the previous task 100% before starting a new one.
3. **Extreme honesty.** Admit ignorance. Surface risks.
4. **Git rules.** No `git checkout` or `git revert`. No direct work on `main`.
5. **TDD.** Tests before production code. Bug fixes start with a regression test.
6. **Changelog discipline.** Every code change updates `CHANGELOG.md` (workspace-level at root; per-package at `packages/<name>/CHANGELOG.md`).
7. **Don't reinvent.** Prefer mature libraries — the toolchain table above already does this.
8. **No emojis** in code, READMEs, or CLAUDE.md files unless explicitly requested.
9. **Uniform `X.create()` is the canonical API.** Every public capability ships as a static `X.create()` method on a namespace class with a `private constructor` — `Tool.create`, `Provider.create`, `Plugin.create`, `Squad.create`, `Session.create`, `Subscription.create`, `Semaphore.create`, `Auth.create`, `Retry.create`, … — matching the top-level `Agent.create` / `Cron.create` / `Workflow.create`. **Reversed 2026-07-13 via ADR 0015 (SE36), which supersedes ADR D431** ("factory functions are the canonical API"): the previous `define*` / `create*` factory-function surface was collapsed to the uniform `X.create()` form at `@theokit/sdk@3.0.0` (hard break; codemod `@theokit/codemod-sdk-3-0`). Rationale: one mental model across the whole surface (owner decision). This deliberately diverges from the SOTA `tool()` idiom (a peer framework / OpenAI Agents / a framework) — an accepted trade-off recorded in ADR 0015. Decorators remain an OPTIONAL convenience layer via the externally-published `@theokit/di` (in the `theokit-di` repo), NOT required of Harness features.

Full text: `/home/user/.claude/CLAUDE.md`. Cross-project rules: `/home/user/Projetos/usetheo/CLAUDE.md`.

## Checklist before changing public API

- [ ] Updated `docs.md` to reflect the new shape (it is the source of truth).
- [ ] Updated `README.md` if the change is user-visible.
- [ ] Added or updated tests covering the new contract (TDD: regression test first when fixing a bug).
- [ ] `CHANGELOG.md` entry under `[Unreleased]` in `packages/sdk/CHANGELOG.md` (or root `CHANGELOG.md` for workspace changes).
- [ ] No reference to "Theo IDE" or other surfaces that do not exist in the Theo stack.
- [ ] No promise of cloud-only features as GA.
- [ ] No silent integration claims with `@theokit/ui` or `theokit` — verify the import exists.
- [ ] No imports from any reference clone under `.claude/knowledge-base/reference/` — it is read-only study material.

## Pipeline de ciclos (plan ecosystem)

Instalado em `.claude/` via `bash scripts/install.sh` do template [`plan`](file:///home/user/Projetos/plan). Backup do `.claude/` anterior (skills `quality-review` + `to-reference`, rules `no-stubs-no-mocks-no-wired` + `real-llm-validation`, `quality-gates.md`, knowledge-base com architecture/hermes-deep-dive/specs/sdk-references/plans/discoveries/reviews/adrs) preservado em `.claude.previous.bak/`. O `CLAUDE.md` anterior preservado em `CLAUDE.md.bak`.

**Conteúdo SDK preservado no `.claude/` novo via merge seletivo** (~580 arquivos migrados):

- `rules/no-stubs-no-mocks-no-wired.md` + `rules/real-llm-validation.md` — políticas locais lado a lado com `rules/cycle-*.md` do plan.
- `quality-gates.md` (raiz) — contract de hard/soft/manual gates do SDK; referenciado pelo skill `quality-review`.
- `skills/quality-review/` + `skills/to-reference/` — coexistem com as 26 skills do plan.
- `knowledge-base/{architecture,hermes-deep-dive,specs,sdk-references,reference,plans,discoveries,reviews,adrs}/` — categorias `plans/discoveries/reviews/adrs` deram merge com as pastas semânticas do plan scaffold.

**Comandos disponíveis (plan + SDK):**

- **Plan**: `/grill-me`, `/to-plan`, `/edge-case-plan`, `/deps-audit`, `/plan-confidence`, `/plan-improve`
- **Discover**: `/discover-plan`, `/discover-edge-cases`, `/discover-plan-confidence`, `/discover-execute`, `/discover-confidence`, `/discover-improve`
- **Implement**: `/implement` (halt-loop RED → GREEN → REFACTOR → WIRING → COMMIT)
- **Quality**: `/code-quality` (plan, regex/threshold-based) + `/quality-review` (SDK, manual SOLID/Clean Code review pareado com `quality-gates.md`)
- **Review**: `/review` (plan, 5–7 specialist agents)
- **Release**: `/release` (develop→main PR + semver tag)
- **Honesty gate**: `/dogfood`
- **Orchestrator**: `/auto-plan {topic-slug}`
- **SDK-specific**: `/to-reference {topic}` (deep-dive nos clones sob `.claude/knowledge-base/reference/` → guia de implementação em `.claude/knowledge-base/reference/{topic}.md`)

**Hooks ativos** (`.claude/settings.json`): SessionStart, UserPromptSubmit, PreToolUse(Bash + Edit|Write), PostToolUse(linter + public-copy-lint), Stop (TDD + CHANGELOG gate), PreCompact (plan snapshot).

**Contratos**: `.claude/rules/cycle-*.md` (plan) + `.claude/rules/{no-stubs-no-mocks-no-wired,real-llm-validation}.md` (SDK policies) + `.claude/quality-gates.md` (SDK gate contract).

**Caminhos preservados** (não houve renomeação — referências internas do CLAUDE.md continuam válidas): `.claude/quality-gates.md`, `.claude/skills/quality-review/SKILL.md`, `.claude/rules/no-stubs-no-mocks-no-wired.md`, etc.

## When this file is wrong

The code is authoritative. If this file disagrees with the code, the code wins — update this file via PR with rationale in the commit message. Locked names and locked toolchain require an explicit decision; do not edit them silently.
