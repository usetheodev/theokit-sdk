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
| secret-redaction-discipline | ✅ DONE | `packages/sdk/src/internal/security/redact.ts` — 12 builtin patterns + PARAM_PATTERN + BEARER_PATTERN, env snapshot at init, two-bucket masking (ADRs D68-D73). Public `Security.addPattern(re)` API. Wired at ErrorMetadata.raw (T1.1), telemetry tracer (T1.2), transcript JSONL (T1.3), migration logger (T1.4). CI gate `tests/lint/no-unredacted-sink.test.ts` prevents regression. Adversarial property tests via fast-check (~3000 randomized inputs). |
| path-traversal-vectors | ✅ DONE | `packages/sdk/src/internal/security/path-guard.ts` — `safePathJoin` (resolve-then-check, ADR D80) + `assertNoSymlinkEscape` (realpath chain, EC-1 fix) + `sanitizeIdentifier` (strict grammar, ADR D81) + `PathTraversalError` (ADRs D79-D81). Wired em plugins-manager, agent-session-store, skills-manager, memory/types, mcp/client. CI gate `tests/lint/no-unguarded-path-input.test.ts` (ADR D85). Adversarial fast-check 1200+ inputs. |
| toctou-race-prevention | ✅ DONE | `cwd-mutex` (in-process) + `withFileLock` (D61, multi-process via proper-lockfile) + `createExclusive` (D82, O_EXCL com mode 0o600 default) + `casUpdate` (D83, SQLite CAS). Integration demo em `agent-registry-cas-pattern.test.ts`. |

### Testing (3)

| Pattern | Status | Where in SDK |
|---|---|---|
| testing-invariant-vs-snapshot | 📚 CULTURAL | Já praticado (sem `toMatchSnapshot`); manter via code review |
| hermetic-test-isolation | ✅ DONE | `packages/sdk/vitest.setup.ts` autouse beforeEach/afterEach isola `THEOKIT_HOME` em tmpdir per-test (T6.1, ADR D60). `setupFiles` wired em `vitest.config.ts`. Lint test em `tests/lint/no-hardcoded-theokit-path.test.ts` audita regressões. |
| property-based-testing | ✅ DONE | `fast-check` ^3.x added as dev dep with secret-redaction-discipline plan. `tests/internal/security/redact.property.test.ts` exercises all 12 builtin patterns + PARAM + BEARER × 200 runs each; `tests/internal/security/sinks.adversarial.test.ts` covers the 4 output sinks. Same template can be applied to other modules incrementally. |

### Error handling (2) — ✅ Error Context Surfacing plan COMPLETED 2026-05-18

| Pattern | Status | Where in SDK |
|---|---|---|
| error-context-surfacing | ✅ DONE | `packages/sdk/src/errors.ts` — `ErrorMetadata` + `ErrorCode` types (ADR D65/D66). Provider mappers `mapAnthropicError` + `mapOpenAICompatibleError` (ADR D67) in `internal/errors/mappers/`. Wired in `internal/llm/anthropic.ts`, `internal/llm/openai.ts`, `internal/memory/adapters/openai-compatible.ts`. `fallback-client.ts` also falls back on `AuthenticationError`/`RateLimitError`. |
| graceful-degradation | ✅ DONE | ADR D42 (auto-detect telemetry), D50 (lance dry-run), D55 (fail-open) implementados |

### Totais (2026-05-19 — pós Security Block Completion plan)

```
✅ DONE        13 (57%)
⚠️ PARTIAL      2  (9%)
❌ PENDING      6 (26%)
📚 CULTURAL    2  (9%)
              ───
              23 (100%)
```

- **Persistence & State block: 6/6 DONE** (was 0 DONE / 5 PARTIAL / 1 PENDING at v1.2).
- **Testing block: 2/3 DONE + 1/3 CULTURAL** — hermetic-test-isolation landed via T6.1 (vitest.setup.ts + setupFiles); property-based-testing now ✅ DONE via `fast-check` adversarial suite shipped with secret-redaction (12 builtin patterns × 200 runs + sink-level tests).
- **Error handling block: 2/2 DONE** — graceful-degradation via D42/D50/D55; error-context-surfacing via D65/D66/D67 (ErrorMetadata + ErrorCode + provider mappers).
- **Security block: 3/3 DONE** — secret-redaction-discipline (D68-D73), path-traversal-vectors (D79-D81 + D84-D85), toctou-race-prevention (D61 + D82 + D83). All wired sinks, CI gates, and adversarial property tests in place.

> **Importante**: este é mapa, não plano. Não há commitment de implementar
> todos os PENDING — cada um é proposta que precisa de ADR + plano formal
> antes de wirar. Hermes Agent (`referencia/hermes-agent/`) continua sendo
> **read-only study material** (per "Working with `referencia/`" rule
> acima). Theokit-SDK não tem ambição de paridade Hermes-equivalent;
> compara-se a Vercel AI / Mastra / Claude Agent SDK.

