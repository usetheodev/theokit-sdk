# Changelog

All notable changes to `@usetheo/sdk` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed (default model: composer-2 → free agentic model)
- **Default model id swept SDK-wide from the placeholder `composer-2` to `google/gemini-2.0-flash-exp:free`** (OpenRouter free tier, solid tool-calling for agentic flows).
- **New `internal/runtime/default-model.ts`** exports `DEFAULT_AGENTIC_MODEL_ID` — single source of truth for the fallback model id, used by `cloud-agent.ts`, `local-run.ts`, and `internal/catalog/fixtures.ts`.
- **`FIXTURE_MODELS` catalog** swapped to the new model id + display names ("Gemini 2.0 Flash (free)"). Golden snapshot `tests/golden/theokit/models.json` updated.
- **All 30+ tests + golden JSON snapshots + 10+ doc pages + 3 examples** swept from `composer-2` to the new id. Public `docs.md` examples now show a runnable default.
- Rationale: under the no-stubs-no-mocks-no-wired rule, a placeholder model id that maps to nothing real surfaces fixture mode to consumers who pass real keys. The new default is a real, free OpenRouter model — works out of the box with `OPENROUTER_API_KEY`, and per-call `model: { id: "..." }` override is unchanged.

### Changed (cloud pre-release guard — no-stubs-no-mocks-no-wired enforcement, round 2)
- **`CloudAgent.listArtifacts()` and `CloudAgent.downloadArtifact()`** now throw `ConfigurationError(code: "cloud_runtime_pre_release")` when invoked with a non-fixture API key. Previously they returned hardcoded fixture data (`buildFixtureArtifacts()` + `Buffer.from("fixture artifact content for ...")`) regardless of key — silently passing fixture content off as real PaaS responses.
- **Fixture artifacts are now lazy-built** inside the fixture-mode branch of `listArtifacts/downloadArtifact` instead of eagerly seeded in the constructor. Real-key callers no longer carry fixture state.
- **`CloudAgent` `summary` field** is now `"Cloud contract fixture"` only in fixture mode; real-key cloud agents register as `"Cloud agent"`.
- **New `isFixtureMode()` private** centralizes the "are we in fixture mode?" check (matches the rule in `internal/fixture-mode.ts`: `theo_test_*` key + no `THEOKIT_API_BASE_URL`).
- **New golden test** `cloud-prerelease-guard.golden.test.ts` (4 cases) locks the behavior: real keys get `cloud_runtime_pre_release`, fixture keys get fixture artifacts, path-traversal still rejected.

### Added (OpenRouter embedding adapter)
- **`openrouter` embedding adapter** — proxies through `https://openrouter.ai/api/v1/embeddings` (OpenAI-compatible shape). Caller selects the underlying model via the standard OpenRouter ids (`"openai/text-embedding-3-small"`, `"mistralai/mistral-embed"`, etc.). Honors `OPENROUTER_API_KEY` + `OPENROUTER_API_BASE_URL`.
- **`MemorySettings.index.embedding.provider`** and **`DreamingSweepOptions.embedding.provider`** unions extended with `"openrouter"`.
- **`examples/memory-dreaming`** now accepts `OPENROUTER_API_KEY` in addition to `OPENAI_API_KEY` / `MISTRAL_API_KEY`. Validated end-to-end: 6 facts → 4 semantic clusters (3 Vitest paraphrases grouped correctly).
- **Stubbed-fetch test** in `multi-adapter.golden.test.ts` proves the OpenRouter adapter actually embeds (1536-dim vectors round-tripped from the OpenAI-compatible response shape).

### Changed (cheaper agentic chat model in examples)
- **`openai/gpt-4o-mini` → `google/gemini-2.0-flash-001`** in the 4 chat examples (`memory`, `memory-search`, `memory-get`, `active-memory`). ~33% cheaper input tokens at similar tool-calling fidelity for these recall scenarios. Pricing as of 2026-05.

