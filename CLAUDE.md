# CLAUDE.md — theokit-sdk

Contract between Claude and the **`@usetheo/sdk`** project (the **Harness** pillar of [usetheo](../CLAUDE.md)). Read this file **and** the root `CLAUDE.md` before editing anything here.

This file complements `/home/paulo/Projetos/usetheo/CLAUDE.md` and `/home/paulo/.claude/CLAUDE.md`. Root rules apply unconditionally. SDK-specific rules layer on top.

---

## What this project is

`@usetheo/sdk` is the **TypeScript SDK for the Theo agent harness**. It implements the public contract defined in [`./docs.md`](./docs.md) — `Agent.create()`, `Agent.send()`, `Run.stream()`, MCP servers, hooks, subagents — as a standalone TypeScript package.

The SDK is implemented from scratch, informed by reference projects under `./referencia/` (notably `pi` and the `openai-agents-python` SDK). The reference tree is read-only; we study it, we do not depend on it.

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
│   └── sdk/            # @usetheo/sdk — the publishable package
│       ├── src/
│       │   ├── index.ts         # public barrel
│       │   ├── agent.ts         # Agent façade (static class)
│       │   ├── theokit.ts       # Theokit namespace (static class)
│       │   ├── errors.ts        # Error class hierarchy
│       │   ├── types/           # Public type contract from docs.md
│       │   └── internal/        # Implementation details
│       └── tests/
└── referencia/         # Study material, NOT workspace members
    ├── pi/             # Fork of earendil-works/pi
    ├── cookbook/       # Pi's example recipes
    └── openai-agents-python/   # OpenAI Agents Python SDK
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
| npm package | `@usetheo/sdk` | Under the `@usetheo` scope, alongside `@usetheo/ui`. |
| Env var (API key) | `THEOKIT_API_KEY` | All SDK env vars namespace under `THEOKIT_` to leave `THEO_` available for future Theo PaaS tooling. |
| API namespace object | `Theokit` | E.g. `Theokit.me()`, `Theokit.models.list()`, `Theokit.repositories.list()`. |
| Error base class | `TheokitAgentError` | All errors extend this. |
| Local agent ID prefix | `agent-` | Per `docs.md`. |
| Cloud agent ID prefix | `bc-` | Used to auto-detect runtime in `Agent.resume()` / `Agent.get()`. |
| Project config dir | `.theokit/` | `.theokit/mcp.json`, `.theokit/hooks.json`, `.theokit/agents/*.md`, `.theokit/cron/jobs.json`. |
| User config dir | `~/.theokit/` | `~/.theokit/mcp.json`, `~/.theokit/hooks.json`. |
| Pagination cursor field | `nextCursor` | Renamed from the `nextTheo` placeholder in the original `docs.md`. |
| Top-level API namespaces | `Agent`, `Cron`, `Theokit` | Static classes with private constructors. |

> **Naming note.** The agent itself is "the Theo agent" in prose (matches the locked usetheo narrative). The **SDK surface** uses the `Theokit` prefix for consistency with the env var and project name. Two different things — don't collapse them.

## Locked toolchain