## Macro Roadmap — Priority Order (2026-05-18)

> Síntese dos gaps abertos (7 PENDING + 3 PARTIAL do roadmap de patterns
> acima + os 9 v1.3 features Hermes-class de [`hermes-deep-dive/99-implementation-guide.md`](./.claude/knowledge-base/hermes-deep-dive/99-implementation-guide.md)).
> Ordenado por **alavancagem ÷ custo**, não por preferência. Cross-link:
> cada linha aponta pra pattern em `sdk-references/` + Hermes primary
> source via [`hermes-deep-dive/INDEX.md`](./.claude/knowledge-base/hermes-deep-dive/INDEX.md).

Critérios de ranking:

- **Foundation-first** — bloqueia outros gaps? Vai antes.
- **Quick wins** — <1k LoC + baixo risco + impacto user-visible? Vai antes.
- **User-facing > internal** — surface que devs vão usar antes de refactor arquitetural.
- **Independent > coupled** — gaps que rodam isolados antes dos que dependem de N outros.

LoC estimates do `99-implementation-guide.md`; risk = Hermes' próprio
indicator de quanto deu trabalho lá.

### Tier 1 — Quick wins (recomendado começar aqui)

| # | Gap | Tipo | LoC est | Risco | Por quê primeiro |
|---|---|---|---|---|---|
| 1 | **`Agent.runUntil(goal)`** ([async-iterable-streaming](./.claude/knowledge-base/sdk-references/async-iterable-streaming.md) PARTIAL → DONE) | Feature | 600 | baixo | Ralph loop primitive. Foundation pra autonomous-skills (#9). User-visible, baixo blast radius. Já temos o skill na cli do Claude Code — trazer pro SDK é tradução direta. |
| 2 | **`tool-call-failure-recovery`** ([pattern](./.claude/knowledge-base/sdk-references/tool-call-failure-recovery.md)) | Pattern | 800 | médio | Repair middleware em `internal/tool-dispatch/`. Hoje primeira tool call malformada termina o loop. LLMs frequentemente devolvem JSON malformado — high real-world impact. |
| 3 | **`compression-death-spiral`** ([pattern](./.claude/knowledge-base/sdk-references/compression-death-spiral.md)) | Pattern | 400 | baixo | `IterationBudget` cap em `internal/runtime/budget.ts`. Safety net contra runaway loops. Pareia naturalmente com #2. |
| 4 | **`tool-registry-pattern`** ([pattern](./.claude/knowledge-base/sdk-references/tool-registry-pattern.md) PARTIAL → DONE) | Pattern | 500 | baixo | Já temos `defineTool` (D24). Falta `ToolRegistry` + `Toolset` filtragem. Foundation pra plugin-contract-design (#5). |

**Tier 1 total: ~2300 LoC, ~3 semanas com 1 dev.** Fecha 2 PENDING + 2 PARTIAL → roadmap vira **15 DONE / 1 PARTIAL / 5 PENDING / 2 CULTURAL**.

### Tier 2 — Arquitetura extensível (depende de Tier 1)

| # | Gap | Tipo | LoC est | Risco | Dependências |
|---|---|---|---|---|---|
| 5 | **`plugin-contract-design`** ([pattern](./.claude/knowledge-base/sdk-references/plugin-contract-design.md)) | Pattern | 1500 | médio | Depende de tool-registry-pattern (#4). |
| 6 | **`provider-as-plugin`** / ProviderProfile ABC ([pattern](./.claude/knowledge-base/sdk-references/provider-as-plugin.md) + [v1.3 feature 7](./.claude/knowledge-base/hermes-deep-dive/07-provider-plugins.md)) | Pattern + Feature | 1500 | médio | Depende de plugin-contract-design (#5). Destrava ecosystem (`@theokit-provider-xyz`). |

**Tier 2 total: ~3000 LoC, ~5 semanas.** Fecha 2 PENDING → **17 DONE / 0 PARTIAL / 3 PENDING / 2 CULTURAL** (assumindo Tier 1 done).

### Tier 3 — Security hardening

| # | Gap | Tipo | LoC est | Risco | Notas |
|---|---|---|---|---|---|
| 7 | **`path-traversal-vectors`** ([pattern](./.claude/knowledge-base/sdk-references/path-traversal-vectors.md)) | Pattern | 400 | baixo | `internal/security/path-guard.ts`. Hermes shipou 7 closures em v0.2 + zip-slip em v0.5. |
| 8 | **`toctou-race-prevention`** ([pattern](./.claude/knowledge-base/sdk-references/toctou-race-prevention.md) PARTIAL → DONE) | Pattern | 600 | médio | Já temos cwd-mutex + withFileLock. Falta SQLite CAS patterns + O_EXCL idiomático. Hermes teve 3 recurrences em v0.13. |

**Tier 3 total: ~1000 LoC, ~2 semanas.** Fecha 1 PENDING + 1 PARTIAL → **19 DONE / 0 PARTIAL / 2 PENDING / 2 CULTURAL**.

### Tier 4 — Background work + cross-session

| # | Gap | Tipo | LoC est | Risco | Cross-link Hermes |
|---|---|---|---|---|---|
| 9 | **`forked-agent-pattern`** | Pattern | 800 | médio | [run_agent.py:4230](./referencia/hermes-agent/run_agent.py#L4230) `_spawn_background_review`. Pareia com #11. |
| 10 | **`judge-call-pattern`** | Pattern | 600 | médio | [goals.py:580](./referencia/hermes-agent/hermes_cli/goals.py#L580). Pareia com #1 (runUntil). |
| 11 | **Cross-session FTS5 (SessionDB)** | Feature | 2000 | baixo | [04-cross-session-fts5.md](./.claude/knowledge-base/hermes-deep-dive/04-cross-session-fts5.md). FTS5 sanitizer já temos. |
| 12 | **`no_agent` cron mode** | Feature | 800 | baixo | [09-no-agent-cron.md](./.claude/knowledge-base/hermes-deep-dive/09-no-agent-cron.md). Cron sem LLM (timer-only). |
| 13 | **Dialectic user modeling** | Feature | 1200 | médio | [05-dialectic-user-model.md](./.claude/knowledge-base/hermes-deep-dive/05-dialectic-user-model.md). Honcho equivalent. |
| 14 | **Checkpoints v2** | Feature | 1800 | médio | [08-checkpoints-v2.md](./.claude/knowledge-base/hermes-deep-dive/08-checkpoints-v2.md). Shells out to git, lazy probe. |

**Tier 4 total: ~7200 LoC, ~12 semanas.** Fecha 2 PENDING patterns + 4 features novos.

### Tier 5 — Big bets (alta ambição, alto custo)

| # | Gap | Tipo | LoC est | Risco | Notas |
|---|---|---|---|---|---|
| 15 | **Autonomous Curator** | Feature | 2500 | alto | [03-autonomous-skills.md](./.claude/knowledge-base/hermes-deep-dive/03-autonomous-skills.md). Self-improving skills, depende de #9 + #11. |
| 16 | **7 execution backends** (Daytona, Modal, Bedrock…) | Feature | 4000 | alto | [06-execution-backends.md](./.claude/knowledge-base/hermes-deep-dive/06-execution-backends.md). Cada backend é 500-800 LoC. |
| 17 | **Multi-agent Kanban** | Feature | 4500 | muito alto | [01-kanban.md](./.claude/knowledge-base/hermes-deep-dive/01-kanban.md). Hermes precisou rewrite (v0.12 revertido, v0.13 re-landed). |

**Tier 5 total: ~11000 LoC, ~6 meses.** Cada um é uma "feature flagship" — não comprometer sem strategic review.

### Resumo de impacto

```
Tier 1 (quick wins)        2300 LoC   3 sem   →  15 DONE / 1 PARTIAL / 5 PENDING / 2 CULTURAL
Tier 2 (arq extensível)    3000 LoC   5 sem   →  17 DONE / 0 PARTIAL / 3 PENDING / 2 CULTURAL
Tier 3 (security)          1000 LoC   2 sem   →  19 DONE / 0 PARTIAL / 2 PENDING / 2 CULTURAL
Tier 4 (cross-session)     7200 LoC  12 sem   →  21 DONE + 4 features novos
Tier 5 (big bets)         11000 LoC   6 mês   →  paridade Hermes-class completa
```

**Recomendação Q3 2026**: comprometer com Tier 1 (3 semanas, alto leverage), revisar Tier 2 depois de #1 + #2 landed. Tiers 4 e 5 requerem strategic review (escopo > engenharia).

### Anti-patterns documentados (não confundir com prioridade)

- **NÃO começar por Tier 5** mesmo que pareça mais ambicioso — Kanban e Curator dependem de fork-agent (#9) e SessionDB (#11) que dependem de provider-as-plugin (#6) que depende de plugin-contract (#5). Pular tiers gera retrabalho.
- **NÃO mexer no agent-loop antes do Tier 1.2 (tool-call-failure-recovery)** — sem repair middleware, qualquer mudança no loop precisa lidar com malformed-tool-call cases manualmente.
- **NÃO shipar autonomous-skills (#15) sem Tier 3 security** — autonomous code execution + missing path guard + missing TOCTOU completeness = supply chain incident waiting to happen (lesson from Hermes v0.5 #2796 litellm removal).

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