### Removed (no-stubs-no-mocks-no-wired rule enforcement)
- **5 stub embedding adapters removed from the catalog**: `voyage`, `deepinfra`, `lmstudio`, `google`, `bedrock`. Files deleted; `MEMORY_EMBEDDING_ADAPTERS` now exposes only `openai` + `mistral` (the implementations that actually ship).
- **`stub-adapter.ts` factory deleted** — no callers remain.
- **LanceDB backend stub removed**. `MemoryBackend` is now `"sqlite-vec"` only. `IndexManager.open({ backend: "lancedb" })` no longer compiles; the runtime throw is gone.
- **`ActiveMemoryOptions.mode` field removed** — the `"subagent"` member was a typed promise with no implementation. Active Memory was always running in `"search"` mode regardless of the option.
- **`createStubRun` + `createHistoricalCloudRun` deleted**. `stub-run.ts` removed entirely. Two callers replaced with typed errors:
  - `Agent.getRun(runId)` now throws `UnknownAgentError(code: "run_not_found")` when the registry has no record (was: synthetic Run with `agentId: "agent-pending"`, `status: "finished"`).
  - `Agent.getRun(runId, { runtime: "cloud" })` now throws `ConfigurationError(code: "cloud_runtime_pre_release")` (was: stub historical Run).
  - `runCronJob` with orphan `agentId` now throws `UnknownAgentError(code: "agent_not_registered")` (was: stub Run stuck at `status: "running"`).
- **`MemoryEmbeddingRuntime` public BYO surface removed** — `Memory.runDreamingSweep` no longer accepts `embedding: { runtime: ... }`. The only consumer was a demo fallback that itself has been removed. The type alias is gone from the public barrel.
- **`makeLocalDemoRuntime` removed from `examples/memory-dreaming/`**. The example now fails fast when neither `OPENAI_API_KEY` nor `MISTRAL_API_KEY` is set.
- **`@lancedb/lancedb` removed from `tsup.config.ts` external list** — no longer referenced by the bundle.

### Changed (no-stubs-no-mocks-no-wired rule enforcement)
- **Public `MemorySettings.index.embedding.provider`** narrowed from a 7-id union to `"openai" | "mistral"`. Consumers selecting a removed provider now get a TypeScript error at the call site instead of a runtime crash.
- **`docs.md` and the docs site** updated to reflect the trimmed catalog and BYO-runtime removal.
- **`examples/memory-dreaming/README.md`** removed the "future-work cron integration" claim. Scheduling consolidation is documented as a user concern (call `Memory.runDreamingSweep` from any scheduled context).
- **`placeholderScript` renamed to `unusedFixtureScript`** in `real-local-run.ts` + `real-cloud-run.ts` with a clarifying comment — the FixtureScript shape is required by the base Run class but never consumed by the real-LLM path.
- **`index-schema.ts` comment** corrected — `meta` table description matches what the code actually persists (embedding identity), and the `embeddings` virtual table is now documented.

### Changed (memory-system-openclaw-parity, Increment D — Dogfood follow-ups)
- **`local-agent.ts` decomposed** — memory glue (lazy IndexManager + tools cache + Active Memory breaker + summary cache) extracted to `local-agent-memory.ts`. Brings `local-agent.ts` under the G8 400-LoC cap.
- **`legacyMemoryJsonPath` centralized in `memory/types.ts`** — removes the 9-line jscpd clone between `migration.ts` and `runtime/memory-store.ts`. Both now call the leaf-module helper.

### Added (memory-system-openclaw-parity, Increment C — Dogfood examples + Memory namespace)
- **`Memory` public namespace** exported from `@usetheo/sdk` — `Memory.runDreamingSweep({ cwd, embedding })` lets users trigger consolidation outside of `agent.send()` (e.g. from a cron job handler).
- **`MemoryEmbeddingRuntime` public type** — `embedding` now accepts either a built-in provider id (`{ provider, model? }`) OR a BYO runtime (`{ runtime: MemoryEmbeddingRuntime }`). Enables self-hosted/local embedding models and self-contained demos without external API creds. Mirrors OpenClaw's `EmbeddingRuntime` shape from ADR D3.
- **4 new example apps** under `examples/`:
  - **`memory-search`** — LLM uses `memory_search` to find facts in MEMORY.md.
  - **`memory-get`** — LLM uses `memory_get` for bounded reads of `notes/*.md`.
  - **`active-memory`** — blocking pre-send recall injects an `<active-memory>` block.
  - **`memory-dreaming`** — `Memory.runDreamingSweep` consolidates duplicates + clusters + writes a dream-diary entry. Ships with a deterministic local-demo embedding fallback so the example runs without `OPENAI_API_KEY` / `MISTRAL_API_KEY`.