Resolved 2026-05-14 with research backing in [the SOTA validation report](#sota-validation-report) (background-agent output captured in the conversation). Changing any of these is a strategic decision, not a refactor.

| Layer | Choice | Version | Rationale |
| --- | --- | --- | --- |
| Package manager | pnpm | `9.15.0` (via corepack) | Matches sibling `theokit` project; pnpm workspaces are the 2026 standard for TS monorepos. |
| Node runtime | Node | `>=22.12.0` (`.nvmrc` pins minimum) | Node 20 reached EOL April 2026. Use `nvm use` to switch. |
| Build | tsup | `^8.5.0` | Vercel AI ships on tsup. tsdown is the migration path once mature. |
| TypeScript | tsc | `^5.8.0` strict | TS 7 (tsgo) is beta as of April 2026 — do NOT use for emit. |
| Package format | Dual ESM + CJS | — | Stripe / Anthropic SDK / OpenAI SDK still ship dual in 2026. |
| Test | Vitest | `^3.0.0` | Confirmed across MCP SDK, Vercel AI, OpenAI Agents. |
| Lint + format | Biome | `^2.4.0` | Single tool; greenfield choice. ESLint still incumbent in older SDKs. |
| Versioning | Changesets | `^2.31.0` | Standard for pnpm monorepos publishing to npm. |
| Validation | publint + `@arethetypeswrong/cli` | Standard 2026 stack | No credible alternative. |
| Runtime validation | Zod | peer dep `^3.25 \|\| ^4` | Matches Anthropic / OpenAI / Vercel pattern. Optional peer. |
| HTTP | Native `fetch` | — | Anthropic and OpenAI SDKs migrated off `node-fetch`. Expose injectable `fetch` option. |
| Streaming | `AsyncGenerator` of discriminated `SDKMessage` | — | Matches `@anthropic-ai/claude-agent-sdk`. |
| Resource disposal | `dispose()` method + `[Symbol.asyncDispose]` (implementation-side) | — | Skeleton interface uses `dispose()` until lib bump to `ESNext.Disposable`. |

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

- "Harness pillar of usetheo" — the SDK is the harness, not the framework (TheoKit) and not the runtime (Theo PaaS).
- "Open stack underneath" — the load-bearing differentiator. Apache-2.0 SDK, Apache-2.0 local runtime via `pi/`, multi-provider keys, opt-in cloud, walk-away cost zero.
- "Pre-release honesty" — cloud runtime depends on Theo PaaS, currently pre-release. Cloud-only features must be labeled.
- "No invented integration" — never claim wiring with other usetheo pillars that does not yet exist (Cross-Project Rule 2).

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
| UI | `@usetheo/ui` | None as of 2026-05-14 | Web chat surfaces may consume `@usetheo/ui` primitives later. |
| Skills | `theokit` | None as of 2026-05-14 | `theokit` README mentions an "agent layer" — that integration lands here. |
| Runtime | Theo PaaS | None (PaaS pre-release) | Cloud runtime endpoint is Theo PaaS. |

> "Do not invent integration that does not exist yet." (Root `CLAUDE.md` rule 2.)
>
> Verify the actual import / dependency before claiming wiring exists in copy or in examples. `grep` first, claim second.

## Working with `referencia/`

`./referencia/` is **read-only study material** for the SDK implementation. It is not part of the pnpm workspace, not imported, and never modified from this project.

Reference projects currently present:

- **`referencia/pi/`** — fork of [`earendil-works/pi`](https://github.com/earendil-works/pi). Primary inspiration for `pi-agent-core` (Agent runtime), `pi-ai` (multi-provider LLM API), and `pi-coding-agent` (CLI patterns).
- **`referencia/cookbook/`** — Pi's example recipes. Useful for understanding intended API ergonomics.
- **`referencia/openai-agents-python/`** — OpenAI Agents Python SDK. Useful for `Agent` / `Run` / streaming API design.

Rules when consulting `referencia/`:

1. **Read, do not run.** Reference projects have their own dependencies, lockfiles, and engines. Do not `npm install` or `pip install` inside `referencia/`. If you need to run them, do so outside this repo.
2. **Never edit.** If you find a bug in a reference project, file it upstream or note it in our `docs.md` rationale. Do not patch.
3. **Cite when borrowing patterns.** When the SDK implementation copies a pattern from a reference, add a code comment: `// referencia: pi/packages/agent/src/foo.ts` so future maintainers can trace the lineage.
4. **No transitive dependencies.** The SDK must not import from `referencia/*`. If you find yourself wanting to, you are wrapping rather than implementing — surface the decision (see Open Decisions).

`biome.json` and `pnpm-workspace.yaml` exclude `referencia/`. Do not change those exclusions silently.

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

Architectural decisions are tracked in [`./.claude/knowledge-base/adrs/`](./.claude/knowledge-base/adrs/). Every decision was previously a `Pending` row in this table; each is now committed with rationale + date.

| ID | Decision | ADR |
| --- | --- | --- |
| D1 | Node 22.12+ mandatory in CI + local | [D01-node-22-mandatory.md](./.claude/knowledge-base/adrs/D01-node-22-mandatory.md) |
| D2 | Knip full mode enforced strictly | [D02-knip-strict.md](./.claude/knowledge-base/adrs/D02-knip-strict.md) |
| D3 | `pi` stays stand-alone (no vendor, no workspace-link) | [D03-pi-standalone.md](./.claude/knowledge-base/adrs/D03-pi-standalone.md) |
| D4 | Model catalog source-of-truth = `Theokit.models.list()` | [D04-model-catalog.md](./.claude/knowledge-base/adrs/D04-model-catalog.md) |
| D5 | Adopt `Symbol.asyncDispose` on `SDKAgent` | [D05-symbol-async-dispose.md](./.claude/knowledge-base/adrs/D05-symbol-async-dispose.md) |
| D6 | `pnpm validate` strict on publint AND attw | [D06-validate-strictness.md](./.claude/knowledge-base/adrs/D06-validate-strictness.md) |
| D7 | `croner` locked as cron scheduler library | [D07-croner-scheduler.md](./.claude/knowledge-base/adrs/D07-croner-scheduler.md) |
| D8 | Cron persistence = JSON file with atomic write | [D08-cron-persistence-json.md](./.claude/knowledge-base/adrs/D08-cron-persistence-json.md) |
| D9 | Memory namespace/scope defaults locked | [D09-memory-namespace-defaults.md](./.claude/knowledge-base/adrs/D09-memory-namespace-defaults.md) |
| D10 | Skills frontmatter strict schema (Zod) | [D10-skills-frontmatter-schema.md](./.claude/knowledge-base/adrs/D10-skills-frontmatter-schema.md) |
| D11 | Embedding adapters: openai/mistral/openrouter/voyage/deepinfra shipped; lmstudio/google/bedrock deferred | [D11-embedding-adapters-shipped.md](./.claude/knowledge-base/adrs/D11-embedding-adapters-shipped.md) |
| D12 | LanceDB backend deferred to v1.1 | [D12-lancedb-deferred.md](./.claude/knowledge-base/adrs/D12-lancedb-deferred.md) |
| D13 | Active Memory subagent mode deferred to v1.1 | [D13-active-memory-subagent-deferred.md](./.claude/knowledge-base/adrs/D13-active-memory-subagent-deferred.md) |
| D14 | Dreaming narrative LLM deferred to v1.1 | [D14-dreaming-narrative-deferred.md](./.claude/knowledge-base/adrs/D14-dreaming-narrative-deferred.md) |
| D22 | `Agent.getOrCreate` semantics (try resume → fallback create, EC-1 race retry) | [D22-agent-getorcreate-semantics.md](./.claude/knowledge-base/adrs/D22-agent-getorcreate-semantics.md) |
| D23 | `createAgentFactory` merge strategy (deep-merge local/memory/cloud, replace tools/mcp/agents) | [D23-agentfactory-merge-strategy.md](./.claude/knowledge-base/adrs/D23-agentfactory-merge-strategy.md) |
| D24 | `defineTool` schema source = Zod peer dep + feature-detected JSON Schema conversion | [D24-definetool-zod-source.md](./.claude/knowledge-base/adrs/D24-definetool-zod-source.md) |
| D25 | `Agent.builder()` API shape = fluent mutable chain with delegated validation | [D25-agent-builder-api-shape.md](./.claude/knowledge-base/adrs/D25-agent-builder-api-shape.md) |
| D26 | Cloud agent parity for all 4 DX helpers (reuse `validateAgentOptions` single point) | [D26-helpers-cloud-parity.md](./.claude/knowledge-base/adrs/D26-helpers-cloud-parity.md) |
| D32 | `@usetheo/react` as separate workspace package + Vercel Data Stream v1 wire format | [D32-react-package-separation.md](./.claude/knowledge-base/adrs/D32-react-package-separation.md) |
| D33 | `Agent.generateObject` via synthetic forced tool (Zod-driven) | [D33-generateobject-via-synthetic-tool.md](./.claude/knowledge-base/adrs/D33-generateobject-via-synthetic-tool.md) |
| D34 | Telemetry: OTel spans, privacy-by-default, lazy load + safe() wrapper | [D34-telemetry-otel-privacy-default.md](./.claude/knowledge-base/adrs/D34-telemetry-otel-privacy-default.md) |
| D35 | Validation rubric: quantitative metrics per pillar | [D35-validation-rubric-quantitative.md](./.claude/knowledge-base/adrs/D35-validation-rubric-quantitative.md) |
| D36 | Second chat bot example = CLI-bot (no Discord/Slack external infra) | [D36-second-chat-bot-cli.md](./.claude/knowledge-base/adrs/D36-second-chat-bot-cli.md) |
| D37 | Chaos test methodology: bash + Node child process + SIGKILL injection | [D37-chaos-test-methodology.md](./.claude/knowledge-base/adrs/D37-chaos-test-methodology.md) |
| D38 | SSE wire format = Vercel AI Data Stream v1 (compat, no `ai` dep at runtime) | [D38-sse-wire-format-vercel-compat.md](./.claude/knowledge-base/adrs/D38-sse-wire-format-vercel-compat.md) |
| D39 | `Agent.streamObject<T>` retorna AsyncIterator com partial+complete events | [D39-stream-object-async-iterator.md](./.claude/knowledge-base/adrs/D39-stream-object-async-iterator.md) |
| D40 | React hooks family: 3 hooks separados (useTheoChat + useTheoCompletion + useTheoAssistant) | [D40-react-hooks-family-separate.md](./.claude/knowledge-base/adrs/D40-react-hooks-family-separate.md) |
| D41 | OAuth 2.1 PKCE para MCP HTTP + token storage com keychain fallback | [D41-oauth-mcp-pkce-keychain.md](./.claude/knowledge-base/adrs/D41-oauth-mcp-pkce-keychain.md) |
| D42 | Auto-instrumentation Langfuse/Sentry/PostHog via createRequire feature-detect | [D42-auto-instrumentation-feature-detect.md](./.claude/knowledge-base/adrs/D42-auto-instrumentation-feature-detect.md) |
| D43 | LanceDB backend para Memory.index atrás da mesma interface | [D43-lance-backend-same-interface.md](./.claude/knowledge-base/adrs/D43-lance-backend-same-interface.md) |
| D44 | Migration SQLite → Lance é CLI standalone (`theokit-migrate-memory`) | [D44-migration-cli-standalone.md](./.claude/knowledge-base/adrs/D44-migration-cli-standalone.md) |
| D45 | `SDKObjectDelta` é variant de SDKMessage + wire codes `o:`/`O:` | [D45-sdkobjectdelta-message-variant.md](./.claude/knowledge-base/adrs/D45-sdkobjectdelta-message-variant.md) |
| D46 | Cross-agent shared memory diferido para v1.3 | [D46-cross-agent-memory-deferred.md](./.claude/knowledge-base/adrs/D46-cross-agent-memory-deferred.md) |
| D47 | React examples são apps Next.js standalone (App Router) | [D47-react-examples-nextjs-standalone.md](./.claude/knowledge-base/adrs/D47-react-examples-nextjs-standalone.md) |
| D48 | Examples com creds opcionais usam config-only mode sem creds | [D48-creds-optional-config-only-mode.md](./.claude/knowledge-base/adrs/D48-creds-optional-config-only-mode.md) |
| D49 | React example consolidado (1 app, 3 rotas) ao invés de 3 apps separados | [D49-consolidated-react-example.md](./.claude/knowledge-base/adrs/D49-consolidated-react-example.md) |
| D50 | LanceDB example default = dry-run + graceful degradation sem módulo | [D50-lance-example-dry-run-default.md](./.claude/knowledge-base/adrs/D50-lance-example-dry-run-default.md) |
| D51 | `tools/typecheck-examples.sh` continua descobrindo examples via glob | [D51-typecheck-examples-glob-discovery.md](./.claude/knowledge-base/adrs/D51-typecheck-examples-glob-discovery.md) |
| D52 | Streaming incremental no Telegram via editMessageText throttled em 500ms | [D52-telegram-streaming-throttle-500ms.md](./.claude/knowledge-base/adrs/D52-telegram-streaming-throttle-500ms.md) |
| D53 | `/stream` mode é runtime toggle em memória (não filesystem) | [D53-stream-mode-runtime-toggle.md](./.claude/knowledge-base/adrs/D53-stream-mode-runtime-toggle.md) |
| D54 | OAuth MCP no telegram-pro depende de token cache (não dirige flow via bot) | [D54-oauth-mcp-token-cached-only.md](./.claude/knowledge-base/adrs/D54-oauth-mcp-token-cached-only.md) |
| D55 | Auto-instrumentation no telegram-pro é "fail-open" | [D55-autoinstrument-fail-open.md](./.claude/knowledge-base/adrs/D55-autoinstrument-fail-open.md) |
| D56 | `/memory_lance` é demo isolado em tmpdir (NUNCA toca dados reais do bot) | [D56-memory-lance-demo-isolated-tmpdir.md](./.claude/knowledge-base/adrs/D56-memory-lance-demo-isolated-tmpdir.md) |
| D57 | `/skill <name>` lê filesystem direto, NÃO via LLM tool flow | [D57-skill-drilldown-filesystem-direct.md](./.claude/knowledge-base/adrs/D57-skill-drilldown-filesystem-direct.md) |
| D58 | Streaming usa texto cru; `splitForTelegram` só no final | [D58-stream-vs-final-split-strategy.md](./.claude/knowledge-base/adrs/D58-stream-vs-final-split-strategy.md) |
| D59 | `internal/persistence/` is the home for cross-cutting state primitives | [D59-internal-persistence-home.md](./.claude/knowledge-base/adrs/D59-internal-persistence-home.md) |
| D60 | `getTheokitHome(cwd)` retorna `THEOKIT_HOME` env OR `join(cwd, ".theokit")` | [D60-get-theokit-home-strategy.md](./.claude/knowledge-base/adrs/D60-get-theokit-home-strategy.md) |
| D61 | Cross-process file lock via `proper-lockfile` optional peer dep + companion lockfile | [D61-proper-lockfile-optional-peer.md](./.claude/knowledge-base/adrs/D61-proper-lockfile-optional-peer.md) |
| D62 | Schema versioning helpers — SQLite `user_version` + JSON `_schemaVersion` envelope, forward-only | [D62-schema-versioning-helpers.md](./.claude/knowledge-base/adrs/D62-schema-versioning-helpers.md) |
| D63 | SQLite WAL with DELETE journal fallback on NFS/SMB/FUSE | [D63-sqlite-wal-delete-fallback.md](./.claude/knowledge-base/adrs/D63-sqlite-wal-delete-fallback.md) |
| D64 | FTS5 6-step sanitizer + CJK auto-detection (trigram routing deferred to v1.4) | [D64-fts5-sanitizer-cjk-deferred.md](./.claude/knowledge-base/adrs/D64-fts5-sanitizer-cjk-deferred.md) |
| D65 | `ErrorMetadata` is optional field on the existing base class (no new hierarchy) | [D65-error-metadata-optional-field.md](./.claude/knowledge-base/adrs/D65-error-metadata-optional-field.md) |
| D66 | `ErrorCode` is a finite TS literal union for exhaustive `switch` checks | [D66-error-code-typed-enum.md](./.claude/knowledge-base/adrs/D66-error-code-typed-enum.md) |
| D67 | Provider HTTP error mappers in `internal/errors/mappers/` (1 per dialect) | [D67-provider-error-mappers.md](./.claude/knowledge-base/adrs/D67-provider-error-mappers.md) |

Open question that remained:
- **Supported cloud SCM providers at GA** — out of scope for v1.0 because cloud runtime is pre-release. Will be decided alongside Theo PaaS release.

## SDK Patterns Roadmap

Curated patterns from `referencia/hermes-agent/` (and other study materials)
filtered to **SDK scope only**. Detailed picks in
[`.claude/knowledge-base/sdk-references/`](./.claude/knowledge-base/sdk-references/)
(23 docs, 276KB). Status auditado contra `packages/sdk/src/` em 2026-05-18.

Status legend: ✅ DONE · ⚠️ PARTIAL · ❌ PENDING · 📚 CULTURAL

### Persistence & state (6) — ✅ Persistence-State-Hardening plan COMPLETED 2026-05-18

| Pattern | Status | Where in SDK |
|---|---|---|
| atomic-write-pattern | ✅ DONE | `packages/sdk/src/internal/persistence/atomic-write.ts` — `atomicWriteJson<T>` typed helper with auto-mkdir (EC-4 fix). Migrated callers: agent-registry, transcript-store, token-storage. |
| file-lock-pattern | ✅ DONE | `packages/sdk/src/internal/persistence/file-lock.ts` — `withFileLock` cross-process via `proper-lockfile` peer dep + companion lockfile (EC-1 fix) + in-process cwd-mutex bridge. Optional peer-dep gracefully degrades. |
| profile-isolation | ✅ DONE | `packages/sdk/src/internal/persistence/paths.ts` — `getTheokitHome(cwd)` honours `THEOKIT_HOME` env var; vitest autouse setup isolates per-test tmpdir; lint test gates `.theokit` literal regressions. |
| schema-versioning | ✅ DONE | `packages/sdk/src/internal/persistence/schema-version.ts` — `migrateSchema` (SQLite `PRAGMA user_version`) + `readVersionedJson` / `writeVersionedJson` (JSON envelope with EC-2 full-parsed migrate callback). Agent registry migrated. |
| sqlite-wal-fallback | ✅ DONE | `packages/sdk/src/internal/persistence/sqlite-wal.ts` — `applyWalWithFallback(db, label)` with DELETE fallback for NFS/SMB. Wired in `internal/memory/index-db.ts`. |
| fts5-sanitization | ✅ DONE | `packages/sdk/src/internal/persistence/fts5-sanitize.ts` — 6-step `sanitizeFts5Query` + `containsCjk` detection. EC-3 empty-string short-circuit applied in `internal/memory/index-manager.ts`. |

### Agent core loop (3)

| Pattern | Status | Where in SDK |
|---|---|---|
| prompt-cache-discipline | 📚 CULTURAL | `Agent.send` precisa enforcing `readonly` + `invalidateCache` API |
| tool-call-failure-recovery | ❌ PENDING | `internal/tool-dispatch/repair-middleware.ts` (a criar) |
| compression-death-spiral | ❌ PENDING | `internal/runtime/budget.ts` com `IterationBudget` cap (a criar) |

### Plugin & extension (3)

| Pattern | Status | Where in SDK |
|---|---|---|
| plugin-contract-design | ❌ PENDING | `internal/plugins/manager.ts` + `Plugin` interface (a criar) |
| tool-registry-pattern | ⚠️ PARTIAL | `defineTool` (D24) existe; falta `ToolRegistry` + `Toolset` |
| provider-as-plugin | ❌ PENDING | Providers hardcoded; migrar para `ProviderProfile` lazy discovery |

### Background work (3)

| Pattern | Status | Where in SDK |
|---|---|---|
| forked-agent-pattern | ❌ PENDING | `internal/runtime/fork-agent.ts` (a criar) |
| async-iterable-streaming | ⚠️ PARTIAL | `Agent.streamObject` (D39) usa; falta `Agent.runUntil(goal)` |
| judge-call-pattern | ❌ PENDING | `internal/judge/` (a criar) |

### Security (3)

| Pattern | Status | Where in SDK |
|---|---|---|
| secret-redaction-discipline | ❌ PENDING | `internal/security/redact.ts` com prefix list + env snapshot |
| path-traversal-vectors | ❌ PENDING | `internal/security/path-guard.ts` (a criar) |
| toctou-race-prevention | ⚠️ PARTIAL | `cwd-mutex.ts` cobre in-process; `withFileLock` (D61) cobre multi-process via `proper-lockfile` + companion lockfile; ainda falta CAS patterns SQLite + O_EXCL idiomático |

### Testing (3)

| Pattern | Status | Where in SDK |
|---|---|---|
| testing-invariant-vs-snapshot | 📚 CULTURAL | Já praticado (sem `toMatchSnapshot`); manter via code review |
| hermetic-test-isolation | ✅ DONE | `packages/sdk/vitest.setup.ts` autouse beforeEach/afterEach isola `THEOKIT_HOME` em tmpdir per-test (T6.1, ADR D60). `setupFiles` wired em `vitest.config.ts`. Lint test em `tests/lint/no-hardcoded-theokit-path.test.ts` audita regressões. |
| property-based-testing | ❌ PENDING | Adicionar `fast-check` dev dep + property tests |

### Error handling (2) — ✅ Error Context Surfacing plan COMPLETED 2026-05-18

| Pattern | Status | Where in SDK |
|---|---|---|
| error-context-surfacing | ✅ DONE | `packages/sdk/src/errors.ts` — `ErrorMetadata` + `ErrorCode` types (ADR D65/D66). Provider mappers `mapAnthropicError` + `mapOpenAICompatibleError` (ADR D67) in `internal/errors/mappers/`. Wired in `internal/llm/anthropic.ts`, `internal/llm/openai.ts`, `internal/memory/adapters/openai-compatible.ts`. `fallback-client.ts` also falls back on `AuthenticationError`/`RateLimitError`. |
| graceful-degradation | ✅ DONE | ADR D42 (auto-detect telemetry), D50 (lance dry-run), D55 (fail-open) implementados |

### Totais (2026-05-18 — pós Error Context Surfacing plan)

```
✅ DONE         9 (39%)
⚠️ PARTIAL      3 (13%)
❌ PENDING      9 (39%)
📚 CULTURAL    2  (9%)
              ───
              23 (100%)
```

- **Persistence & State block: 6/6 DONE** (was 0 DONE / 5 PARTIAL / 1 PENDING at v1.2).
- **Testing block: 1/3 DONE + 1/3 CULTURAL** — hermetic-test-isolation landed via T6.1 (vitest.setup.ts + setupFiles). property-based ainda pending (precisa `fast-check` dev dep).
- **Error handling block: 2/2 DONE** — graceful-degradation via D42/D50/D55; error-context-surfacing via D65/D66/D67 (ErrorMetadata + ErrorCode + provider mappers).

> **Importante**: este é mapa, não plano. Não há commitment de implementar
> todos os PENDING — cada um é proposta que precisa de ADR + plano formal
> antes de wirar. Hermes Agent (`referencia/hermes-agent/`) continua sendo
> **read-only study material** (per "Working with `referencia/`" rule
> acima). Theokit-SDK não tem ambição de paridade Hermes-equivalent;
> compara-se a Vercel AI / Mastra / Claude Agent SDK.

## Inviolable rules (carried from root and global)

1. **95% confidence gate.** Stop and ask if uncertain.
2. **Task completion gate.** Finish the previous task 100% before starting a new one.
3. **Extreme honesty.** Admit ignorance. Surface risks.
4. **Git rules.** No `git checkout` or `git revert`. No direct work on `main`.
5. **TDD.** Tests before production code. Bug fixes start with a regression test.
6. **Changelog discipline.** Every code change updates `CHANGELOG.md` (workspace-level at root; per-package at `packages/<name>/CHANGELOG.md`).
7. **Don't reinvent.** Prefer mature libraries — the toolchain table above already does this.
8. **No emojis** in code, READMEs, or CLAUDE.md files unless explicitly requested.

Full text: `/home/paulo/.claude/CLAUDE.md`. Cross-project rules: `/home/paulo/Projetos/usetheo/CLAUDE.md`.

## Checklist before changing public API

- [ ] Updated `docs.md` to reflect the new shape (it is the source of truth).
- [ ] Updated `README.md` if the change is user-visible.
- [ ] Added or updated tests covering the new contract (TDD: regression test first when fixing a bug).
- [ ] `CHANGELOG.md` entry under `[Unreleased]` in `packages/sdk/CHANGELOG.md` (or root `CHANGELOG.md` for workspace changes).
- [ ] No reference to "Theo IDE" or other surfaces that do not exist in the usetheo stack.
- [ ] No promise of cloud-only features as GA.
- [ ] No silent integration claims with `@usetheo/ui` or `theokit` — verify the import exists.
- [ ] No imports from `referencia/*` — that tree is read-only study material.

## When this file is wrong

The code is authoritative. If this file disagrees with the code, the code wins — update this file via PR with rationale in the commit message. Locked names and locked toolchain require an explicit decision; do not edit them silently.
