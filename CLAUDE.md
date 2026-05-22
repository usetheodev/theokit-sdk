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

Open question that remained:
- **Supported cloud SCM providers at GA** — out of scope for v1.0 because cloud runtime is pre-release. Will be decided alongside Theo PaaS release.

## SDK Roadmap

> Hermes-Agent feature audit (2026-05-20). 28 features compared; **22/28 already implemented** in the SDK (FULL + PARTIAL). The 7 below are the SDK-scope gaps worth shipping next, ordered by leverage. Features that belong in TheoKit, TheoCloud, CLI, or standalone packages are deliberately excluded (see *Not-SDK* note at the end).

| # | Feature | Score | Por quê é SDK |
|---|---|---:|---|
| ~~1~~ | ~~**Credential Pools** (Hermes #20)~~ ✅ DONE 2026-05-20 | ~~9~~ | Shipped via ADRs D123-D133. `internal/llm/credential-pool.ts` + `pool-aware-client.ts` + `credential-pool-store.ts`. 4 strategies, error-aware cooldown ladder, retry-then-rotate, fork inheritance, 100% backward compat. 1000+ fast-check runs. |
| ~~2~~ | ~~**Batch Processing** (Hermes #11)~~ ✅ DONE 2026-05-20 | ~~8~~ | Shipped via ADRs D134-D140. `Agent.batch(prompts, options)` static + `internal/runtime/async-semaphore.ts` (in-house, no `p-limit` dep) + `trajectory-helpers.ts` (opt-in ShareGPT exporter) + router ALS wiring so all in-flight batch agents share one CredentialPool (EC-A fix). Default concurrency 4. Failure isolation per-prompt. AbortSignal pending-only with `signal.reason` propagation. 55 new tests + 1600 fast-check runs. |
| ~~3~~ | ~~**Memory Providers built-in adapters** (Hermes #22)~~ ✅ DONE 2026-05-20 | ~~7~~ | Shipped via ADRs D141-D149. Formal `MemoryAdapter` interface + 3 workspace packages: `@usetheo/memory-supermemory` (zero-dep MIT default), `@usetheo/memory-honcho` (dialectic reasoning + AGPL disclosure), `@usetheo/memory-mem0` (cloud-only D148, unique `history(id)`, CVSS disclosure). 2 new agent-loop hooks (`pre_user_send`/`post_assistant_reply`) with EC-A context-byte cap, EC-B cross-adapter id rejection, EC-C identifier sanitization, EC-D Honcho session namespacing, EC-K Mem0 breaker-ignores-429. `agent.memory.{write,recall,delete}` direct API with lazy `initialize()`. 30 SDK tests + 56 adapter-package tests + 3 real-LLM examples. |
| ~~4~~ | ~~**Context Files — coverage completo** (Hermes #4)~~ ✅ DONE 2026-05-20 | ~~6~~ | Shipped via ADRs D150-D159. `FileContextManager` agora auto-descobre AGENTS.md + CLAUDE.md + GEMINI.md + `.cursor/rules/*.mdc` + `.theokit/THEO.md` via walk-up-to-git-root + glob. `@import` resolver (5-hop + cycle detection, EC-D per-import cap). MDC parser com globs/alwaysApply (EC-I empty-touchedFiles semantic). Aggregate cap (per-file 40k, total 120k) com tie-break determinístico (EC-J prompt-cache stability). EC-E privacy: disambiguation NUNCA vaza paths absolutos. Backward compat 100% (`.theokit/context/*.md` legacy + `.theokit/context.json` warn+load). 70 novos tests SDK (1132/1132 PASS). | 
| ~~5~~ | ~~**Personality presets** (Hermes #26)~~ ✅ DONE 2026-05-20 | ~~5~~ | Shipped via ADRs D160-D169. `Agent.usePersonality(name, opts?)` static on `SDKAgent` (D160 — overlays the active preset on top of the resolved system prompt via the existing `SystemPromptResolver` seam — zero core changes). Markdown + Zod frontmatter (D161, EC-C lowercase-only slug) under `.theokit/personalities/*.md` (project) + `~/.theokit/personalities/*.md` (user) with project-wins collision (D162). Session-default + persistent-opt-in (D163, EC-B delete-key invariant). Switch lifecycle preserves history + re-injects via D94 with user-role transcript marker (D164). Advisory tool whitelist via D102 layer 4 (D167, EC-I MCP exact match + EC-17 Levenshtein hint). Fork inheritance via ALS slug-snapshot (D168, EC-A parent-mid-flight-switch-does-NOT-mutate-fork). Cloud rejection via `UnsupportedRunOperationError` (D169, D122 pattern). 60 new tests across registry/store/resolver/switch/filter/fork/cloud + 9 integration tests on `Agent.usePersonality`. |
| 6 | **Image generation contract** (Hermes #15) | 5 | Plugin `kind: "image-provider"` — extension point apenas, NÃO o adapter FAL.ai específico. Esse fica em `@theokit-image-fal`. |
| 7 | **TTS contract** (Hermes #16) | 5 | Plugin `kind: "tts-provider"` — extension point apenas, NÃO o playback de áudio (que é UX layer). |

### Não-SDK (delegado a outras camadas)

Os items abaixo apareceram na auditoria Hermes mas **não pertencem a `@usetheo/sdk`** — vão em outros pacotes do monorepo:

| Hermes feature | Camada correta |
|---|---|
| API Server (OpenAI-compat HTTP) (#23) | **TheoKit** ou `@usetheo/api-server` (deployment concern) |
| IDE Integration ACP (#24) | `@usetheo/acp-adapter` (protocol shim independente) |
| Voice Mode live (#12) | Aplicação consumer (telegram-pro, TheoCode Desktop) |
| Vision image paste (#14) | CLI / TheoCode (clipboard handling) |
| Checkpoints `/rollback` (#6) | TheoCode (coding-agent vertical) |
| Browser Automation (#13) | `@theokit/browser` plugin standalone |
| Code Execution Python RPC (#9 partial) | TheoKit / autonomous-skills framework |
| RL Training (#25) | Tool standalone (`theokit-rl-export`) |
| Context References `@` (#5) | CLI / chat input layer |
| Skins & Themes (#27) | CLI (não aplicável a uma library) |

### Patterns ship history (referência)

Auditoria Hermes-Agent 2026-05-19 — `referencia/hermes-agent/` + sdk-references — culminou com **23/23 SDK patterns DONE** (Persistence, Agent Core Loop, Plugin & Extension, Background Work, Security, Testing, Error Handling). 122 ADRs registradas em `.claude/knowledge-base/adrs/`. Esta seção foi removida do CLAUDE.md para reduzir ruído; conteúdo histórico permanece no git em `git show 0a97794:CLAUDE.md`.

## Adoption Roadmap (v1.3 — post-Hermes parity)

> Strategic gap analysis (2026-05-21, curado 2026-05-22). Hermes patterns complete (23/23); SDK Roadmap v1.2 complete (5/7). Paridade técnica com Vercel AI SDK / Claude Agent SDK / OpenAI Agents SDK atingida. **A partir daqui o gargalo NÃO é mais "features de runtime"; é DX + observabilidade + paridade competitiva em primitivos de agente.** As 8 linhas abaixo são o backlog curado — Tier 1 bloqueia adoção, Tier 2 fecha gaps de superfície vs Vercel AI / OpenAI Agents / Mastra, Tier 3 é production hardening. Items removidos vs versão original (Computer use, Image gen + TTS, Cost tracking / budgets) ficam fora do roadmap atual — podem voltar quando houver pull-de-mercado claro.

| Tier | # | Item | Score | Status |
|---|---|---|---:|---|
| ~~T1~~ | ~~1~~ | ~~**CLI `theokit`**~~ ✅ DONE 2026-05-22 (ADRs D193-D201) | ~~10~~ | Shipado: `@usetheo/cli` workspace package + 4 subcommands (init, dev, inspect, eval) + 3 templates (minimal/ollama-local/telegram-bot) + `Theokit.inspect.*` public API. 60+ unit tests + 5 MUST FIX edge cases absorvidos (EC-A/B/C/E/F). |
| T1 | 2 | **Eval suite** (`Eval.create/run` + LLM-as-judge + métricas determinísticas) | 9 | Pendente |
| T1 | 3 | **Docs site** — vive em `../theo-opendocs` (Next.js + Fumadocs, source-of-truth para cookbook + API ref + tutorials + search) | 10 | Pendente |
| T2 | 4 | **Agent handoffs** (`Agent.handoffTo(other, { context })`) | 8 | Pendente |
| T2 | 5 | **Workflows declarativos** (`Workflow.create({ steps, on_failure, retry })`) | 7 | Pendente |
| T3 | 6 | **Semantic cache** (`Cache.semantic({ provider, threshold })`) | 6 | Pendente |
| T3 | 7 | **Gateway Slack adapter** (`@usetheo/gateway-slack`) | 5 | Pendente |
| T3 | 8 | **Bedrock + Vertex profiles** (`ProviderProfile` para AWS Bedrock + GCP Vertex AI) | 5 | Pendente |

### Rationale por linha

- **#1 CLI `theokit`** — A SDK não tem ponto de entrada além de `npm install`. Vercel AI e Mastra ganham 10x em onboarding. `theokit init` scaffolds projeto; `theokit dev` roda agente em hot-reload; `theokit inspect` lista plugins/skills/providers; `theokit eval` dispara suite. NÃO é TheoCode (coding agent) — é o developer-CLI da SDK. Pertence a este monorepo como workspace package `@usetheo/cli`.
- **#2 Eval suite** — Braintrust ($79M), LangSmith, Helicone fazem disso negócio. Sem eval-as-code (not eval-as-dashboard) ninguém vai pra produção com confiança. API alvo: `Eval.create({ dataset, scorers, agent })` retorna `EvalRun` com aggregate metrics + per-row traces. Reutiliza `Telemetry` (D34) + `agent.batch` (D134).
- **#3 Docs site** — `docs.md` é canonical mas é um único arquivo markdown — não escala. Cookbook navegável + API reference auto-gerada de TS + tutorials versionados + search são table-stakes para qualquer SDK em 2026. **Vive em repo separado `../theo-opendocs/`** (Next.js + Fumadocs já bootstrapped). O `docs.md` deste repo continua canonical; o site consome via build pipeline.
- **#4 Agent handoffs** — OpenAI Agents SDK trata como primitivo de primeira classe. Hoje temos `fork()` (D110-D114) + subagents (Toolset) mas **não** handoff declarativo entre agentes pares com transferência de contexto + tool whitelist + conversation history. Mercado de multi-agent quente: CrewAI, AutoGen, Swarm. ADR alvo: D193-D198.
- **#5 Workflows declarativos** — Mastra ganha aqui — temos `runUntil` (D116) + AsyncGenerator (imperativo) mas não workflows shape declarativo: `step.parallel`, `step.conditional`, `step.retry_with_backoff`, persistência de estado entre steps. Inngest e Temporal são as referências. ADR alvo: D199-D204.
- **#6 Semantic cache** — Helicone Cache e LangCache fazem isso. Reduz custo 30-70% em prod com queries repetitivas. Reusa `MemoryAdapter` (D141) como storage backend — embedding-based key match com cosine threshold. Plug-in via hook `pre_send` (interceptar antes de hit no LLM).
- **#7 Gateway Slack adapter** — Continuação natural pós-Telegram + Discord (D170-D181). Slack Bolt SDK + Socket Mode (não Events API webhook). Reutiliza `BasePlatformAdapter` (D172). ADR alvo: D205-D208.
- **#8 Bedrock + Vertex profiles** — Bloqueia enterprise AWS/GCP. D11 deferiu; agora é hora. Reusa `ProviderProfile` data-only (D105) + `Transport` orthogonal (D106). Bedrock = SigV4 signing; Vertex = service-account JWT.

### Itens shipados (referência histórica)

- ~~Local provider profiles (Ollama + LM Studio + llama.cpp)~~ ✅ **DONE 2026-05-21** (ADRs D182-D192). Stack 100% local end-to-end (chat + embedding + RAG + tools) sem nenhuma API key remota. Gateway concurrency fix + Ollama native API client incluídos.

### Itens removidos vs versão anterior

| Item removido | Razão |
|---|---|
| Docs site Nextra/Mintlify (`apps/docs/`) | Substituído por `#12` que aponta para `../theo-opendocs/` — repo dedicado já bootstrapped. |
| Computer use (Anthropic `computer_20241022`) | Sem pull-de-mercado claro ainda; mercado quente mas adoção real concentrada em poucos use-cases. Pode voltar. |
| Image gen + TTS contracts | Plugin extension-points têm valor menor sem ecossistema. Volta quando primeiro adapter externo (FAL.ai/ElevenLabs) for solicitado. |
| Cost tracking / budgets | Enterprise concern; relevante depois que B2B path estiver mais maduro. Telemetry (D34) já dá observabilidade de tokens — basta agregar quando alguém pedir. |

### Não-Roadmap-v1.3 (delegado a outras camadas)

Continuamos delegando — a roadmap acima é apenas SDK. Items abaixo apareceram na análise mas pertencem a outros lugares:

| Item | Camada correta |
|---|---|
| Playground web (React) | `apps/docs/playground/` ou TheoCode Desktop (não é SDK runtime) |
| Schema visualizer / DAG de subagents | `apps/docs/` (visualização sobre output do `theokit inspect`) |
| Multi-tenancy primitives | TheoCloud (apex commercial — não OSS funnel) |
| WhatsApp Business adapter | `@usetheo/gateway-whatsapp` separado (Meta App review fricção) |
| Matrix / IRC adapters | Community-driven — pacotes terceiros via `BasePlatformAdapter` |
| Agent marketplace / registry | TheoCloud (concern de hosting + monetização) |
| Replay/trace UI inspector | `apps/docs/` ou TheoCode Desktop (consumidor de `Telemetry`) |
| Voice live mode (WebRTC + Whisper streaming) | TheoCode Desktop / aplicação consumer (telegram-pro, etc.) |

### Estratégia de execução

**Sequência recomendada (NÃO ranking por score):**

1. **CLI `theokit` (#1) + Docs site (#3) em paralelo** — Docs vive em `../theo-opendocs` (repo dedicado), pode evoluir independente. CLI fecha o vão de onboarding. Tudo o resto compõe melhor com esses dois shipados.
2. **Eval suite (#2)** — consome o CLI (`theokit eval`); só faz sentido depois que `@usetheo/cli` exista.
3. **Handoffs (#4) antes de Workflows (#5)** — handoffs é o primitivo; workflows compõe handoffs + conditionals.
4. **T3 (#6 / #7 / #8) abre quando T1+T2 estabilizar** — production hardening sobre fundação estável, não sobre alvo móvel.

**Critério de "DONE" continua o mesmo da SDK Roadmap original:**
- Cobertura via ADRs registradas em `.claude/knowledge-base/adrs/`
- Tests + real-LLM validation (regra `.claude/rules/real-llm-validation.md`)
- Sem stubs/mocks no código de produção (regra `.claude/rules/no-stubs-no-mocks-no-wired.md`)
- Dogfood real (telegram-pro / discord-pro / examples)
- `CHANGELOG.md` entry no pacote afetado

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