- **`examples/README.md` inventory** updated with all 4 new examples marked ✅ Full.

### Added (memory-system-openclaw-parity, Increment B — Active Memory wire-up)
- **`memory.activeRecall.enabled`** runtime wire-up — when `true`, the SDK calls `runActiveMemory` before every `send()` and prepends the recall summary as a `<active-memory>` block to the LLM system prompt (priority 5 — above context/skills/memory).
- **Per-agent `CircuitBreaker` + `ActiveMemoryCache`** — instantiated lazily on first send with active recall enabled. Keyed by `agentId` so multiple agents in the same process don't share state.
- **Stub-server E2E proof** — captured Anthropic request body contains `<active-memory>` when enabled, and does NOT when disabled.
- **Active recall config surface** — `queryMode` (`"message"` / `"recent"` / `"full"`), `timeoutMs`, `maxSummaryChars`, `persistTranscripts` are all wired from `MemorySettings.activeRecall` through to `runActiveMemory`.

### Added (memory-system-openclaw-parity, Increment A — Agent.create/send wire-up)
- **`MemorySettings.index`** public field — `{ tools?: boolean; backend?: "sqlite-vec" | "lancedb"; embedding?: { provider, model? } }`. When `memory.enabled === true` and `index.tools !== false`, the SDK lazily opens an `IndexManager` on first send + registers `memory_search` and `memory_get` with the LLM. Default backend is `sqlite-vec`; default embedding is none (FTS-only mode).
- **`MemorySettings.activeRecall`** public field — reserved for Phase 7 wire-up (next increment). Type surface live today; runtime hookup pending.
- **Stub-server E2E tests** prove memory tools appear in the captured Anthropic request body's `tools` array when memory is enabled, and are absent when disabled or opted-out via `index.tools: false`.
- **Lazy embedding adapter resolution** — when `index.embedding.provider` is set, the SDK looks the adapter up via `MEMORY_EMBEDDING_ADAPTERS` and instantiates it on first send. Adapter failures degrade gracefully to FTS-only mode with a stderr warning.

### Added (memory-system-openclaw-parity, Phase 13)
- **Cross-validation report** at `.claude/knowledge-base/reviews/cross-validation/memory-system-openclaw-parity-xval-2026-05-16.md`. Verdict **APROVADO COM RESSALVAS**, zero BLOCKERs. All 10 ADRs cross-checked against shipped code; all 13 edge cases verified resolved or documented.

### Added (memory-system-openclaw-parity, Phase 12)
- **Backend selector** — `IndexManager.open({ backend: "sqlite-vec" | "lancedb" })`. Default `"sqlite-vec"`. `"lancedb"` reserved for Phase 12.1; throws `ConfigurationError(code: "memory_backend_not_implemented")` today (same KISS pattern as the Phase 11 stub embedding adapters).

### Added (memory-system-openclaw-parity, Phase 11)
- **`MEMORY_EMBEDDING_ADAPTERS` catalog** exports all 7 OpenClaw provider ids: `openai`, `mistral`, `voyage`, `deepinfra`, `lmstudio`, `google`, `bedrock`. Switching is one config field.
- **Mistral adapter** fully implemented — `mistral-embed` (1024 dims) via shared OpenAI-compatible factory (`POST /v1/embeddings`). Honors `MISTRAL_API_KEY` + `MISTRAL_API_BASE_URL`.
- **`createOpenAiCompatibleRuntime` shared factory** — extracted from the OpenAI adapter so any provider exposing the `{ model, input }` → `{ data: [{ embedding }] }` REST shape can plug in with a one-file thin wrapper.
- **5 stub adapters** (Voyage, DeepInfra, LMStudio, Google, Bedrock) — metadata-only. `embed()` throws `ConfigurationError(code: "adapter_not_implemented")` so callers detect the gap without crashing the agent loop.

