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

## Native bindings discipline

Some dependencies ship native binaries (currently: `better-sqlite3`). Each is compiled against a specific Node.js ABI (`NODE_MODULE_VERSION`). When the installed Node version differs from the ABI the binary was built against, every `require()` of that module throws `Module did not self-register` or `NODE_MODULE_VERSION X required, got Y`.

**How we prevent this:**

1. `engines.node = ">=22.12.0"` in every package.json — pnpm warns on mismatch (does NOT block).
2. `.nvmrc` pins the canonical Node version — `nvm use` switches.
3. `tools/preflight-native-bindings.mjs` runs as the SDK's vitest setup — detects ABI mismatch + auto-rebuilds (one-shot, sentinel-cached at `node_modules/.cache/preflight-native-{abi}.ok`).
4. CI workflows ship an explicit `pnpm rebuild better-sqlite3 --workspace-root` step before tests (defense in depth).

**If you hit the error locally:**
- First: `nvm use` (or `nvm install` if you don't have the pinned version). 95% of cases.
- If you can't switch Node: `pnpm rebuild better-sqlite3 --filter @usetheo/sdk`. The preflight does this automatically on first test run.
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
| D68 | Canonical `redactSecrets` in `internal/security/redact.ts`, single source of truth (replaces 2 duplicates) | [D68-redact-canonical-module.md](./.claude/knowledge-base/adrs/D68-redact-canonical-module.md) |
| D69 | `THEOKIT_REDACT_SECRETS` env var snapshotted at module init (prompt-injection defense) | [D69-redact-env-snapshot.md](./.claude/knowledge-base/adrs/D69-redact-env-snapshot.md) |
| D70 | Redaction ON by default; opt-out emits one-time stderr warning | [D70-redact-on-by-default.md](./.claude/knowledge-base/adrs/D70-redact-on-by-default.md) |
| D71 | Two-bucket masking: short tokens (<18) → `***`; long → `prefix...suffix` | [D71-redact-two-bucket-masking.md](./.claude/knowledge-base/adrs/D71-redact-two-bucket-masking.md) |
| D72 | `codeFile: true` opt-out skips PARAM_PATTERN to preserve `.env.example` placeholders | [D72-redact-codefile-optout.md](./.claude/knowledge-base/adrs/D72-redact-codefile-optout.md) |
| D73 | Apply redaction at OUTPUT boundaries (logs, telemetry attrs, error.raw, transcript), NOT at storage | [D73-redact-output-boundaries-only.md](./.claude/knowledge-base/adrs/D73-redact-output-boundaries-only.md) |
| D74 | User-edited configs migrate to markdown + YAML frontmatter (espelha SKILL.md / Claude Code) | [D74-config-markdown-format.md](./.claude/knowledge-base/adrs/D74-config-markdown-format.md) |
| D75 | 1 file = 1 entity (não 1 file = N entities); disable-by-rename | [D75-one-file-one-entity.md](./.claude/knowledge-base/adrs/D75-one-file-one-entity.md) |
| D76 | Frontmatter validado por Zod schema (mesmo pattern de D10) | [D76-frontmatter-zod-schema.md](./.claude/knowledge-base/adrs/D76-frontmatter-zod-schema.md) |
| D77 | Loader fallback: MD-dir primeiro, JSON com deprecation warn (sunset v2.0 Q2 2027) | [D77-md-first-json-fallback.md](./.claude/knowledge-base/adrs/D77-md-first-json-fallback.md) |
| D78 | `theokit-migrate-config` CLI standalone com atomic write + timestamped backup | [D78-migrate-config-cli.md](./.claude/knowledge-base/adrs/D78-migrate-config-cli.md) |
| D79 | `internal/security/path-guard.ts` is the canonical module for path defense | [D79-path-guard-canonical-module.md](./.claude/knowledge-base/adrs/D79-path-guard-canonical-module.md) |
| D80 | `safePathJoin` resolves THEN prefix-checks (defeats normalized escape) | [D80-resolve-then-prefix-check.md](./.claude/knowledge-base/adrs/D80-resolve-then-prefix-check.md) |
| D81 | `sanitizeIdentifier` strict grammar `^[a-z0-9][a-z0-9-_]*$` | [D81-sanitize-identifier-grammar.md](./.claude/knowledge-base/adrs/D81-sanitize-identifier-grammar.md) |
| D82 | `createExclusive` via O_EXCL with default mode 0o600 | [D82-create-exclusive-o-excl.md](./.claude/knowledge-base/adrs/D82-create-exclusive-o-excl.md) |
| D83 | `casUpdate` SQLite optimistic compare-and-swap helper | [D83-sqlite-cas-helper.md](./.claude/knowledge-base/adrs/D83-sqlite-cas-helper.md) |
| D84 | Path-guard wiring is opt-in via explicit refactor (no monkey-patch) | [D84-path-guard-opt-in-refactor.md](./.claude/knowledge-base/adrs/D84-path-guard-opt-in-refactor.md) |
| D85 | CI lint gate uses grep regex (not AST) — same pattern as no-unredacted-sink | [D85-lint-grep-not-ast.md](./.claude/knowledge-base/adrs/D85-lint-grep-not-ast.md) |
| D86 | `internal/tool-dispatch/` is the new home for repair + strip-think + dispatch | [D86-tool-dispatch-module-home.md](./.claude/knowledge-base/adrs/D86-tool-dispatch-module-home.md) |
| D87 | `repairToolCall` applies 3 idempotent repairs sequentially | [D87-repair-three-sequential-idempotent.md](./.claude/knowledge-base/adrs/D87-repair-three-sequential-idempotent.md) |
| D88 | Repair does NOT do fuzzy tool name matching | [D88-no-fuzzy-tool-name-match.md](./.claude/knowledge-base/adrs/D88-no-fuzzy-tool-name-match.md) |
| D89 | Tool errors return as `tool_result isError: true`, never throw | [D89-tool-errors-as-iserror-not-throw.md](./.claude/knowledge-base/adrs/D89-tool-errors-as-iserror-not-throw.md) |
| D90 | `IterationBudget` is a stateful class, not a POJO | [D90-iteration-budget-stateful-class.md](./.claude/knowledge-base/adrs/D90-iteration-budget-stateful-class.md) |
| D91 | Compression cap default 3, grace call default 1 | [D91-compression-cap-defaults.md](./.claude/knowledge-base/adrs/D91-compression-cap-defaults.md) |
| D92 | Compression must reduce ≥10% tokens or throw `CompressionIneffectiveError` | [D92-compression-10-percent-reduction-floor.md](./.claude/knowledge-base/adrs/D92-compression-10-percent-reduction-floor.md) |
| D93 | `validateResponse` detects empty-content + zero-toolCalls as bailout | [D93-empty-response-detection.md](./.claude/knowledge-base/adrs/D93-empty-response-detection.md) |
| D94 | `Agent.invalidateCache(reason, options?)` defaults to deferred | [D94-invalidate-cache-deferred-default.md](./.claude/knowledge-base/adrs/D94-invalidate-cache-deferred-default.md) |
| D95 | Cache-discipline guard runs only in dev mode (`shouldGuard()` function) | [D95-cache-discipline-guard-dev-only.md](./.claude/knowledge-base/adrs/D95-cache-discipline-guard-dev-only.md) |
| D96 | Strip `<think>` blocks before appending to message history | [D96-strip-think-before-history.md](./.claude/knowledge-base/adrs/D96-strip-think-before-history.md) |
| D97 | `internal/plugins/` is the canonical home for the Plugin contract | [D97-plugins-internal-home.md](./.claude/knowledge-base/adrs/D97-plugins-internal-home.md) |
| D98 | `Plugin` is a discriminated union by `kind` | [D98-plugin-discriminated-union.md](./.claude/knowledge-base/adrs/D98-plugin-discriminated-union.md) |
| D99 | `PluginContext` is sealed via Proxy in dev mode | [D99-plugin-context-sealed.md](./.claude/knowledge-base/adrs/D99-plugin-context-sealed.md) |
| D100 | `HookName` is a closed enum (8 fixed hooks) | [D100-hook-name-enum-fechado.md](./.claude/knowledge-base/adrs/D100-hook-name-enum-fechado.md) |
| D101 | `pre_tool_call` veto returns `{ block: true, message }`, never throws | [D101-pre-tool-call-veto.md](./.claude/knowledge-base/adrs/D101-pre-tool-call-veto.md) |
| D102 | `ToolRegistry` is 3-layer (registration / exposure / availability) | [D102-tool-registry-3-layers.md](./.claude/knowledge-base/adrs/D102-tool-registry-3-layers.md) |
| D103 | `check_fn` results TTL-cached for 30 seconds | [D103-check-fn-ttl-cache.md](./.claude/knowledge-base/adrs/D103-check-fn-ttl-cache.md) |
| D104 | `Toolset` is a flat list; no `extends` | [D104-toolset-flat-no-extends.md](./.claude/knowledge-base/adrs/D104-toolset-flat-no-extends.md) |
| D105 | `ProviderProfile` is data-only, not an ABC | [D105-provider-profile-data-only.md](./.claude/knowledge-base/adrs/D105-provider-profile-data-only.md) |
| D106 | Transport is orthogonal to Profile via `apiMode` | [D106-transport-abc-orthogonal.md](./.claude/knowledge-base/adrs/D106-transport-abc-orthogonal.md) |
| D107 | Provider discovery is lazy + last-writer-wins (with WARN) | [D107-provider-lazy-discovery.md](./.claude/knowledge-base/adrs/D107-provider-lazy-discovery.md) |
| D108 | V1.2 caller API is preserved byte-by-byte | [D108-v12-api-preserved.md](./.claude/knowledge-base/adrs/D108-v12-api-preserved.md) |
| D109 | Refactor is incremental, not big-bang | [D109-incremental-refactor.md](./.claude/knowledge-base/adrs/D109-incremental-refactor.md) |
| D110 | `internal/runtime/fork-agent.ts` is the canonical fork primitive | [D110-fork-agent-canonical-home.md](./.claude/knowledge-base/adrs/D110-fork-agent-canonical-home.md) |
| D111 | Tool whitelist propagated via `AsyncLocalStorage`, never global mutable | [D111-async-local-storage-whitelist.md](./.claude/knowledge-base/adrs/D111-async-local-storage-whitelist.md) |
| D112 | Fork inherits parent system prompt byte-identical (cache hit) | [D112-byte-identical-system-prompt.md](./.claude/knowledge-base/adrs/D112-byte-identical-system-prompt.md) |
| D113 | Forks effectively auto-deny approval-requiring tools | [D113-auto-deny-approval-fork.md](./.claude/knowledge-base/adrs/D113-auto-deny-approval-fork.md) |
| D114 | Memory write provenance via `metadata.forkOrigin` | [D114-memory-write-provenance.md](./.claude/knowledge-base/adrs/D114-memory-write-provenance.md) |
| D115 | `GoalEvent` is a discriminated union by `type` | [D115-goal-event-discriminated-union.md](./.claude/knowledge-base/adrs/D115-goal-event-discriminated-union.md) |
| D116 | `Agent.runUntil` returns `AsyncGenerator<GoalEvent, GoalResult, void>` | [D116-run-until-async-generator.md](./.claude/knowledge-base/adrs/D116-run-until-async-generator.md) |
| D117 | `runUntil` integrates `AbortSignal` at turn boundaries (EC-C: pre-abort yields paused only) | [D117-abort-signal-integration.md](./.claude/knowledge-base/adrs/D117-abort-signal-integration.md) |
| D118 | Goal control via caller-supplied AbortController, not instance methods | [D118-pause-clear-goal-instance-methods.md](./.claude/knowledge-base/adrs/D118-pause-clear-goal-instance-methods.md) |
| D119 | Judge default `openai/gpt-4o-mini` via `OPENROUTER_API_KEY` (EC-A single env source) | [D119-judge-model-default-gpt-4o-mini.md](./.claude/knowledge-base/adrs/D119-judge-model-default-gpt-4o-mini.md) |
| D120 | Verdict is a closed enum `done \| continue \| skipped` | [D120-verdict-enum-three-values.md](./.claude/knowledge-base/adrs/D120-verdict-enum-three-values.md) |
| D121 | Fail-safe `continue` on parse error + max-consecutive cap (default 3) | [D121-fail-safe-continue-max-cap.md](./.claude/knowledge-base/adrs/D121-fail-safe-continue-max-cap.md) |
| D122 | `runUntil`/`fork` throw `UnsupportedRunOperationError` on CloudAgent | [D122-run-until-cloud-unsupported.md](./.claude/knowledge-base/adrs/D122-run-until-cloud-unsupported.md) |
| D123 | Pool storage = single JSON file at `$THEOKIT_HOME/credential-pool.json` | [D123-credential-pool-storage-json.md](./.claude/knowledge-base/adrs/D123-credential-pool-storage-json.md) |
| D124 | `CredentialPoolStrategy` is a closed enum (4 values) | [D124-credential-pool-strategy-enum.md](./.claude/knowledge-base/adrs/D124-credential-pool-strategy-enum.md) |
| D125 | Cooldown ladder: 401→5min, 429→1h, 402→1h; provider `Retry-After` overrides | [D125-credential-pool-cooldown-ladder.md](./.claude/knowledge-base/adrs/D125-credential-pool-cooldown-ladder.md) |
| D126 | 429 handling: retry same key once, rotate on second consecutive 429 | [D126-credential-pool-429-retry-then-rotate.md](./.claude/knowledge-base/adrs/D126-credential-pool-429-retry-then-rotate.md) |
| D127 | `PoolAwareLlmClient` is a composition wrapper, not a base class | [D127-credential-pool-composition-wrapper.md](./.claude/knowledge-base/adrs/D127-credential-pool-composition-wrapper.md) |
| D128 | In-process `withCwdMutex` for reads; `withFileLock` only on writes | [D128-credential-pool-in-process-mutex.md](./.claude/knowledge-base/adrs/D128-credential-pool-in-process-mutex.md) |
| D129 | Persistence: lazy load on first use, debounced write (200 ms) | [D129-credential-pool-lazy-load-debounced-write.md](./.claude/knowledge-base/adrs/D129-credential-pool-lazy-load-debounced-write.md) |
| D130 | Public API: `ProviderRoutingSettings.apiKeys: Record<string, string[]>` | [D130-credential-pool-api-keys-array.md](./.claude/knowledge-base/adrs/D130-credential-pool-api-keys-array.md) |
| D131 | Fork inherits parent pool by reference via `withCredentialPool` AsyncLocalStorage | [D131-credential-pool-fork-inheritance.md](./.claude/knowledge-base/adrs/D131-credential-pool-fork-inheritance.md) |
| D132 | Single-key shape (`apiKey: "..."`) takes the no-pool fast path | [D132-credential-pool-single-key-transparent.md](./.claude/knowledge-base/adrs/D132-credential-pool-single-key-transparent.md) |
| D133 | `CredentialPoolExhaustedError extends TheokitAgentError` | [D133-credential-pool-exhausted-error.md](./.claude/knowledge-base/adrs/D133-credential-pool-exhausted-error.md) |
| D134 | `Agent.batch(prompts, options)` is a static method on the façade | [D134-agent-batch-static-method.md](./.claude/knowledge-base/adrs/D134-agent-batch-static-method.md) |
| D135 | Async semaphore primitive lives in-house (no `p-limit` / `p-queue` dep) | [D135-async-semaphore-inhouse.md](./.claude/knowledge-base/adrs/D135-async-semaphore-inhouse.md) |
| D136 | `Agent.batch` default concurrency = 4 | [D136-batch-default-concurrency-4.md](./.claude/knowledge-base/adrs/D136-batch-default-concurrency-4.md) |
| D137 | Failures isolated per-prompt; `Agent.batch` never throws on a single failure | [D137-batch-failure-isolation.md](./.claude/knowledge-base/adrs/D137-batch-failure-isolation.md) |
| D138 | Fresh agent per prompt; credential pool shared via ALS (`withCredentialPool`) | [D138-batch-fresh-agent-per-prompt-shared-pool.md](./.claude/knowledge-base/adrs/D138-batch-fresh-agent-per-prompt-shared-pool.md) |
| D139 | ShareGPT trajectory export is opt-in helper (`toShareGptTrajectory`) | [D139-sharegpt-trajectory-opt-in-helper.md](./.claude/knowledge-base/adrs/D139-sharegpt-trajectory-opt-in-helper.md) |
| D140 | `AbortSignal` cancels pending prompts only; in-flight ones complete | [D140-batch-abort-pending-only.md](./.claude/knowledge-base/adrs/D140-batch-abort-pending-only.md) |
| D141 | `MemoryAdapter` formal interface + EC-B `mkMemoryId`/`extractRawId` prefix scheme | [D141-memory-adapter-interface.md](./.claude/knowledge-base/adrs/D141-memory-adapter-interface.md) |
| D142 | Memory adapters expose dual surface (API direta + LLM tool schemas) | [D142-memory-dual-surface.md](./.claude/knowledge-base/adrs/D142-memory-dual-surface.md) |
| D143 | Each adapter is a separate workspace package (`@usetheo/memory-*`) | [D143-memory-workspace-packages.md](./.claude/knowledge-base/adrs/D143-memory-workspace-packages.md) |
| D144 | Background prefetch is opt-in (default off) | [D144-memory-prefetch-opt-in.md](./.claude/knowledge-base/adrs/D144-memory-prefetch-opt-in.md) |
| D145 | Agent loop integrates memory via 2 new hooks (`pre_user_send`/`post_assistant_reply`), not a parallel MemoryManager | [D145-memory-hooks-not-manager.md](./.claude/knowledge-base/adrs/D145-memory-hooks-not-manager.md) |
| D146 | Memory adapter HTTP errors do NOT flow through CredentialPool | [D146-memory-no-credential-pool.md](./.claude/knowledge-base/adrs/D146-memory-no-credential-pool.md) |
| D147 | `MemoryContext` is minimal; only `userId` is required | [D147-memory-context-minimal.md](./.claude/knowledge-base/adrs/D147-memory-context-minimal.md) |
| D148 | `@usetheo/memory-mem0` ships cloud client only (no OSS local mode) | [D148-mem0-cloud-only.md](./.claude/knowledge-base/adrs/D148-mem0-cloud-only.md) |
| D149 | Adapter READMEs carry mandatory AGPL/CVSS disclosure sections | [D149-memory-readme-disclosures.md](./.claude/knowledge-base/adrs/D149-memory-readme-disclosures.md) |
| D150 | Context files coverage set: AGENTS/GEMINI/CLAUDE/.cursor/rules/THEO; skip SOUL/.hermes/.cursorrules | [D150-context-files-coverage-set.md](./.claude/knowledge-base/adrs/D150-context-files-coverage-set.md) |
| D151 | Walk-up-to-git-root discovery; no gitignore parsing | [D151-context-walk-up-git-root.md](./.claude/knowledge-base/adrs/D151-context-walk-up-git-root.md) |
| D152 | `concat-by-priority` merge (NOT first-match-wins) | [D152-context-merge-concat-by-priority.md](./.claude/knowledge-base/adrs/D152-context-merge-concat-by-priority.md) |
| D153 | `THEO.md` lives at `.theokit/THEO.md`, NOT repo root | [D153-theo-md-in-dot-theokit.md](./.claude/knowledge-base/adrs/D153-theo-md-in-dot-theokit.md) |
| D154 | Plain markdown default; MDC frontmatter only for .cursor/rules | [D154-context-plain-markdown-default.md](./.claude/knowledge-base/adrs/D154-context-plain-markdown-default.md) |
| D155 | Per-file 40k + aggregate 120k size caps with 70/20 truncation | [D155-context-size-caps.md](./.claude/knowledge-base/adrs/D155-context-size-caps.md) |
| D156 | `@path` import syntax for CLAUDE.md / GEMINI.md (5-hop, per-import cap) | [D156-context-import-syntax.md](./.claude/knowledge-base/adrs/D156-context-import-syntax.md) |
| D157 | Lazy-nested CLAUDE.md loading deferred to v2 | [D157-context-lazy-nested-claude-deferred.md](./.claude/knowledge-base/adrs/D157-context-lazy-nested-claude-deferred.md) |
| D158 | Backward compat: `.theokit/context/*.md` Zod sources keep working | [D158-context-backward-compat-theokit-context.md](./.claude/knowledge-base/adrs/D158-context-backward-compat-theokit-context.md) |
| D159 | Truncation telemetry counters with lazy tracer (EC-L no-op) | [D159-context-truncation-telemetry.md](./.claude/knowledge-base/adrs/D159-context-truncation-telemetry.md) |
| D160 | Personality presets ride the existing `SystemPromptResolver` hook (no new core changes) | [D160-personality-resolver-hook-only.md](./.claude/knowledge-base/adrs/D160-personality-resolver-hook-only.md) |
| D161 | Personality files are markdown + Zod-validated YAML frontmatter (lowercase-only slug — EC-C) | [D161-personality-markdown-frontmatter-shape.md](./.claude/knowledge-base/adrs/D161-personality-markdown-frontmatter-shape.md) |
| D162 | Personality presets live in `.theokit/personalities/` (project + user); project wins on collision | [D162-personality-storage-locations.md](./.claude/knowledge-base/adrs/D162-personality-storage-locations.md) |
| D163 | Active personality is session-default + persistent-opt-in via `{ save: true }` → `$THEOKIT_HOME/personality.json` (EC-B delete-key) | [D163-personality-session-default-persistent-opt-in.md](./.claude/knowledge-base/adrs/D163-personality-session-default-persistent-opt-in.md) |
| D164 | Personality switch preserves history + re-injects via D94 cache invalidation; user-role transcript marker | [D164-personality-switch-preserve-history-reinject.md](./.claude/knowledge-base/adrs/D164-personality-switch-preserve-history-reinject.md) |
| D165 | Telegram-pro slash command name is `/personality` | [D165-personality-slash-command-name.md](./.claude/knowledge-base/adrs/D165-personality-slash-command-name.md) |
| D166 | The SDK ships zero built-in personality presets | [D166-personality-no-builtin-presets.md](./.claude/knowledge-base/adrs/D166-personality-no-builtin-presets.md) |
| D167 | Personality `tools:` is advisory; additive narrowing per D102 layer 4 (EC-I MCP exact match, EC-15 dedup, EC-17 Levenshtein hint) | [D167-personality-tool-whitelist-advisory-narrowing.md](./.claude/knowledge-base/adrs/D167-personality-tool-whitelist-advisory-narrowing.md) |
| D168 | Forks inherit parent's active personality as a **slug snapshot** via AsyncLocalStorage — EC-A (NOT a live store reference) | [D168-personality-fork-inheritance-snapshot.md](./.claude/knowledge-base/adrs/D168-personality-fork-inheritance-snapshot.md) |
| D169 | `CloudAgent.usePersonality` throws `UnsupportedRunOperationError` (cloud pre-release) | [D169-personality-cloud-unsupported.md](./.claude/knowledge-base/adrs/D169-personality-cloud-unsupported.md) |
| D170 | `@usetheo/gateway` is a workspace package separate from `@usetheo/sdk` (SDK = harness, gateway = framework-domain) | [D170-gateway-workspace-package.md](./.claude/knowledge-base/adrs/D170-gateway-workspace-package.md) |
| D171 | Each platform adapter is its own peer-dep workspace package (`@usetheo/gateway-telegram`, `@usetheo/gateway-discord`) | [D171-gateway-platform-peer-deps.md](./.claude/knowledge-base/adrs/D171-gateway-platform-peer-deps.md) |
| D172 | `BasePlatformAdapter` is an abstract class with shared lifecycle defaults | [D172-gateway-base-abstract-class.md](./.claude/knowledge-base/adrs/D172-gateway-base-abstract-class.md) |
| D173 | `MessageEvent` is a discriminated union by `platform` field (telegram / discord / ...) | [D173-gateway-message-event-discriminated-union.md](./.claude/knowledge-base/adrs/D173-gateway-message-event-discriminated-union.md) |
| D174 | `SessionRouter` composes `Agent.resume`; never reimplements session storage | [D174-gateway-session-router-composes-agent-resume.md](./.claude/knowledge-base/adrs/D174-gateway-session-router-composes-agent-resume.md) |
| D175 | `DeliveryRouter` composes `Cron`; never reimplements scheduling | [D175-gateway-delivery-router-composes-cron.md](./.claude/knowledge-base/adrs/D175-gateway-delivery-router-composes-cron.md) |
| D176 | Gateway hooks are an own contract, NOT a new `Plugin.kind` | [D176-gateway-hooks-own-contract-not-plugin-kind.md](./.claude/knowledge-base/adrs/D176-gateway-hooks-own-contract-not-plugin-kind.md) |
| D177 | Hook signature mirrors SDK `pre_tool_call` veto pattern (`{ block: true, message? }`) | [D177-gateway-hooks-veto-signature.md](./.claude/knowledge-base/adrs/D177-gateway-hooks-veto-signature.md) |
| D178 | Telegram-pro migration preserves 100% of slash commands; dogfood is the regression gate | [D178-gateway-telegram-pro-migration-preserves-commands.md](./.claude/knowledge-base/adrs/D178-gateway-telegram-pro-migration-preserves-commands.md) |
| D179 | Discord adapter uses WebSocket Gateway (discord.js), not HTTP webhooks | [D179-gateway-discord-websocket-not-webhooks.md](./.claude/knowledge-base/adrs/D179-gateway-discord-websocket-not-webhooks.md) |
| D180 | Portable features are first-class (text + threads); platform-specific features via `event.{telegram,discord}?.raw` escape hatch | [D180-gateway-portable-vs-platform-specific.md](./.claude/knowledge-base/adrs/D180-gateway-portable-vs-platform-specific.md) |
| D181 | Initial gateway packages ship at `0.1.0` (pre-1.0); breaking changes allowed within `0.x` | [D181-gateway-pre-1-0-version.md](./.claude/knowledge-base/adrs/D181-gateway-pre-1-0-version.md) |
| D182 | Ollama ships as a builtin provider with `authType: "none"` + `OLLAMA_HOST` baseUrl override (zero-config local-LLM UX) | [D182-ollama-builtin-provider.md](./.claude/knowledge-base/adrs/D182-ollama-builtin-provider.md) |
| D183 | Ollama embedding adapter via OpenAI-compat `/v1/embeddings`; first `transport: "local"` entry in catalog | [D183-ollama-embedding-adapter.md](./.claude/knowledge-base/adrs/D183-ollama-embedding-adapter.md) |
| D184 | `Theokit.models.list({ provider })` reads locally for `authType: "none"` profiles | [D184-theokit-models-list-local-discovery.md](./.claude/knowledge-base/adrs/D184-theokit-models-list-local-discovery.md) |
| D185 | Typed Ollama transport + HTTP error mapping with actionable messages | [D185-ollama-actionable-error-mapping.md](./.claude/knowledge-base/adrs/D185-ollama-actionable-error-mapping.md) |
| D186 | Provider name inferred from `model.id` prefix when not declared | [D186-model-id-provider-inference.md](./.claude/knowledge-base/adrs/D186-model-id-provider-inference.md) |
| D187 | `CredentialPool` is a no-op for `authType: "none"` providers + one-shot warn | [D187-credential-pool-noop-for-noauth.md](./.claude/knowledge-base/adrs/D187-credential-pool-noop-for-noauth.md) |
| D188 | LM Studio ships as a builtin sibling profile (port 1234, `LMSTUDIO_HOST` override) | [D188-lmstudio-builtin-provider.md](./.claude/knowledge-base/adrs/D188-lmstudio-builtin-provider.md) |
| D189 | llama.cpp server ships as a builtin sibling profile (port 8080, `LLAMACPP_HOST` override) | [D189-llamacpp-builtin-provider.md](./.claude/knowledge-base/adrs/D189-llamacpp-builtin-provider.md) |
| D190 | Real-LLM examples are mandatory evidence for integration DONE | [D190-mandatory-examples-as-evidence.md](./.claude/knowledge-base/adrs/D190-mandatory-examples-as-evidence.md) |
| D193 | `@usetheo/cli` ships as a separate workspace package | [D193-cli-workspace-package.md](./.claude/knowledge-base/adrs/D193-cli-workspace-package.md) |
| D194 | `commander@12` for CLI subcommand routing | [D194-commander-routing.md](./.claude/knowledge-base/adrs/D194-commander-routing.md) |
| D195 | CLI bin name is `theokit` (not `tk`, `theo`, etc.) | [D195-bin-name-theokit.md](./.claude/knowledge-base/adrs/D195-bin-name-theokit.md) |
| D196 | `theokit init` templates are bundled, not git-cloned | [D196-init-bundled-templates.md](./.claude/knowledge-base/adrs/D196-init-bundled-templates.md) |
| D197 | `theokit dev` shells out to `tsx --watch` | [D197-dev-via-tsx-watch.md](./.claude/knowledge-base/adrs/D197-dev-via-tsx-watch.md) |
| D198 | `theokit inspect` is read-only; never executes user/plugin code | [D198-inspect-no-execution.md](./.claude/knowledge-base/adrs/D198-inspect-no-execution.md) |
| D199 | `theokit eval` v1 wraps `Agent.batch`; swaps to `Eval.run` later | [D199-eval-v1-minimal.md](./.claude/knowledge-base/adrs/D199-eval-v1-minimal.md) |
| D200 | Three initial `theokit init` templates: `minimal`, `ollama-local`, `telegram-bot` | [D200-init-three-templates.md](./.claude/knowledge-base/adrs/D200-init-three-templates.md) |
| D201 | `Theokit.inspect.*` public namespace in `@usetheo/sdk` | [D201-theokit-inspect-public-api.md](./.claude/knowledge-base/adrs/D201-theokit-inspect-public-api.md) |
| D202 | `Eval` is a static class with `Eval.create` factory + `.run()` method | [D202-eval-static-class.md](./.claude/knowledge-base/adrs/D202-eval-static-class.md) |
| D203 | Built-in scorers live in a separate `Scorers` namespace | [D203-scorers-namespace.md](./.claude/knowledge-base/adrs/D203-scorers-namespace.md) |
| D204 | Internally `Eval.run` consumes `Agent.batch` for parallelism | [D204-eval-consumes-batch.md](./.claude/knowledge-base/adrs/D204-eval-consumes-batch.md) |
| D205 | `llmJudge` scorer requires its own apiKey, separate from the eval agent | [D205-llm-judge-separate-apikey.md](./.claude/knowledge-base/adrs/D205-llm-judge-separate-apikey.md) |
| D206 | Eval traces piggyback on `Telemetry` (D34); no parallel tracer | [D206-eval-traces-via-telemetry.md](./.claude/knowledge-base/adrs/D206-eval-traces-via-telemetry.md) |
| D207 | `Scorer` is `(output, expected?) => Score \| Promise<Score>` (async canonical) | [D207-scorer-async-canonical.md](./.claude/knowledge-base/adrs/D207-scorer-async-canonical.md) |
| D208 | Error isolation per-row; one failed row NEVER aborts the run | [D208-eval-error-isolation.md](./.claude/knowledge-base/adrs/D208-eval-error-isolation.md) |
| D209 | `EvalRun` is plain serializable JSON; no class methods on result | [D209-eval-run-plain-json.md](./.claude/knowledge-base/adrs/D209-eval-run-plain-json.md) |
| D210 | Dataset accepts array OR factory-of-iterable | [D210-dataset-iterable-supported.md](./.claude/knowledge-base/adrs/D210-dataset-iterable-supported.md) |
| D211 | `EvalAggregate` includes p50/p95 row duration + tokens-in/out totals | [D211-aggregate-p50-p95-tokens.md](./.claude/knowledge-base/adrs/D211-aggregate-p50-p95-tokens.md) |
| D212 | CLI `packages/cli/src/eval/runner.ts` swaps to call `Eval.run()` | [D212-cli-swaps-to-eval-run.md](./.claude/knowledge-base/adrs/D212-cli-swaps-to-eval-run.md) |
| D213 | `Eval.run` is single-flight per name per process | [D213-eval-single-flight-per-name.md](./.claude/knowledge-base/adrs/D213-eval-single-flight-per-name.md) |
| D214 | Handoffs are tool-shaped (synthetic function tools) | [D214-handoff-as-tool.md](./.claude/knowledge-base/adrs/D214-handoff-as-tool.md) |
| D215 | Default handoff tool name = `transfer_to_<receiver.name>` | [D215-tool-name-default.md](./.claude/knowledge-base/adrs/D215-tool-name-default.md) |
| D216 | Full history passed to receiver by default | [D216-full-history-default.md](./.claude/knowledge-base/adrs/D216-full-history-default.md) |
| D217 | Handoffs are peer-to-peer (not parent-child) | [D217-peer-to-peer.md](./.claude/knowledge-base/adrs/D217-peer-to-peer.md) |
| D218 | Max handoff depth = 5 per send() (configurable) | [D218-max-handoff-depth.md](./.claude/knowledge-base/adrs/D218-max-handoff-depth.md) |
| D219 | `inputFilter` is single extension point for history scoping | [D219-input-filter-single-extension.md](./.claude/knowledge-base/adrs/D219-input-filter-single-extension.md) |
| D220 | Telemetry: emit `handoff.transfer` OTel span | [D220-telemetry-handoff-spans.md](./.claude/knowledge-base/adrs/D220-telemetry-handoff-spans.md) |
| D221 | Single-flight per (sender, receiver) pair per send() | [D221-single-flight-per-pair.md](./.claude/knowledge-base/adrs/D221-single-flight-per-pair.md) |
| D222 | `Handoff` is a class with `Handoff.create(target, opts?)` factory | [D222-handoff-class-factory.md](./.claude/knowledge-base/adrs/D222-handoff-class-factory.md) |
| D223 | `inputType` is a Zod schema (lazy peer dep) | [D223-input-type-zod.md](./.claude/knowledge-base/adrs/D223-input-type-zod.md) |
| D224 | Tool whitelist transfer scoped to post-handoff turn | [D224-tool-whitelist-transfer.md](./.claude/knowledge-base/adrs/D224-tool-whitelist-transfer.md) |
| D225 | `Agent.handoffTo(other, opts?)` imperative API opt-in | [D225-imperative-handoffTo.md](./.claude/knowledge-base/adrs/D225-imperative-handoffTo.md) |
| D226 | Parallel handoff tools in one turn: first wins; others rejected | [D226-parallel-handoff-first-wins.md](./.claude/knowledge-base/adrs/D226-parallel-handoff-first-wins.md) |
| D227 | `onHandoff` throwing aborts the handoff | [D227-onhandoff-throw-aborts.md](./.claude/knowledge-base/adrs/D227-onhandoff-throw-aborts.md) |
| D228 | `inputFilter` throw falls back to full history + stderr warn | [D228-inputfilter-throw-fallback.md](./.claude/knowledge-base/adrs/D228-inputfilter-throw-fallback.md) |
| D229 | Empty/null `inputJson` accepted when `inputType === undefined` | [D229-empty-input-accepted.md](./.claude/knowledge-base/adrs/D229-empty-input-accepted.md) |
| D230 | `Workflow` is static class with `.create / .run / .resume` (factory pattern) | [D230-workflow-class-factory.md](./.claude/knowledge-base/adrs/D230-workflow-class-factory.md) |
| D231 | Builder mutates + returns immutable `Workflow` after `.commit()` | [D231-builder-mutable-commit.md](./.claude/knowledge-base/adrs/D231-builder-mutable-commit.md) |
| D232 | `Step` is discriminated union by `kind` (8 variants) | [D232-step-discriminated-union.md](./.claude/knowledge-base/adrs/D232-step-discriminated-union.md) |
| D233 | Control flow names mirror Mastra (`.then/.parallel/.branch/.foreach/.dowhile/.sleep/.suspend`) | [D233-mastra-naming.md](./.claude/knowledge-base/adrs/D233-mastra-naming.md) |
| D234 | State between steps is explicit input/output (no global state-machine) | [D234-explicit-input-output-state.md](./.claude/knowledge-base/adrs/D234-explicit-input-output-state.md) |
| D235 | Persistence default in-memory; JSON opt-in via `persistence: { backend, dir }` | [D235-persistence-in-memory-default.md](./.claude/knowledge-base/adrs/D235-persistence-in-memory-default.md) |
| D236 | Suspend/resume via `await ctx.suspend(payload?)` → `Workflow.resume({...})` | [D236-suspend-resume.md](./.claude/knowledge-base/adrs/D236-suspend-resume.md) |
| D237 | Retry policy declarative per step, Temporal-shape (maxAttempts/backoffMs/coef) | [D237-retry-policy-temporal-shape.md](./.claude/knowledge-base/adrs/D237-retry-policy-temporal-shape.md) |
| D238 | Saga `compensate?` reserved on interface; engine DEFERRED to v1.2 | [D238-compensate-deferred-v12.md](./.claude/knowledge-base/adrs/D238-compensate-deferred-v12.md) |
| D239 | Step IDs user-provided, grammar `^[a-z0-9][a-z0-9_-]*$` (reuse D81) | [D239-step-id-grammar.md](./.claude/knowledge-base/adrs/D239-step-id-grammar.md) |
| D240 | `.parallel`/`.foreach` reuse existing `AsyncSemaphore` (D135) | [D240-reuse-async-semaphore.md](./.claude/knowledge-base/adrs/D240-reuse-async-semaphore.md) |
| D241 | Telemetry via existing OTel seam: spans `workflow.run` + `workflow.step.<id>` | [D241-telemetry-otel-seam.md](./.claude/knowledge-base/adrs/D241-telemetry-otel-seam.md) |
| D242 | Single-flight per `(workflowId, runId)` → `WorkflowAlreadyRunningError` | [D242-single-flight-per-runId.md](./.claude/knowledge-base/adrs/D242-single-flight-per-runId.md) |
| D243 | `.parallel` `errorPolicy: "fail-fast"` default; `"collect"` opt-in | [D243-parallel-error-fail-fast.md](./.claude/knowledge-base/adrs/D243-parallel-error-fail-fast.md) |
| D244 | `CloudAgent` workflow steps throw `UnsupportedRunOperationError` | [D244-cloud-runworkflow-unsupported.md](./.claude/knowledge-base/adrs/D244-cloud-runworkflow-unsupported.md) |
| D245 | Cancellation via AbortSignal at step boundaries + `ctx.signal` for step.fn | [D245-abort-signal-boundaries.md](./.claude/knowledge-base/adrs/D245-abort-signal-boundaries.md) |
| D246 | Workflow composes over runUntil/handoffs/batch via public API only (no internal reach) | [D246-workflow-composes-not-replaces.md](./.claude/knowledge-base/adrs/D246-workflow-composes-not-replaces.md) |
| D247 | `step.fn` signature `(input, ctx) => Promise<output>` where ctx = { runId, signal, log, suspend } | [D247-step-fn-signature.md](./.claude/knowledge-base/adrs/D247-step-fn-signature.md) |
| D248 | v1 scope: 7 primitives shipped; saga + cloud + extra backends deferred | [D248-v1-scope.md](./.claude/knowledge-base/adrs/D248-v1-scope.md) |
| D249 | `Cache` is static class with `.semantic` factory + `.asPlugin()` returning Plugin | [D249-cache-class-factory-asplugin.md](./.claude/knowledge-base/adrs/D249-cache-class-factory-asplugin.md) |
| D250 | Cache is a Plugin (`kind: "cache"`), not Agent wrapper | [D250-cache-as-plugin-kind.md](./.claude/knowledge-base/adrs/D250-cache-as-plugin-kind.md) |
| D251 | Reuse `MemoryEmbeddingProviderAdapter` (D11) — no new embedding layer | [D251-reuse-memory-embedding-adapter.md](./.claude/knowledge-base/adrs/D251-reuse-memory-embedding-adapter.md) |
| D252 | Layered: KV exact pre-filter + vector semantic fallback | [D252-layered-kv-plus-semantic.md](./.claude/knowledge-base/adrs/D252-layered-kv-plus-semantic.md) |
| D253 | Composite cache key `${namespace}:${embedderId}:${modelId}:hash(prompt)` | [D253-composite-cache-key.md](./.claude/knowledge-base/adrs/D253-composite-cache-key.md) |
| D254 | Threshold default 0.85; no per-entry adaptive in v1 | [D254-threshold-default-0.85-no-adaptive.md](./.claude/knowledge-base/adrs/D254-threshold-default-0.85-no-adaptive.md) |
| D255 | TTL per-category + exclude regex (default 1h) | [D255-ttl-per-category-exclude-regex.md](./.claude/knowledge-base/adrs/D255-ttl-per-category-exclude-regex.md) |
| D256 | Streaming cache deferred to v1.x | [D256-streaming-cache-deferred.md](./.claude/knowledge-base/adrs/D256-streaming-cache-deferred.md) |
| D257 | Cache per-Agent (via `plugins[]`), NOT global state | [D257-cache-per-agent-not-global.md](./.claude/knowledge-base/adrs/D257-cache-per-agent-not-global.md) |
| D258 | Embedder change invalidates cache via namespace versioning | [D258-embedder-namespace-versioning.md](./.claude/knowledge-base/adrs/D258-embedder-namespace-versioning.md) |
| D259 | KV exact pre-filter; semantic only on KV miss | [D259-kv-pre-filter-semantic-fallback.md](./.claude/knowledge-base/adrs/D259-kv-pre-filter-semantic-fallback.md) |
| D260 | Hook points: lookup at `pre_user_send`, store at `post_assistant_reply` | [D260-hook-points-pre-user-post-reply.md](./.claude/knowledge-base/adrs/D260-hook-points-pre-user-post-reply.md) |
| D261 | LRU eviction in-memory default 1000 entries | [D261-lru-eviction-default-1000.md](./.claude/knowledge-base/adrs/D261-lru-eviction-default-1000.md) |
| D262 | Telemetry: `cache.lookup` + hit/miss events via OTel seam | [D262-telemetry-cache-spans.md](./.claude/knowledge-base/adrs/D262-telemetry-cache-spans.md) |
| D263 | Composes with Anthropic prompt_caching (orthogonal layers) | [D263-compose-with-anthropic-prompt-caching.md](./.claude/knowledge-base/adrs/D263-compose-with-anthropic-prompt-caching.md) |
| D264 | False positive risk documented; no automatic mitigation v1 | [D264-false-positive-risk-documented.md](./.claude/knowledge-base/adrs/D264-false-positive-risk-documented.md) |
| D265 | Persistence: memory default; JSON disk opt-in | [D265-persistence-memory-default-json-optin.md](./.claude/knowledge-base/adrs/D265-persistence-memory-default-json-optin.md) |
| D266 | Skip cache for runs that invoked tools (EC-10 absorbed) | [D266-skip-cache-when-tool-use.md](./.claude/knowledge-base/adrs/D266-skip-cache-when-tool-use.md) |
| D267 | Use `@slack/bolt` as canonical Slack SDK | [D267-bolt-sdk-choice.md](./.claude/knowledge-base/adrs/D267-bolt-sdk-choice.md) |
| D268 | Socket Mode default in v1 (no HTTP webhook) | [D268-socket-mode-default.md](./.claude/knowledge-base/adrs/D268-socket-mode-default.md) |
| D269 | HTTP webhook transport deferred to v1.x | [D269-http-webhook-deferred.md](./.claude/knowledge-base/adrs/D269-http-webhook-deferred.md) |
| D270 | Channel type mapping (im→dm, mpim/channel→group, thread_ts→thread) | [D270-channel-type-mapping.md](./.claude/knowledge-base/adrs/D270-channel-type-mapping.md) |
| D271 | Slack `thread_ts` is canonical `topicId` | [D271-thread-ts-topicId.md](./.claude/knowledge-base/adrs/D271-thread-ts-topicId.md) |
| D272 | Message split 4000 chars + surrogate-pair guard | [D272-split-4000-chars.md](./.claude/knowledge-base/adrs/D272-split-4000-chars.md) |
| D273 | Slack API error mapping to canonical SendResult codes | [D273-error-mapping.md](./.claude/knowledge-base/adrs/D273-error-mapping.md) |
| D274 | `SlackMessageEvent` discriminated union variant | [D274-slack-message-event.md](./.claude/knowledge-base/adrs/D274-slack-message-event.md) |
| D275 | Bot loop guard via cached botUserId + bot_id subtype filter | [D275-bot-loop-guard.md](./.claude/knowledge-base/adrs/D275-bot-loop-guard.md) |
| D276 | `onInbound` replaces previous handler (EC-H pattern) | [D276-replace-handler-semantics.md](./.claude/knowledge-base/adrs/D276-replace-handler-semantics.md) |
| D277 | `botUserId` cached after connect via `auth.test` | [D277-cache-bot-user-id.md](./.claude/knowledge-base/adrs/D277-cache-bot-user-id.md) |
| D278 | `disconnect()` is idempotent + safe before connect | [D278-disconnect-idempotent.md](./.claude/knowledge-base/adrs/D278-disconnect-idempotent.md) |
| D279 | `connect()` returns false on failure + EC-1 orphan cleanup | [D279-connect-returns-false-on-failure.md](./.claude/knowledge-base/adrs/D279-connect-returns-false-on-failure.md) |
| D280 | File uploads deferred to v1.x | [D280-file-uploads-deferred.md](./.claude/knowledge-base/adrs/D280-file-uploads-deferred.md) |
| D281 | Block Kit formatting deferred to v1.x | [D281-block-kit-deferred.md](./.claude/knowledge-base/adrs/D281-block-kit-deferred.md) |
| D282 | Reactions/modals/slash commands deferred to v1.x | [D282-reactions-modals-deferred.md](./.claude/knowledge-base/adrs/D282-reactions-modals-deferred.md) |
| D283 | Peer deps `@slack/bolt` + `@slack/web-api` (D171 pattern) | [D283-peer-deps-bolt-web-api.md](./.claude/knowledge-base/adrs/D283-peer-deps-bolt-web-api.md) |
| D284 | Example app + env-gated live dogfood | [D284-example-plus-optin-dogfood.md](./.claude/knowledge-base/adrs/D284-example-plus-optin-dogfood.md) |
| D285 | `requireMention: true` default for channels (EC-3 absorbed) | [D285-require-mention-default.md](./.claude/knowledge-base/adrs/D285-require-mention-default.md) |
| D286 | Bedrock uses Bearer token only in v1 (no SigV4) | [D286-bedrock-bearer-only-v1.md](./.claude/knowledge-base/adrs/D286-bedrock-bearer-only-v1.md) |
| D287 | `@aws/bedrock-token-generator` optional peer dep (auto-refresh) | [D287-bedrock-token-generator-optional.md](./.claude/knowledge-base/adrs/D287-bedrock-token-generator-optional.md) |
| D288 | `google-auth-library` required peer dep for Vertex | [D288-google-auth-library-required.md](./.claude/knowledge-base/adrs/D288-google-auth-library-required.md) |
| D289 | Bedrock uses InvokeModel (not Converse) | [D289-bedrock-invokemodel-not-converse.md](./.claude/knowledge-base/adrs/D289-bedrock-invokemodel-not-converse.md) |
| D290 | Bedrock model IDs accept region prefix (us./eu./apac./jp./global.) pass-through | [D290-bedrock-region-prefix-passthrough.md](./.claude/knowledge-base/adrs/D290-bedrock-region-prefix-passthrough.md) |
| D291 | Vertex Gemini uses OpenAI-compat endpoint (reuses OpenAIClient) | [D291-vertex-gemini-openai-compat.md](./.claude/knowledge-base/adrs/D291-vertex-gemini-openai-compat.md) |
| D292 | Vertex Claude uses `:rawPredict` with body massage | [D292-vertex-claude-rawpredict-body-massage.md](./.claude/knowledge-base/adrs/D292-vertex-claude-rawpredict-body-massage.md) |
| D293 | Vertex `global` location forces baseUrl `aiplatform.googleapis.com` | [D293-vertex-global-baseurl-override.md](./.claude/knowledge-base/adrs/D293-vertex-global-baseurl-override.md) |
| D294 | No Anthropic SDK wrappers (`@anthropic-ai/bedrock-sdk` / `@anthropic-ai/vertex-sdk`) | [D294-no-anthropic-sdk-wrappers.md](./.claude/knowledge-base/adrs/D294-no-anthropic-sdk-wrappers.md) |
| D295 | Token refresh: Bedrock caches; Vertex calls `getAccessToken` per request | [D295-token-refresh-strategy.md](./.claude/knowledge-base/adrs/D295-token-refresh-strategy.md) |
| D296 | Bedrock Converse + Computer Use deferred to v1.x | [D296-bedrock-converse-deferred.md](./.claude/knowledge-base/adrs/D296-bedrock-converse-deferred.md) |
| D297 | Vertex Workload Identity Federation walkthrough deferred to v1.x | [D297-vertex-wif-walkthrough-deferred.md](./.claude/knowledge-base/adrs/D297-vertex-wif-walkthrough-deferred.md) |
| D298 | SigV4 transport deferred to v1.x | [D298-sigv4-deferred-v1x.md](./.claude/knowledge-base/adrs/D298-sigv4-deferred-v1x.md) |
| D299 | Service Account JSON file generation tooling deferred | [D299-sa-json-tooling-deferred.md](./.claude/knowledge-base/adrs/D299-sa-json-tooling-deferred.md) |
| D300 | Error mappers per dialect (Bedrock + Vertex) — D67 pattern | [D300-error-mappers-per-dialect.md](./.claude/knowledge-base/adrs/D300-error-mappers-per-dialect.md) |
| D301 | `ApiMode` extended: `bedrock_anthropic` new; Vertex reuses existing modes | [D301-apimode-bedrock-anthropic-extended.md](./.claude/knowledge-base/adrs/D301-apimode-bedrock-anthropic-extended.md) |
| D302 | Bedrock streaming deferred to v1.x (binary parser scope) | [D302-bedrock-streaming-deferred.md](./.claude/knowledge-base/adrs/D302-bedrock-streaming-deferred.md) |
| D361 | `Task` is static class with private constructor | [D361-task-static-class.md](./.claude/knowledge-base/adrs/D361-task-static-class.md) |
| D362 | `TaskState` is 5-value closed enum (queued/running/finished/error/cancelled) | [D362-task-five-state-enum.md](./.claude/knowledge-base/adrs/D362-task-five-state-enum.md) |
| D363 | Task wrapping is opt-in via `{ task: true }` option | [D363-task-wrapping-opt-in.md](./.claude/knowledge-base/adrs/D363-task-wrapping-opt-in.md) |
| D364 | `TaskStore` pluggable (InMemory default + JsonFile opt-in; SQLite deferred v0.2) | [D364-task-store-pluggable.md](./.claude/knowledge-base/adrs/D364-task-store-pluggable.md) |
| D365 | `Task.cancel` idempotent + propagates via AbortController | [D365-task-cancel-idempotent.md](./.claude/knowledge-base/adrs/D365-task-cancel-idempotent.md) |
| D366 | `TaskEvent` discriminated union (6 arms) | [D366-task-event-discriminated-union.md](./.claude/knowledge-base/adrs/D366-task-event-discriminated-union.md) |
| D367 | Single-flight per `taskId` (duplicate submit returns existing handle) | [D367-task-single-flight-per-id.md](./.claude/knowledge-base/adrs/D367-task-single-flight-per-id.md) |
| D368 | Task IDs grammar `^[a-z0-9][a-z0-9_-]*$` + reserved prefixes (wf-/b-/cron-) | [D368-task-id-grammar.md](./.claude/knowledge-base/adrs/D368-task-id-grammar.md) |
| D369 | Concurrency via existing `AsyncSemaphore` (D135), default 8 | [D369-task-async-semaphore-reuse.md](./.claude/knowledge-base/adrs/D369-task-async-semaphore-reuse.md) |
| D370 | `CloudAgent` task ops throw `UnsupportedTaskOperationError` | [D370-task-cloud-unsupported.md](./.claude/knowledge-base/adrs/D370-task-cloud-unsupported.md) |
| D371 | 3 OTel spans (`task.submit/transition/cancel`) via D34 seam | [D371-task-telemetry-spans.md](./.claude/knowledge-base/adrs/D371-task-telemetry-spans.md) |
| D372 | `Task.subscribe` ring buffer (cap 64) for late-attach replay | [D372-task-subscribe-replay-buffer.md](./.claude/knowledge-base/adrs/D372-task-subscribe-replay-buffer.md) |
| D373 | Auto-eviction (1h InMemory, 7d JsonFile defaults) | [D373-task-auto-eviction-retention.md](./.claude/knowledge-base/adrs/D373-task-auto-eviction-retention.md) |
| D374 | Runtime adapters (Run/Batch/Workflow/Cron) are thin wrappers over `Task.submit` | [D374-task-runtime-adapters-thin.md](./.claude/knowledge-base/adrs/D374-task-runtime-adapters-thin.md) |
| D375 | `Budget` is static class with private constructor | [D375-budget-static-class.md](./.claude/knowledge-base/adrs/D375-budget-static-class.md) |
| D376 | `TokenUsage` shape: 5 closed buckets (input/output/cacheRead/cacheWrite/reasoning) | [D376-token-usage-5-bucket-enum.md](./.claude/knowledge-base/adrs/D376-token-usage-5-bucket-enum.md) |
| D377 | `CostStatus` 4-value closed enum (actual/estimated/included/unknown) | [D377-cost-status-closed-enum.md](./.claude/knowledge-base/adrs/D377-cost-status-closed-enum.md) |
| D378 | Pricing canonical unit: USD per million tokens | [D378-per-million-pricing-canonical.md](./.claude/knowledge-base/adrs/D378-per-million-pricing-canonical.md) |
| D379 | Pricing snapshot bundled (LiteLLM JSON); manual refresh | [D379-pricing-snapshot-bundled.md](./.claude/knowledge-base/adrs/D379-pricing-snapshot-bundled.md) |
| D380 | `gpt-tokenizer` is optional peer dep | [D380-gpt-tokenizer-optional-peer.md](./.claude/knowledge-base/adrs/D380-gpt-tokenizer-optional-peer.md) |
| D381 | Claude tokens NEVER local-counted (Anthropic tokenizer stale 2023) | [D381-claude-no-local-count.md](./.claude/knowledge-base/adrs/D381-claude-no-local-count.md) |
| D382 | Budget windows UTC calendar-aligned | [D382-budget-window-utc-aligned.md](./.claude/knowledge-base/adrs/D382-budget-window-utc-aligned.md) |
| D383 | 3 budget modes: audit/warn/block | [D383-three-modes-audit-warn-block.md](./.claude/knowledge-base/adrs/D383-three-modes-audit-warn-block.md) |
| D384 | Stacked budget limits; ANY exceeded blocks | [D384-stacked-budget-limits.md](./.claude/knowledge-base/adrs/D384-stacked-budget-limits.md) |
| D385 | In-process ledger mutex-protected; persistence deferred to v0.2 | [D385-in-process-ledger-mutex.md](./.claude/knowledge-base/adrs/D385-in-process-ledger-mutex.md) |
| D386 | `BudgetExceededError extends TheokitAgentError` (with `mode` field, EC-1) | [D386-budget-exceeded-error.md](./.claude/knowledge-base/adrs/D386-budget-exceeded-error.md) |
| D387 | `RunResult.usage?` + `RunResult.cost?` optional; populated on partial-failure | [D387-runresult-usage-cost-optional.md](./.claude/knowledge-base/adrs/D387-runresult-usage-cost-optional.md) |
| D388 | `CloudAgent.send({ budget })` throws `UnsupportedBudgetOperationError` | [D388-budget-cloud-unsupported.md](./.claude/knowledge-base/adrs/D388-budget-cloud-unsupported.md) |

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
- **Backend DX P1 (DI + di-agent)**: DONE 2026-05-29, GA 0.1.0 published 2026-05-31. P2 (`@usetheo/orm`) + P3 (`@usetheo/http-decorators`) ⏳ next.

Total ADRs registradas: 421 (`./.claude/knowledge-base/adrs/D1` até `D421`).

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
