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

Open question that remained:
- **Supported cloud SCM providers at GA** — out of scope for v1.0 because cloud runtime is pre-release. Will be decided alongside Theo PaaS release.

## SDK Roadmap

> Hermes-Agent feature audit (2026-05-20). 28 features compared; **22/28 already implemented** in the SDK (FULL + PARTIAL). The 7 below are the SDK-scope gaps worth shipping next, ordered by leverage. Features that belong in TheoKit, TheoCloud, CLI, or standalone packages are deliberately excluded (see *Not-SDK* note at the end).

| # | Feature | Score | Por quê é SDK |
|---|---|---:|---|
| 1 | **Credential Pools** (Hermes #20) | 9 | HTTP-layer concern — key rotation pertence ao provider client (`internal/llm/*`). Dor real em produção (rate-limit overflow). |
| 2 | **Batch Processing** (Hermes #11) | 8 | Thin helper `Agent.batch(prompts[], { concurrency })`. Abre eval / training-data use case com ~3 dias de trabalho. |
| 3 | **Memory Providers built-in adapters** (Hermes #22) | 7 | Extension point já existe (ADR D98 `kind: "memory"`); falta shippar 2-3 adapters (Honcho / Mem0 / Supermemory) como pacotes `@theokit-memory-*`. |
| 4 | **Context Files — coverage completo** (Hermes #4) | 6 | `FileContextManager` hoje lê CLAUDE.md / AGENTS.md. Falta: SOUL.md, .cursorrules, .hermes.md. Loader extension trivial. |
| 5 | **Personality presets** (Hermes #26) | 5 | `systemPrompt` resolver layer (`/personality` preset switcher per session). Light shim sobre primitivo existente. |
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