### Added (memory-system-openclaw-parity, Phase 10)
- **Wiki supplements** — files under `.theokit/memory/wiki/*.md` are read-only auxiliary corpora discovered by `discoverWikiFiles`. Indexed alongside `MEMORY.md` + `notes/*.md` with `source: "wiki"` tag in the `files` table.
- **Corpus filtering in search** — `IndexManager.search(query, { sources: ["wiki"] })` returns only wiki hits; default search returns memory + wiki together. `memory_search` tool already honors `corpus: "wiki" | "memory" | "all"` per the OpenClaw schema from Phase 6.
- **Source coercion on conflict** — `upsertFile` accepts an explicit `source` arg so reclassifying a file (moving a note into the wiki dir, etc.) updates the tag on next sync via `ON CONFLICT DO UPDATE SET source = excluded.source`.

### Added (memory-system-openclaw-parity, Phase 9)
- **`runDreamingSweep`** — cron-driven memory consolidation (ADR D7). Three phases mirror OpenClaw:
  - **light** — drop near-duplicate facts via cosine similarity (default threshold 0.95).
  - **REM**  — single-link agglomerative clustering by cosine similarity (default threshold 0.75).
  - **deep** — write a `notes/dreamed-<ts>.md` per sweep with consolidated clusters.
- **Dream-diary at `.theokit/memory/dream-diary.md`** — append-one-entry-per-sweep. Each entry carries timestamp + content hash (idempotency contract) + counts (`factsBefore`, `factsAfter`, `duplicatesRemoved`, `clustersCreated`, `notesWritten`).
- **All dreaming writes are atomic (EC-3)** — `replaceFileAtomic` for notes and diary; per-cwd mutex held for the whole sweep so concurrent `Remember:` appends can't race.
- **LLM narrative summarization deferred to Phase 9.1** — v1 ships deterministic clustering only. The interface is stable enough to plug an LLM-mediated `narrative.ts` later without changing the orchestrator.

### Added (memory-system-openclaw-parity, Phase 8)
- **CircuitBreaker** for Active Memory — `{ maxTimeouts: 3, cooldownMs: 60000 }` defaults. After N consecutive timeouts, `shouldSkip(key)` returns `true` until cooldown elapses. `recordSuccess` resets the counter immediately. Per-key isolation (multiple agents in one process don't share state).
- **`ActiveMemoryCache`** — TTL-bounded LRU keyed by `sha256(userText + queryMode)`. Default TTL 15s, capacity 1000. Cache hits skip the IndexManager search entirely.
- **`runActiveMemory` integration** — accepts optional `breaker` + `cache` + `agentKey` + `runId` + `persistTranscripts` + `cwd`. Breaker is consulted on entry and updated by status; cache stores results on the way out; transcripts written under `.theokit/memory/transcripts/active-memory/<runId>.json` when enabled.
- **`persistActiveMemoryTranscript`** — JSON transcript persistence. Failures swallowed with stderr warning so transcript IO never crashes the agent run.

### Added (memory-system-openclaw-parity, Phase 7)
- **`runActiveMemory`** — blocking pre-send recall (ADR D6). Default `mode: "search"` calls `IndexManager.search` deterministically; `mode: "subagent"` (LLM-mediated curation) is stubbed for Phase 7.1. Query modes: `"message"` (only the user text), `"recent"` (user text + last N user turns, default 2), `"full"` (entire conversation). Hard timeout via `Promise.race` (default 15000ms) — returns `status: "timeout"` instead of throwing.
- **Status discriminator** — `ActiveMemoryStatus` covers `"ok" | "timeout" | "skipped" | "no-recall" | "error"`. Caller-side dispatch is one switch statement.
- **`ActiveMemoryPromptProvider`** at priority 5 (before context/skills/memory) — contributes the `<active-memory>` block via `SystemPromptAssemblyContext.activeMemorySummary`. Summary is XML-escaped (D9). Block omitted when summary is empty.
- **Pipeline auto-registration** — `SystemPromptPipeline.default()` now wires 5 providers: ActiveMemory (5) → Context (10) → Skills (20) → Memory (30) → Base (100).

### Added (memory-system-openclaw-parity, Phase 6)
- **`memory_search` + `memory_get` tools** (ADR D5) with OpenClaw-mirrored JSON schemas and descriptions. `memory_search` returns ranked hits with `{ path, startLine, endLine, score, snippet, citation, source }`; `memory_get` returns bounded excerpts with truncation info.
- **Path-traversal guard (EC-2)** — `memory_get` resolves the requested path against the memory root and throws `ConfigurationError(code: "memory_path_escapes_root")` if the resolved path escapes (e.g. `../../etc/passwd`).
- **Result-size cap (EC-10)** — `memory_search` truncates the response when concatenated snippets exceed `maxTotalChars` (default 16384). Low-rank hits are dropped first; `truncated: true` marker on the payload.
- **Agent-loop integration** — new `AgentLoopInputs.memoryTools?: MemoryToolSpec[]` field; `collectTools` appends memory tools alongside shell + MCP tools; `tool-dispatch` routes `origin === "memory"` calls through a dedicated handler that wraps JSON-encoded results.

### Added (memory-system-openclaw-parity, Phase 5)
- **sqlite-vec vector index** under the existing SQLite DB (ADR D2). `vec0` virtual table stores per-chunk embeddings; `vectorSearch` runs KNN with `MATCH` syntax. `loadSqliteVecExtension` wraps the native load with a typed `sqlite_vec_unavailable` ConfigurationError (EC-8) instead of a raw native exception.
- **`meta` table tracks embedding identity** (`providerId` + `model` + `dimension`). On `IndexManager.open`, current adapter config is compared against stored meta — any mismatch drops the `embeddings` table and forces a full re-embed on next `sync()` (EC-1).
- **Hybrid scoring** (ADR D4): FTS top-K + vector top-K merged, scores combined via `vectorScore * vectorWeight + textScore * textWeight` (defaults `0.6` / `0.4`, configurable per-call). Vector-only hits surface alongside FTS hits via a chunk-id outer join. `MemorySearchHit.vectorScore` exposed when vector backend is active.
- **`IndexManager.open({ cwd, embedding? })`** — embedding-aware constructor. FTS-only still works when `embedding` is omitted; backend reported via `status().backend` as `"fts-only"` or `"hybrid"`.

### Added (memory-system-openclaw-parity, Phase 4)
- **`MemoryEmbeddingProviderAdapter` interface** (ADR D3) mirrors OpenClaw's contract: `id`, `defaultModel`, `transport`, `authProviderId`, `autoSelectPriority`, `create(options) → EmbeddingRuntime`. Adapters live under `internal/memory/adapters/`.
- **OpenAI embedding adapter** (`openai-embedding.ts`) — native fetch only, no `openai` SDK dep. Batches at 100 texts/call. Retries once on 429 + 5xx with linear backoff (EC-9). Empty inputs skipped. Honors `OPENAI_API_KEY` + `OPENAI_API_BASE_URL`. Default model `text-embedding-3-small` (1536 dims).
- **LRU embedding cache** keyed by `sha256(model+text)`. Max 5000 entries; oldest evicted first. Observable via `runtime.stats()` (`cacheHits` / `cacheMisses` / `httpCalls` / `retries`).

### Added (memory-system-openclaw-parity, Phase 3)
- **SQLite + FTS5 index** at `.theokit/memory/.index/memory.sqlite` (ADR D2). Schema: `files`, `chunks`, `chunks_fts` (FTS5 virtual table), `meta`. Triggers keep FTS in sync with `chunks` on insert/delete. WAL mode, foreign keys on. Backed by `better-sqlite3` (optional peer dep) — `node:sqlite` fallback path documented for Node 22.5+.
- **`IndexManager.open / sync / search / status / close`** — full lifecycle. `sync()` walks `MEMORY.md` + `notes/*.md`, computes content hashes, skips unchanged files, deletes old chunks before reindexing changed ones. `search()` runs FTS5 BM25 ranking, returns `MemorySearchHit[]` with `path`, `startLine`, `endLine`, `score`, `textScore`, `snippet`, `source`, `citation` (path:startLine-endLine).
- **Corrupt-DB recovery (EC-7)** — when opening fails with "malformed" / "not a database" / "encrypted" errors, the file is renamed to `<path>.corrupt-<ts>` (plus `-wal` and `-shm` siblings) and the schema is rebuilt from scratch. Diagnostic line emitted to stderr.

### Added (memory-system-openclaw-parity, Phase 2)
- **`chunkMarkdown`** splits markdown by heading boundaries + blank-line paragraph boundaries. Oversize paragraphs split on word-boundary nearest the cap (EC-6) — never mid-word. Each chunk carries `startLine` / `endLine` / `text` / `hash` (sha256) / optional `heading`.
- **`readMemoryFileBounded`** — bounded read with `from` (1-indexed) + `lines` (default 200, mirrors OpenClaw's `DEFAULT_MEMORY_READ_LINES`). Returns `linesReturned`, `totalLines`, `remainingLines`, `truncated` (true when content remains past the slice). Foundation for Phase 6's `memory_get` tool.
- Public types `MemoryChunk`, `MemoryReadResult`, `MemoryFileEntry` in `internal/memory/types.ts` mirroring OpenClaw's engine-storage shapes.

### Added (memory-system-openclaw-parity, Phase 1)
- **Markdown-first memory storage** (ADR D1) — facts now persist to `.theokit/memory/MEMORY.md` under a `## Facts` section, human-editable and git-friendly. The legacy JSON file (`.theokit/memory/<namespace>/<scope>-<userId>.json`) migrates one-shot on first read and is deleted afterward (ADR D8). Behavior is preserved: `readMemoryFacts` + `appendMemoryFact` keep their signatures.
- **`replaceFileAtomic` + per-cwd mutex** — every append writes to `<file>.tmp`, fsync, rename; concurrent appends within the same process serialize through a per-`cwd` mutex (edge-case review EC-4). Multi-process safety is out of scope for v1 (documented).
- **`MEMORY.md` section creation** preserves any free-form content the user added (edge-case review EC-5).

### Added (v1-completeness)
- **Memory auto-write-on-send** in the real LLM runtime (ADR D1/D2 of v1-completeness). When `memory.enabled === true` and the user message starts with `Remember: <fact>`, the SDK persists the fact via `appendMemoryFact` BEFORE the LLM call so durability is independent of the LLM. The same `<memory>` block recalls it on subsequent sends. Empty facts are skipped (EC-3); memory must be opt-in (EC-4). Fixture and real-runtime paths share `isMemoryWritePrompt` + `extractMemoryFact` helpers — no behaviour drift between modes.

### Changed (v1-completeness)
- **`Agent.resume(agentId)` now awaits `initialize()`** before returning the LocalAgent handle, matching `Agent.create` semantics. Previously, resumed agents had empty `context.snapshot()`, empty `skills.list()`, and unloaded hooks/plugins/subagents — silent breakage for users (and for Cron's internal use). The fix is monotone: callers that worked before still work; callers that were silently broken are now correct.
- **Real LLM runtime now threads prior session history** into every `agent.send()`. `AgentLoopInputs.priorMessages` carries the user+assistant turns from previous sends on the same agentId; `initLoopContext` prepends them to the LLM message array before the current user message. Enables `Agent.resume(agentId)` to continue a conversation in the real runtime — previously the LLM saw only the latest message. Fixture path was unaffected; it already had session messages wired.
- Removed the now-redundant `persistMemoryFact` wiring from `createFixtureRun`. The shared auto-write path in `LocalAgent.send` covers both fixture and real runtimes; the fixture's `beforeComplete` hook becomes a no-op (its `persistMemoryFact` parameter is unset). Eliminates the double-write hazard the auto-write feature would otherwise introduce in fixture mode (EC-2).

### Added (runtime-gaps fix)
- `SystemPromptPipeline` + `SystemPromptProvider` strategy pattern (ADR D8) — Context (priority 10), Skills (priority 20), Memory (priority 30), Base (priority 100) auto-injected as XML-tagged blocks into the LLM system prompt. Future blocks plug in by writing one new provider class.
- `FallbackLlmClient` wraps the resolved provider chain. On `NetworkError` from the primary handshake, the SDK transparently retries with the next entry (ADR D2). Failover boundary at first event yield — mid-stream errors are NOT retried. Aborted signal between attempts short-circuits the chain (edge-case EC-3).
- `SendOptions.onStep` / `onDelta` now fire in the real LLM agent loop (ADR D1) — `onStep` per completed assistant text turn and per tool call; `onDelta` per `text-delta` token. Callback errors are caught and logged, never crash the run.
- `SkillsSettings.autoInject` (default `true`) — opt out of the `<skills>` block via `AgentOptions.skills.autoInject: false`.
- `MemorySettings` (`AgentOptions.memory`) public type: `enabled`, `namespace`, `userId`, `scope`, `storePath`, `autoInject`. Recalled facts auto-inject as a `<memory>` block on every send.
- `SystemPromptContext.memory` field — recalled facts exposed to custom `systemPrompt` resolvers (appended per the field-order compatibility contract).
- `escapeBlockBody` helper (ADR D9) — every dynamic block body (context source, skill description, memory fact) is XML-escaped before embedding so workspace content containing literal `</context>` cannot break out of its block (prompt-injection defence).

### Added
- Initial package scaffold: dual ESM+CJS build via tsup 8, types-first `exports` map with sub-paths for `.`, `./cron`, and `./errors` (initial scaffold).
- Public type contract from [`docs.md`](../../docs.md): `Agent`, `Run`, `SDKMessage`, `InteractionUpdate`, `ConversationTurn`, `McpServerConfig`, etc. (initial scaffold).
- Error class hierarchy: `TheokitAgentError`, `AuthenticationError`, `RateLimitError`, `ConfigurationError`, `IntegrationNotConnectedError`, `NetworkError`, `UnknownAgentError`, `UnsupportedRunOperationError` (initial scaffold).
- `Cron` namespace skeleton: `Cron.create()`, `Cron.list()`, `Cron.get()`, `Cron.delete()`, `Cron.enable()`, `Cron.disable()`, `Cron.run()` (manual fire), and scheduler control via `Cron.start()` / `Cron.stop()` / `Cron.status()`. Cron job type contract (`CronJob`, `CronCreateOptions`, `CronSchedulerStatus`, etc.) (initial scaffold).
- Smoke test verifying public API is importable and stub methods reject with `ConfigurationError` (initial scaffold).
- Context manager type contract: `ContextSettings`, `ContextSource`, `ContextSnapshot`, `SDKContextManager`. `SDKAgent.context?` exposes the manager when context is enabled via `AgentOptions.context`.
- Provider routing type contract: `ProviderCapability`, `ProviderRoute`, `ProviderRoutingSettings`, `PluginsSettings`, `ResolvedProviderRoute`, `SDKProvidersManager`, `SDKProvider`. `SDKAgent.providers?` exposes the manager. `Theokit.providers.list()` stub for provider catalog reads.

### Changed
- License standardized to **Apache-2.0** (was MIT). Aligns all usetheo open-core pillars under a single license — see root `CLAUDE.md` strategic review of 2026-05-14.
- `UnsupportedRunOperationError` now extends `TheokitAgentError` with `isRetryable: false` and stable `code: "unsupported_run_operation"`. Previously extended `Error` directly — old `instanceof TheokitAgentError` checks against this error now return `true`.
- `RunOperation` union extended with `"listArtifacts"` and `"downloadArtifact"`. Agent-level operations can now be reported through `UnsupportedRunOperationError.operation`.

### Changed (runtime-gaps fix)
- Memory recall lifted from the fixture-only path into the shared agent path. A corrupted memory file degrades to "no facts loaded" with a stderr warning instead of crashing the run (edge-case review EC-4).
- `FileContextManager` exposes a new internal `internalAssemblySnapshot()` so the system-prompt pipeline can read per-source token slices without the public `snapshot()` having to leak the same shape.

### Fixed
- 5 previously ⚠️ Partial example flows now work end-to-end against real providers: `examples/streaming-callbacks` (steps/deltas fire), `examples/provider-fallback` (`status=finished` after primary failover), `examples/context-manager` (model answers "8675309"), `examples/skills` (model lists `code-review, doc-writer`), `examples/memory` (model recalls the persisted fact via auto-injected `<memory>` block).
- `setupSchema` of fixture providers no longer leaks env-var-name shaped strings (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, ...) that matched the hygiene regex. Schemas now use a generic `credential` property name (internal contract change; public shape unchanged).

### Implementation status (Phase 2 — real runtime)
- **Real cron scheduler** powered by `croner@^9.0.0`. `Cron.start()` installs a timer per enabled local job, `nextRunAt` is computed from the cron expression and timezone, jobs actually fire on schedule. `Cron.disable()` / `Cron.enable()` / `Cron.delete()` add/remove timers without losing the job state.
- **Real hook execution** via `HooksExecutor`: `.theokit/hooks.json` is parsed into events (`preRun`, `postRun`, `preToolUse`, `postToolUse`, `stop`), each fires the configured command with the payload JSON over stdin. Non-zero exit codes deny the operation; JSON stdout can return `{"decision":"allow|deny|feedback","reason"|"feedback"}`. preRun denials throw `ConfigurationError("preRun hook denied execution")` from `agent.send()`. preToolUse denials short-circuit the tool with `exitCode: 126`.
- **Real MCP client** for `stdio` (spawn + JSON-RPC over stdin/stdout) and `http` (fetch+JSON-RPC). Implements `initialize`, `tools/list`, `tools/call` per MCP 2024-11-05.
- **Real shell tool** spawning `sh -c <command>` with stdout/stderr capture, SIGKILL-on-timeout, and a sandbox heuristic that refuses obvious unsafe commands when `local.sandboxOptions.enabled` is true.
- **Real LLM provider clients** (Anthropic Messages SSE, OpenAI Chat Completions SSE, OpenRouter via the OpenAI shape). Use native `fetch` only — no SDK dependencies. Translate vendor SSE deltas into a provider-agnostic `LlmEvent` stream + `LlmFinish` accumulator.
- **Real agent loop** orchestrates the LLM-tool-LLM cycle: system event → user event → LLM stream → assistant event → optional `tool_use` dispatch (with preToolUse + postToolUse hooks) → result fed back → next turn. Max 8 iterations by default.
- **Real cloud Run** via Theo PaaS SSE: `POST /v1/agents/{id}/runs` with `accept: text/event-stream`, translates `status`, `assistant`, and `result` events into the SDK `SDKMessage` stream. Activates when a non-fixture API key + `THEOKIT_API_BASE_URL` are set.
- **Streaming progressive events**: `Run.stream()` is now a true progressive AsyncGenerator — events arriving from the real runtime over time are yielded as soon as they're appended, not only at termination.
- **Real local runtime activation**: when the API key is not a `theo_test_*` fixture key and at least one of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OPENROUTER_API_KEY` is set, `LocalAgent.send()` routes through the real agent loop instead of fixture mode.

### Implementation status (Phase 1 — fixture-mode parity)
- `Agent.create()`, `Agent.send()` (both local + cloud), `Agent.resume()`, `Agent.list()`, `Agent.get()`, `Agent.listRuns()`, `Agent.getRun()`, `Agent.archive()`, `Agent.unarchive()`, `Agent.delete()` — implemented with deterministic fixture-mode responses for `theo_test_*` API keys.
- `Theokit.me()`, `Theokit.models.list()`, `Theokit.repositories.list()`, `Theokit.providers.list()` — implemented; route to real HTTP when `THEOKIT_API_BASE_URL` is set, otherwise serve fixture data.
- `Cron.create()` / `list()` / `get()` / `delete()` / `enable()` / `disable()` / `run()` — implemented with POSIX cron and shorthand validation, IANA timezone validation, and deterministic `nextRunAt` estimate.
- File-based discovery from `.theokit/`: `agents/*.md` (subagents), `skills/<name>/SKILL.md`, `plugins/<name>/plugin.json`, `mcp.json`, `hooks.json`, `context.json`, `cron/jobs.json`, `memory/<scope>.json`.
- Run lifecycle: `stream()` (AsyncGenerator of SDKMessage), `wait()`, `cancel()`, `conversation()`, `onDidChangeStatus()`. Status machine: `running → finished | error | cancelled`.
- Cloud runtime adapter calls Theo PaaS when `THEOKIT_API_BASE_URL` is set; otherwise emulates PaaS via fixture mode (CREATING / RUNNING / FINISHED status events, git metadata on result, artifact listing/download).
- Memory subsystem: file-backed store under `.theokit/memory/`, redacted public surface, namespace/scope keying.
- Skills, plugins, MCP, hooks, subagents, providers, context — public managers and file-based loaders.
- Quality Gates G1–G10 all green: typecheck, lint+format (Biome), publint, attw, smoke + roadmap tests (136/136), knip (dead code), depcruise (cycles), G8 LoC ≤ 400, G9 cognitive complexity ≤ 10, G10 jscpd 0 clones.
