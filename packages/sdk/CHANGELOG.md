# Changelog

## [Unreleased]

### Refactored

- **Cycle #4 closed via `types/handoff-descriptor.ts` leaf with TAgent generic (iter-20)**: `HandoffDescriptor` + `HandoffOptions` + `HandoffContext` + `HandoffHistory` + `HandoffResult` moved to a new leaf file. The leaf has `HandoffDescriptor<TInput, TAgent>` parameterized over the target agent shape — no dependency on `SDKAgent` or any other agent.ts type. `types/handoff.ts` re-exports the leaf types with `TAgent = SDKAgent` pinned for back-compat callers. `types/agent.ts` now imports `HandoffDescriptor` from the leaf, breaking the bidirectional `types/agent.ts ↔ types/handoff.ts` edge. madge final state: **2 cycles** (only D428-acknowledged rollup-dts subscribe-at-sub-path remain). Cycle gate threshold tightened ≤ 2.
- **`internal/runtime/plugins/` sub-folder promotion + T5.1 complete (4 of 4, FO#1)**: 2 plugin-* files moved from `internal/runtime/` to `internal/runtime/plugins/` via `git mv`. Direct file count: 50 → 48. **T5.1 complete across 4 iterations (15-18)**: cumulative 21 files moved across fixtures/ (5) + context/ (8) + registry/ (6) + plugins/ (2). `internal/runtime/` direct file count dropped 69 → 48. Audit ideal heuristic is 25; remaining 23-file gap is documented as out-of-scope (no further cohesive 5+ file cluster remains). 254/254 runtime + architecture tests GREEN.
- **`internal/runtime/registry/` sub-folder promotion (T5.1 partial 3 of 4, FO#1)**: 6 *-registry* files moved from `internal/runtime/` to `internal/runtime/registry/` via `git mv`. Direct file count: 56 → 50. T5.1 status PARTIAL — 3 of 4 clusters done (fixtures + context + registry). Remaining: plugins/. Cross-package caller surgery covered: `src/agent.ts`, `src/index.ts`, 5 runtime siblings, 4 test files, 1 dynamic `import("./agent-factory-registry.js")` in `local-agent-runtime-extensions.ts`. 253/253 runtime + architecture tests GREEN; madge unchanged.
- **`internal/runtime/context/` sub-folder promotion (T5.1 partial 2 of 4, FO#1)**: 8 context-* files moved from `internal/runtime/` to `internal/runtime/context/` via `git mv`. Direct file count: 64 → 56. T5.1 status PARTIAL — 2 of 4 clusters done (fixtures + context). Remaining: registry/, plugins/. Sibling callers (`local-agent`, `local-agent-bootstrap`, `system-prompt/local-assembly`) had their imports rewritten to `./context/context-X.js` (or `../context/context-X.js` from system-prompt/). 8 test files updated. 252/252 runtime + architecture tests GREEN.
- **`internal/runtime/fixtures/` sub-folder promotion (T5.1 partial, FO#1)**: 5 fixture-* files moved from `internal/runtime/` to `internal/runtime/fixtures/` via `git mv`. Direct file count: 69 → 64. T5.1 status PARTIAL — fixtures is 1 of 4 clusters (context/registry/plugins remain for follow-up iterations). Internal-only refactor; sibling callers (`cloud-run`, `local-run`, `real-local-run`, `real-cloud-run`) had their imports rewritten to `./fixtures/fixture-X.js`. 251/251 runtime + architecture tests GREEN; madge cycle count unchanged.
- **`internal/memory/storage/` sub-folder promotion (T10.1, FO#3)**: 7 storage-primitive files moved from `internal/memory/` to `internal/memory/storage/` via `git mv` — `markdown-store.ts`, `transcript-store.ts`, `session-loader.ts`, `session-summary-writer.ts`, `reader.ts`, `wiki-loader.ts`, `chunk-markdown.ts`. Direct file count in `internal/memory/`: 28 → 22 (under the 25-file god-folder heuristic). Internal-only refactor; zero public API surface change. All sibling imports, runtime/* callers, and test paths updated in the same slice. Architecture guard `tests/architecture/memory-folder-budget.test.ts` (NEW) asserts the budget. 140/140 architecture + memory tests GREEN; madge cycle count unchanged.
- **`dispatchSingleCall` orchestrator split (T10.4, PV#2)**: the 158 LOC body in `internal/agent-loop/tool-dispatch.ts` was decomposed into 7 named single-concern helpers (`applyRepairAndExtractCall`, `vetoFromForkWhitelist`, `startToolCallSpan`, `vetoFromPluginPreHook`, `vetoFromFileHookPreDecision`, `runToolWithLifecycle`, `finalizeSpanAndPostHook`). The orchestrator now reads as a ~28 LOC sequence; the previous complexity-suppression `biome-ignore` directive is removed. Zero public-API surface change; 51/51 regression tests (tool-dispatch + hooks + golden custom-tools) continue to pass.

### Fixed

- **5 LOW type-only cycles closed via 3 leaf extractions + self-ref drop (T4.1, ADR D438)**:
  - `types/agent-prims.ts` (NEW leaf) holds `ModelParameterValue`, `ModelSelection`, `CustomTool`; `types/run.ts` + `types/messages.ts` now import these from the leaf (no longer from `types/agent.ts`). Re-exported via `types/agent.ts` barrel — `import type { ModelSelection, CustomTool } from "@theokit/sdk"` keeps working.
  - `types/messages-base.ts` (NEW leaf) holds `UserMessage`; `types/updates.ts` imports from the leaf. Re-exported via `types/conversation.ts`.
  - `internal/memory/active-memory-types.ts` (NEW leaf) holds `ActiveMemoryQueryMode`, `ActiveMemoryStatus`, `ActiveMemoryResult`; `active-memory-cache.ts` imports from leaf. Re-exported via `active-memory.ts`.
  - Self-cycle on `types/agent.ts` (audit #3) closed by replacing the inline `import("./agent.js").SDKAgent` in `AgentOptions.handoffs?` with a direct forward-reference to the locally-defined `SDKAgent` interface.
  - madge cycle count: **8 → 3** in one slice. Closed: cycles #3/#5/#6/#7/#10. Remaining: #1+#2 D428-acknowledged (rollup-dts subscribe-at-sub-path); #4 documented as deviation requiring HIGH-impact SDKAgent-interface extraction (out of T4.1 scope).
  - Zero public type surface change. Public-type-surface smoke test in `tests/architecture/type-cycles-closed.test.ts` verifies barrels still resolve.
- **Architecture-test integrity fix (T4.1 follow-up)**: `tests/architecture/cycle-{8,9,11-12-13}-closed.test.ts` were passing **vacuously** because `repoRoot = resolve(__dirname, "../../../../..")` (5 ups) landed in the meta-repo `theokit-tools` which has no pnpm workspace — `pnpm exec madge` errored out and the cycle-line filter returned `[]`. Corrected to 4 ups (theokit-sdk workspace root). The underlying cycle closures from T1.1/T2.1/T3.1 are real (12/12 architecture tests now PASS against actual `madge --circular` output post-fix); the prior test integrity bug is surfaced honestly here per Inquebrável Rule 3 rather than buried.
- **CRITICAL runtime↔persistence cycle #9 closed**: extracted `internal/runtime/session-types.ts` (leaf types file ~15 LOC) holding `SessionMessage`. `agent-session-store.ts` now imports the type from this leaf; `agent-session.ts` re-exports it for back-compat with downstream importers. Closes the audit's only CRITICAL cycle (Phase 5 cartographer cycle #9 — `agent-session.ts → conversation-storage-fs.ts → agent-session-store.ts → agent-session.ts`, runtime↔persistence layer-crossing). madge cycle count: 9 → 8. Architecture test asserts via spawnSync. **Plan-vs-reality deviation:** ADR D432 prescribed a full port-and-adapter refactor; empirical inspection found the back-edge was a single types-only import, so type-leaf extraction is the smallest break that actually closes the cycle. Documented in `session-types.ts` JSDoc.
- **Memory cluster cycles #11 + #12 + #13 closed**: extracted `internal/memory/index-manager-contract.ts` (leaf types file holding `MemorySearchHit`, `IndexStatus`, `SearchOptions`, `MemoryBackend`, `OpenIndexOptions`). All 4 cluster members (`index-manager.ts`, `index-manager-dispatch.ts`, `lance-memory-adapter.ts`, `memory-index.ts`) now import these types from the contract; only the orchestrator imports runtime functions from dispatch (one direction). Single ~70 LOC extraction closes 3 HIGH cycles in one move (T2.1 of plan `arch-review-fixes-2026-06-06`, ADR D433). madge cycle count: 12 → 9. Back-compat re-export preserved on `index-manager.ts`. No public API touched.
- **Runtime cycle #8 closed**: extracted `internal/runtime/agent-registry-contract.ts` (leaf types file, ~60 LOC) holding `AgentRuntime` + `RegisteredAgent`. Both `agent-registry.ts` and `agent-registry-store.ts` now import these types from the contract; the previous runtime↔store 2-node cycle is closed (T3.1 of plan `arch-review-fixes-2026-06-06`, ADR D431). Back-compat re-export preserved on `agent-registry.ts` for existing downstream importers — no public API change. madge cycle count: 13 → 12 (HIGH cycle #8 resolved; remaining 12 covered by T1.1/T2.1/T4.1).

### Changed

- **BREAKING (shape only): `AgentRunError.providerError` getter now returns a redacted string (T1.5 of plan `sdk-superiority-2026-06-07`)**: pre-T1.5 the getter returned the raw `metadata.raw` object reference, which could carry `sk-...` tokens, Bearer JWTs, or other secret-shaped substrings straight into logs / Sentry / Langfuse. T1.5 wraps the value in `redactSecrets()` at the getter boundary and stringifies non-string payloads. Object identity is intentionally NOT preserved — secrets are stripped at the boundary. New `AgentRunError.toJSON()` OMITS `metadata.raw` from JSON output by default; operators opt in via `THEOKIT_DEBUG_RAW_ERRORS=1` to surface the (still-redacted) raw payload for diagnostics. All other fields (name/message/code/provider/requestId/conversationId/metadata.provider/metadata.endpoint/metadata.code/...) remain accessible. 5 new tests at `tests/security/error-redact.test.ts`; 2 pre-existing tests updated to reflect the new contract.

### Added

- **Anthropic native cache-token surfacing on `LlmFinish` (T3.8 of plan `sdk-superiority-2026-06-07`)**: pre-T3.8 the Anthropic accumulator at `internal/llm/anthropic.ts:167-170` read only `input_tokens` and `output_tokens` from `message_delta.usage` — silently dropped `cache_creation_input_tokens` and `cache_read_input_tokens` even though Anthropic emits them when the `cache_control: {type:"ephemeral"}` annotation (shipped in T3.5) is present on system blocks. As a result the budget accumulator's 5-bucket telemetry stayed at zero and cost calculations couldn't apply the 1.25x cache_write / 0.1x cache_read discounts. T3.8 widens the `AnthropicMessageDelta` type, threads both counters through `handleMessageDelta` (treating 0 as "no cache activity" to mirror the usage-accumulator filter), and emits them on `LlmFinish`. New `__testing__AnthropicAccumulator` seam exposes the class directly so unit tests drive the message_delta path without spinning the SSE parser. 4 new tests at `tests/internal/llm/anthropic-cache-tokens.test.ts`; 105/105 llm tests GREEN. Closes the algorithm half of DR3 finding #8 (telemetry observability); real-LLM proof (live Anthropic round-trip with a ≥ 1024-token cacheable prefix returning `cache_read_input_tokens > 0` on the second send) lands in T6.1.
- **`ErrorCode.quota_exceeded` + provider-mapping completeness (T3.7 of plan `sdk-superiority-2026-06-07`)**: `ErrorCode` union widened with `quota_exceeded` (was missing per the TODO comment in `internal/errors/mappers/openai-compatible.ts:110`). `mapOpenAICompatibleError` now returns the canonical bucket for HTTP 402, OpenRouter "Insufficient credits", and body codes `insufficient_quota` / `quota_exceeded` — previously folded into `invalid_request`. Anthropic 529 (overloaded) and Vertex 401/403 are pinned by new contract tests (already correctly mapped to `server_error` and `auth_failed` respectively). 5 new tests at `tests/internal/errors/mappers/t3-7-quota-completeness.test.ts`; 2 pre-existing tests updated to assert the new T3.7 contract. 53/53 mapper tests GREEN. Closes DR3 finding #7 (MEDIUM — error-mapping completeness).
- **OpenAI structured outputs `response_format: json_schema` emission (T3.6 of plan `sdk-superiority-2026-06-07`)**: new `LlmResponseFormat` discriminated union at `internal/llm/types.ts` covers both `{type:"json_schema", jsonSchema:{name, schema, strict?}}` (canonical, defaults `strict: true`) and `{type:"json_object"}` (legacy JSON-mode hint). New `LlmRequest.responseFormat?: LlmResponseFormat`. `internal/llm/openai.ts:buildOpenAIBody` routes via new `encodeOpenAIResponseFormat` helper to emit OpenAI's wire shape verbatim. Same patch closes a latent T3.5 bug: `buildOpenAIBody` was naively pushing `request.system` (now `string | LlmSystemBlock[]`) into OpenAI's `content` field — would break for the array form. New `openAISystemText` helper collapses to a joined string the same way `ollamaSystemText` does. Real-LLM proof (Agent.generateObject prefers native path against `gpt-4o-2024-08-06+`) deferred to T6.1 with the live API. 4 new tests at `tests/internal/llm/openai-structured-outputs.test.ts`; 101/101 llm tests GREEN. Closes DR3 finding #6 (HIGH — native structured outputs unreachable).
- **Anthropic prompt-cache emit + `LlmRequest.system` widening (T3.5 of plan `sdk-superiority-2026-06-07`)**: new `LlmSystemBlock` type at `internal/llm/types.ts` with `text: string` + `cacheable?: boolean`. `LlmRequest.system` widened from `string` to `string | LlmSystemBlock[]` (back-compat preserved — pre-T3.5 string callers unchanged). `internal/llm/anthropic-shared.ts:buildAnthropicCommonBody` now translates the array form into Anthropic's content-block wire shape `{type:"text", text, cache_control?: {type:"ephemeral"}}` so consumers can opt into Anthropic prompt caching (1-3x cache_read billing discount on subsequent same-content turns). Empty array short-circuits to `undefined` (omitted system). `ollama-native.ts:buildOllamaChatBody` collapses the array form into a joined string for providers that don't support per-block caching. Real-LLM proof (cache_read_input_tokens > 0 on second send) lands in T3.8 + T6.1 with a ≥ 1024-token static prefix. 5 new tests at `tests/internal/llm/anthropic-prompt-cache.test.ts`; 97/97 llm tests GREEN.
- **Exponential backoff + full jitter helper (T3.4 of plan `sdk-superiority-2026-06-07`, partial)**: new `internal/llm/retry.ts` exposes `computeBackoffMs({attempt, baseMs?, capMs?, retryAfterMs?, rng?})` (AWS Brooker 2015 full-jitter pattern with provider Retry-After hint precedence + cap clamp) and `sleepWithAbort(ms, signal)` (resolves early on abort). Closes the algorithm half of DR3 finding #4 (pre-T3.4 the pool retried 429 immediately with no wait, burning every credential in <1ms under coordinated load). 10 new tests cover Retry-After in/out of range, exponential ceiling doubling, jitter spread (50-sample distinctness), cap enforcement, and abort-aware sleep. **Wiring into `pool-aware-client.ts` deferred to follow-up**: existing pool-aware-client tests use `vi.useFakeTimers()` which would stall on the new `setTimeout`-based sleeps; integration requires either test refactor to advance timers OR a sleeper-injection seam (out of iter scope). Helper module shipped + tested standalone.

### Fixed

- **SSE / NDJSON body stream cancels on EVERY exit path (T3.3 of plan `sdk-superiority-2026-06-07`, CRITICAL)**: extends T3.2's abort-only cancel to also cover consumer break (early `[DONE]` exit, satisfied stop condition) and consumer throw (JSON.parse failure, downstream `yield event` rejection). Pre-T3.3 the cancel-on-abort flag-tracking only fired when `signal.aborted === true`; if the OpenAI / Anthropic consumer broke out on `[DONE]` without aborting, the body stayed open and the TCP socket leaked. T3.3 collapses the conditional to unconditional `reader.cancel()` inside both `parseSseStream` and `parseNdjsonStream` finally blocks. WHATWG spec guarantees `cancel()` on a finished stream is a no-op, so always-cancel is safe. Helper renamed `cancelOnAbort → cancelReaderQuietly`. 2 new tests at `tests/internal/llm/sse-break-cancels-body.test.ts` (break + throw paths both observe `ReadableStream.cancel`). Zero regression across 82 llm tests. Closes DR3 finding #2 (T3.2+T3.3 together — required for T6.2 1000-conn load test).
- **SSE / NDJSON abort now cancels the body stream (T3.2 of plan `sdk-superiority-2026-06-07`, CRITICAL)**: pre-T3.2 `internal/llm/sse.ts:30-37` and `internal/llm/ollama-native.ts:243` only released the reader lock when `AbortSignal` fired — the underlying ReadableStream kept draining and the upstream HTTP connection's TCP socket stayed in CLOSE_WAIT. Over 100s of concurrent SSE clients (T6.2 load test) this leaked sockets to exhaustion. T3.2 mirrors a `aborted` flag and calls `reader.cancel()` in the `finally` block when the signal aborted, so cancellation propagates to the body stream. Best-effort catch around `cancel()` per ADR D34 safe-exporter contract (cancel-time errors never propagate to caller). 2 new tests at `tests/internal/llm/sse-abort-cancels-body.test.ts` (aborted signal triggers `ReadableStream.cancel`; normal close does NOT). Zero regression across 80 existing llm tests. Closes DR3 finding #2.
- **SSE parser HTML Living Standard § 9.2.6 compliance (T3.1 of plan `sdk-superiority-2026-06-07`, CRITICAL)**: `internal/llm/sse.ts:73` previously called `.trim()` on every `data:` / `event:` value, which (a) stripped ALL leading whitespace instead of exactly one space, and (b) destroyed legitimate trailing whitespace in payloads. Per HTML LS § 9.2.6 step 5 of "Process the field", only a single leading U+0020 SPACE should be removed. T3.1 replaces `.trim()` with a `stripOneLeadingSpace` helper. The bug was the root cause of intermittent stream truncation observed in DR3 review finding #1 — payloads with intentional padding (chunked JSON, message-id headers ending in a space) lost characters. 6 new tests at `tests/internal/llm/sse-spec-compliance.test.ts` cover both `data:` and `event:` fields, multi-line payloads, and chunk-boundary preservation. Zero regression across 78 existing llm tests.

### Added

- **`validateResponse` D93 bailout wiring (T2.1 of plan `sdk-superiority-2026-06-07`)**: previously `internal/runtime/validate-response.ts` was an orphan export with ZERO production callers (DR2 finding #1). The bailout-detector exists for the weak-model failure mode where Gemini Flash / Mistral 7B sometimes return `{ stopReason: "end_turn", text: "", toolCalls: [] }` and the run silently "finishes" with no visible answer. T2.1 wires `validateResponse` in `continueOrTerminate` and adds `LoopContext.nudgeAttempts` capped at 2: empty/whitespace-only bailout shapes inject a "Please continue or provide a final answer" user message and re-run the LLM turn. If the model still bails after 2 nudges, the loop finishes (gives up — break out of infinite spin). 4 new tests at `tests/internal/agent-loop/validate-response-nudge.test.ts` (LLM stub returns empty then real; whitespace-only triggers same path; nudgeAttempts cap; non-empty does NOT over-fire). Zero regression across 20 existing agent-loop + validate-response tests.
- **`downloadArtifact` path-traversal hardening (T1.4 of plan `sdk-superiority-2026-06-07`)**: previous inline check only rejected `..` substring + leading `/`. New centralized `validateArtifactPath` in `internal/security/path-guard.ts` rejects 7 vectors at the boundary: classic `..` parent-directory traversal, backslash escapes (`..\\windows`), URL-encoded `%2e%2e` (with double-decode to defeat `%252e%252e`), NUL byte injection (`\x00`), Windows drive letter prefix (`C:`, `D:\\`), home-tilde expansion (`~/`, `~root/`), and absolute paths (`/etc/passwd`). `cloud-agent.ts:downloadArtifact` delegates to the validator and preserves the typed `ConfigurationError({code:"artifact_path_traversal"})` contract. 7 new tests at `tests/security/artifact-path-traversal.test.ts`. Closes DR1 finding #2 (CRITICAL path traversal).
- **API key boundary validation (T1.3 of plan `sdk-superiority-2026-06-07`)**: new `internal/auth/api-key-validator.ts` exposes `validateApiKeyShape(key, opts?)` with a two-tier check — Tier 1 always rejects empty / whitespace-only / sub-4-char shapes; Tier 2 (strict, default-on) adds 16-char minimum + provider-prefix sanity (`sk-` for openai, `sk-ant-` for anthropic, `sk-or-` for openrouter) + embedded-whitespace rejection. Strict tier is bypassed when `shouldUseRealLocalRuntime(key)` is true (the env-credential path doesn't use the apiKey for the provider fetch). `Agent.create` wires the validator into both `createLocalAgent` and `createCloudAgent`. Failures throw `AuthenticationError({code:"malformed_api_key", message})`. 14 new tests at `tests/security/api-key-validation.test.ts` + zero regressions across 209 telemetry/errors/golden tests.
- **`RegisteredAgent` contract snapshot test (T1.2 of plan `sdk-superiority-2026-06-07`)**: new `tests/contract/registered-agent.test.ts` pins the public shape of `RegisteredAgent` + `AgentRuntime` + `RegisteredAgent.status` closed union. Tsc enforces the snapshot; any field drop / rename / type change surfaces at typecheck. Note: the leaf-extraction part of T1.2 (`agent-registry-contract.ts`) was already shipped under the prior plan `arch-review-fixes-2026-06-06` T3.1 / ADR D431. Madge cycle count unchanged (2 baseline).

### Changed

- **BREAKING (type-level only): `AgentRunErrorCode` is now closed (T1.1 of plan `sdk-superiority-2026-06-07`)**: the previous `(string & {})` escape hatch is removed. New canonical type `KnownAgentRunErrorCode` exposes the closed literal union; `AgentRunErrorCode` remains as a back-compat re-export alias (no source change required for code that uses the alias). Boundary helper `coerceToKnownAgentRunErrorCode(raw)` collapses unknown strings to `"unknown"` at the call boundary; `Agent.prompt` adopted it for `RunErrorDetail.code` translation. Migration codemod ships at `packages/sdk/scripts/migrations/error-code-string-2-known.mjs` (regex-based dry-run by default; pass `--write` to apply). Closes DR1 finding #1 (CRITICAL).

### Added

- **Load + chaos suite scaffold (T0.3 of plan `sdk-superiority-2026-06-07`)**: 6 new test files at `tests/load/{1000-concurrent-sse,leaky-generators,slow-consumer-backpressure}.test.ts` and `tests/chaos/{kill-mid-stream,partition-fs,oom-recovery}.test.ts`. Three harness modules ship alongside: `tests/load/_harness/sse-driver.ts` (in-process SSE driver — NOT autocannon — per SEPA brief § E; tracks p50/p95/p99 latencies + SSE event count via `\n\n` terminators per HTML LS § 9.2.6), `tests/load/_harness/socket-monitor.ts` (Linux-only `ss -tnp` probe with no-op fallback for Mac/Win; CI asserts `closeWaitCount ≤ threshold`), `tests/chaos/_harness/process-control.ts` (child-process spawn + SIGKILL injection per ADR D37 methodology). Today's scaffold uses 100 concurrent SSE (override via `T0_3_CONCURRENCY=1000`); T6.2 ratchets to the full 1000-conn p95 < 200ms perf gate, T6.3 wires the kill-mid-stream chaos against the SDK's real streaming surface, T6.4 wires partition-fs against persistence paths, T6.5 wires OOM against the memory subsystem.
- **Real-LLM CI matrix scaffold (T0.2 of plan `sdk-superiority-2026-06-07`)**: 15 env-gated integration test files at `tests/integration/real-llm/{openai,anthropic,openrouter}-{tools,vision,stream,cache,structured}.test.ts`. Each file uses `describe.skipIf(...)` so the suite is silent when the relevant API key is absent. `tests/integration/real-llm/_helpers/real-llm-env.ts` centralizes the provider-key resolver with OpenRouter fallback for non-native scenarios (Anthropic cache stays native-only per SEPA initial brief § C). With keys set the matrix validates the happy path for tool use, streaming, vision content parts, prompt caching, and structured outputs across the 3 routes — expanded depth (cache_read_input_tokens > 0 assertion, parallel tool dispatch, error-retry) lands in T3.5 / T3.8 / T6.1. Default model `openai/gpt-4o-mini` per cost budget. Today: 15/15 files skip cleanly.
- **OTel hot-path wiring foundation (T0.1 of plan `sdk-superiority-2026-06-07`)**: emit canonical spans `agent.create`, `agent.send` (parent), and `memory.recall` when `telemetry.enabled: true`. New closed-enum `internal/telemetry/span-names.ts` (14 names + `SpanName` literal type) anticipates the no-`(string & {})` discipline of T1.1. `TelemetryHandle` interface extended with `recordHistogram(name, valueMs, attrs)` and the OTel `metrics` namespace is lazy-loaded the same way `trace` is (graceful no-op when missing). First histogram name registered: `theokit_memory_recall_duration_ms` (recorded with `userId/namespace/scope/status` dimensions). Integration tests use a real `@opentelemetry/sdk-trace-base` `InMemorySpanExporter` (NOT module mocks) — added as devDep alongside `@opentelemetry/api` and `@opentelemetry/sdk-metrics`. Wiring triad: pillar (a) callers are `Agent.create` (production), `LocalAgent.send` (production), `runActiveMemory` (production); pillar (b) covered by `tests/telemetry/*.test.ts` (8 tests). Remaining acceptance items — `agent.send.<step>` 8 child spans, `tool.call`, `llm.call` spans — deferred to T1.7 / T2.4 / T3.* per SEPA brief (zero plan-deviation).
- **`SecretRedactor` interface** at `internal/security/secret-redactor.ts` (T9.1 of plan `arch-review-fixes-2026-06-06`, ADR D437). Types-only — no runtime exports; canonical `redactSecrets` from `redact.ts` satisfies the interface structurally. Closes AF#16 (Martin Zone of Pain D=0.923) from the 2026-06-06 architecture audit through documentation + minimal abstraction without violating D68/D69/D70/D71/D73 (security primitives stay concrete + stable). Rationale + coupling metrics at `internal/security/README.md`.

### Changed

- **Renamed `internal/runtime/system-prompt/providers/` → `internal/runtime/system-prompt/sources/`** (FO#6, plan `arch-review-fixes-2026-06-06` T10.3). The directory previously shared its basename with `internal/providers/` (LLM provider profiles per ADR D105-D107) — auditor flagged the duplicate folder name as a findability hazard. `sources/` better describes the semantic: these 5 modules are system-prompt *sources* (ActiveMemoryPromptProvider, BasePromptProvider, ContextPromptProvider, MemoryPromptProvider, SkillsPromptProvider), not LLM provider profiles. Internal-only rename; no public API touched. Git-rename detection preserved (5/5 files moved with `git mv`); import paths in `pipeline.ts` + 5 golden tests updated atomically.

### Fixed

- **`safeListTools` no longer silently swallows MCP failures** (PV#6, plan `arch-review-fixes-2026-06-06` T8.1). When `client.listTools()` throws (MCP server unreachable, auth refused, etc.), the agent loop now emits a structured `[theokit-sdk] mcp listTools failed (server=<name>): <error>` line to stderr **while preserving the empty-list fallback** that consumers depend on for graceful degradation. The previous behaviour violated Inquebrável Rule 8 (`FALHE alto, FALHE cedo, FALHE claro`). `safeListTools` is now `export`ed from `internal/agent-loop/loop.ts` to enable unit-test access to the catch path — NOT promoted to the public `@theokit/sdk` API surface.

### Notes

- **Cycles #1, #2 (type-only, ADR D428 acknowledged):** the 2026-06-06 architecture audit (`/loop-architecture-review`) found 2 type-only dependency cycles in `packages/sdk/src/types/agent.ts ↔ internal/runtime/fork-agent.ts` that manifest in the rollup-dts bundle. Per ADR D428 (subscribe-at-sub-path) these are intentional: keeping `subscribe` at the `@theokit/sdk/subscription` sub-path avoids promoting types through the cycle. They are NOT runtime cycles (JS-erased at build time) and are not breakable without regressing D428. Plan `arch-review-fixes-2026-06-06` T11.1 documents this rationale.
- **PV#8 — ISP / SDKAgent bundles local + cloud methods (ADR D122 acknowledged):** the 2026-06-06 architecture audit flagged the `SDKAgent` public interface as bundling local-only and cloud-only methods (ISP marginal). Per ADR D122 (`run-until-cloud-unsupported`), `CloudAgent` throws `UnsupportedRunOperationError` for runtime ops it cannot service while sharing the same TypeScript surface — the bundled shape is intentional cross-runtime API parity, not a design defect. Splitting `SDKAgent` into local/cloud interfaces would force consumers to branch on runtime at call sites, contradicting D122's "single typed surface" decision. Plan `arch-review-fixes-2026-06-06` T11.1 documents this rationale.

### Fixed

- Restored green `pnpm validate` after G8 subscription landing (`9fda7d7`). Biome 2.4 gate: 24 lint findings in `subscription/` prod + tests resolved with `biome-ignore` annotations (9× `useYield` intentional empty/throw test handlers; 13× `noExcessiveCognitiveComplexity` refactor-candidate; 1× `noConfusingVoidType` idiomatic callback shape; 1× `noAssignInExpressions` idiomatic line-parser). Stale `// eslint-disable-next-line require-yield` comments replaced — Biome does not honor ESLint pragmas. Lint-gate T1.5.2 `no-unredacted-sink` whitelisted `subscription/internal/server-integration.ts` (writes declarative `SubscriptionManifest`, no PII). Build/publint: `scripts/mirror-dts-to-cts.mjs` targets extended to cover `subscription/` so `dist/subscription/index.d.cts` is emitted (fixes `pkg.exports["./subscription"].require.types` missing). Dead-code/knip: ignore glob extended from `src/internal/**` to `src/**/internal/**` for per-feature internal namespaces. Architecture/depcruise `no-orphans`: `pathNot` extended with `(^|/)packages/sdk/src/[^/]+/internal/` (same exemption rationale as `src/internal/` — type-only exports erased at runtime).

## 1.7.0 - 2026-06-04

### Added

- **`@theokit/sdk/subscription` sub-path** (per blueprint G8 SHIPPABLE 98.3) — typed subscription primitive with WS + W3C SSE transports + opaque resume tokens (`lastEventId`). Form 4 Hybrid (D423): low-level adapters (`createNodeWsAdapter`, `encodeSseChunk`, `parseSseW3C`) + high-level DSL (`defineSubscription`, `subscribe`, `tracked`).
- **8 exports** at `@theokit/sdk/subscription`:
  - `defineSubscription<TInput, TOutput>({input, output, handler})` — server-side typed RPC factory (D427)
  - `subscribe<TInput, TOutput>(name, input, opts)` — client-side AsyncGenerator with transparent reconnect + lastEventId propagation (D428)
  - `tracked(id, payload)` + `isTrackedEnvelope(value)` — resume token envelope helpers
  - `SubscriptionTransport = 'ws' | 'sse' | 'auto'` (D425)
  - `SubscriptionCtx`, `SubscriptionDescriptor<TInput, TOutput>`, `TrackedEnvelope<T>` (types)
- **3 typed error classes:** `SubscriptionError`, `SubscriptionInputError` (carries Zod `issues`), `SubscriptionDisconnectError` (carries `closeCode`/`closeReason`). All extend `TheokitAgentError`.
- **`ws@>=8.0.0` + `@types/ws@>=8.0.0` optional peer deps** — Node WS adapter loads `ws` via dynamic `import()` with actionable error when missing (D426). SSE-only consumers pay zero cost.
- **W3C-spec SSE encoder + parser** — independent of D38 a peer vendor AI Data Stream v1 wire format (which stays locked for `streamAssistant` LLM streaming). Both coexist (D429).
- **Server integration primitives** — `scanSubscriptions({appDir, outFile})` emits `.theo/subscriptions.json` mirroring G6 routes scanner; `mountSubscriptions({manifest, appDir})` returns `{handleSseRequest, handleWsUpgrade}` ready to wire into `http.Server`. theokit-side Vite plugin + dev-server wiring is a cross-repo follow-up (D430).

### ADRs absorbed

- **D423** — Form 4 Hybrid (low-level primitives + high-level DSL)
- **D424** — `lastEventId` opaque, server-defined replay semantics
- **D425** — Transport selection `'ws' | 'sse' | 'auto'` (default `'auto'` = WS-preferred)
- **D426** — `ws` Node canonical (optional peer); CF Workers / Bun / Deno deferred to v1.8.x as separate packages
- **D427** — `defineSubscription` AsyncGenerator + Zod input/output
- **D428** — `subscribe` lives at `@theokit/sdk/subscription` sub-path only (NOT promoted to `Theokit.subscribe` due to pre-existing `agent.ts ↔ fork-agent.ts` rollup-dts cycle; same isolation pattern as `path-safety`)
- **D429** — W3C SSE wire format (independent of D38 a peer vendor AI Data Stream)
- **D430** — Server auto-route via `theokit.subscriptions` scanner (cross-repo follow-up for theokit-side wiring)

### Security threats addressed

| Threat | Mitigation |
|---|---|
| Resume token replay | Consumer SHOULD bind token to session + rotate per reconnect; SDK ships TTL knob via custom `tracked()` envelope semantics |
| WS connection hijacking | Auth at HTTP upgrade — `WsAdapter.upgrade(ctx, raw)` exposes the `request` so consumer middleware (G11 `defineAuth`) runs BEFORE upgrade. Rejected upgrade returns null → caller responds 401 |
| Subscription input tampering | Zod schema validation BEFORE handler invocation; throws `SubscriptionInputError` carrying issues |
| Resource exhaustion | Per-subscription `AbortSignal`; `SubscriptionRuntime.getActiveConnectionCount()` for ops visibility; consumer wires rate-limit middleware (P#10) at upgrade boundary |
| Sensitive data in logs | Telemetry seam (D34) captures metadata only (`subscriptionName`, `lastEventId`, `connectionId`); never payloads (per D73 redact at output boundaries) |
| Long-lived WS survives token expiry | `ctx.disconnect(code, reason)` lets consumer's auth middleware force-close when session revoked |

### Multi-runtime compatibility matrix

| Runtime | v1.7.0 | v1.8.x (planned) |
|---|---|---|
| Node 22+ | yes (canonical `ws` peer) | yes |
| Cloudflare Workers | consumer adapter only | yes (`@theokit/sdk-ws-cloudflare`) |
| Bun | consumer adapter only | yes (`@theokit/sdk-ws-bun`) |
| Deno | consumer adapter only | yes (`@theokit/sdk-ws-deno`) |

### Notes

- v1.7.0 is **additive** — no breaking changes. Existing `streamAssistant` (a peer vendor AI Data Stream, D38) untouched.
- Tests: **45 GREEN + 1 honest-SKIP** under `tests/subscription/` + `tests/integration/subscription-resume.test.ts` (real `ws.WebSocketServer` + `http.Server` real SSE roundtrip + lastEventId resume) + `tests/integration/subscription-real-llm.test.ts` (env-gated `OPENROUTER_API_KEY` — verified GREEN against real OpenRouter `openai/gpt-4o-mini` per `real-llm-validation.md`).
- Build: `dist/subscription/index.{js,cjs,d.ts,d.cts}` emitted; JS+CJS via tsup, DTS via tsc + `tsconfig.tools-dts.json` (mirrors `tools/` + `path-safety` pattern to avoid pre-existing `types/agent.ts ↔ fork-agent.ts` rollup-dts cycle).

## 1.6.0 - 2026-06-03

### Added

- **`@theokit/sdk/server/auth` sub-path** (per ADR D6 of plan g11-auth-architecture-implementation v1.4) — orchestrator-only auth surface ships `defineAuth<TSession>(opts)` factory + 5 supporting types. Implements **Caminho C (Hybrid)** from discovery blueprint `g11-auth-architecture-decision` (SHIPPABLE 97.9). Providers ship as opt-in `@theokit/auth-*` packages (Tier 1: Google + GitHub + Magic Link — separate packages, semver-independent). Aligned with `AUTH-DELEGATION` lock in `theokit/CLAUDE.md:217-225` (lock's own escape-hatch clause "If we do adopt later: ship providers as separate optional packages under `@theokit/auth-*`, NEVER in the framework core").
- **6 type exports** at `@theokit/sdk/server/auth`:
  - `defineAuth<TSession>(opts): AuthOrchestrator<TSession>` factory
  - `DefineAuthOptions<TSession>` config shape
  - `AuthOrchestrator<TSession>` 5-method surface (`startSignIn`, `finishSignIn`, `signIn`, `signOut`, `getSession`)
  - `AuthProvider<TProfile, TName>` provider contract
  - `AuthResult<TProfile, TName>` callback return shape
  - `OAuthTransaction` cookie-state transaction shape
- **4 typed error classes:** `AuthConfigError`, `AuthProviderNotFoundError`, `AuthCallbackError`, `AuthCancelledError` (extends `AuthCallbackError`).
- **`validateReturnTo(returnTo, baseUrl)` helper** — same-origin validation for OWASP A01:2021 open-redirect mitigation.

### Edge cases absorbed inline (from plan v1.1 edge-case-plan)

- **EC-1** — `AuthCancelledError` thrown on OAuth `?error=access_denied` callback (RFC 6749 §4.1.2.1) BEFORE attempting code-exchange. Apps catch distinctly to render "Login cancelled" UX vs opaque "callback failed".
- **EC-2** — `validateReturnTo` rejects protocol-relative URLs (`//evil.com`), cross-origin absolute URLs, and bare strings. Defaults to `/` when unsafe.
- **EC-10** — `rotateSession()` called BEFORE `createSession()` in `finishSignIn` + `signIn` per OWASP A07:2021 session-fixation mitigation.
- **EC-6** — Typed `oauth_transaction_expired` code on `AuthCallbackError` for expired cookie-state transactions (≥ 10min old).
- **D5** — OAuth transaction stored in encrypted cookie (`theo_oauth_tx`, AES-256-GCM, 10-min expiry, HttpOnly + Secure + SameSite=Lax).

### Notes

- v1.6.0 is **additive** — no breaking changes. Existing consumers of `createSessionManager` (from `theokit/server/auth`) unaffected.
- Providers (`@theokit/auth-google`, `@theokit/auth-github`, `@theokit/auth-magic-link`) ship in separate npm packages (Phase 2-4 of plan G11). They will publish to `@next` tag first per ADR D3 (4-6 week telemetry observation window before promote to `@latest`).
- Tests: 16/16 GREEN in `tests/server-auth.test.ts` covering config validation, EC-1, EC-2, EC-10, Caminho A signIn, expired transaction, unknown provider.

## 1.5.0

### Changed

- **`publishConfig.provenance` removed (alinhado com política do monorepo).** Esta era a única `package.json` de 11 pacotes publicáveis com `provenance: true`; drift arquitetural — a flag prometia attestation criptográfica mas nenhum repo do monorepo tem release.yml com `id-token: write` permission para mintar OIDC token contra o npm registry. Resultado: publishes locais falhavam com `EUSAGE: Automatic provenance generation not supported for provider: null`. Decisão: alinhar intent à infra atual (10/11 outros pacotes não declaram provenance). **Follow-up estratégico:** adicionar release.yml com `id-token: write` em todos os repos (theokit-sdk + theokit + theokit-plugins + theo-ui) habilita provenance universal — escopo separado.

### Breaking Changes

- **`Workflow` and `Eval` moved out of the main barrel into dedicated sub-paths.** The migration is mechanical (rewrite the `from` string); no behavior changes. `@theokit/sdk` main barrel no longer exports:
  - From workflow: `Workflow`, `WorkflowBuilder`, `agentStep`, `fn`, `WorkflowAlreadyRunningError`, `WorkflowCompensateNotImplementedError`, `WorkflowDuplicateStepIdError`, `WorkflowMaxIterationsExceededError`, `WorkflowNotSerializableError`, `WorkflowParallelError`, `WorkflowResumeStepNotFoundError`, `WorkflowSnapshotNotFoundError` — **import from `@theokit/sdk/workflow` instead**.
  - From eval: `Eval`, `EvalAlreadyRunningError`, `Scorers` — **import from `@theokit/sdk/eval` instead**.
  - From `types/*`: type aliases for workflow + eval (e.g., `EvalRun`, `Scorer`, `Score`, `EvalOptions`, `EvalAggregate`, `Step`, `FnStep`, etc.) no longer reach the main barrel via `types/index.ts`; surface only through the new sub-paths.

  Rationale: Interface Segregation. The barrel exported 17+ feature areas, forcing consumers to pay the DTS cost of `Workflow`+`Eval` even if they only used `Agent`+`Memory`. Sub-paths reduce DTS surface and align with the existing pattern (`@theokit/sdk/cron`, `/tools`, `/path-safety`, `/task-store`, `/errors`).

  **Migration:**
  ```ts
  // Before
  import { Workflow, Eval, Scorers } from "@theokit/sdk";

  // After
  import { Workflow } from "@theokit/sdk/workflow";
  import { Eval, Scorers } from "@theokit/sdk/eval";
  ```

### Added

- `@theokit/sdk/workflow` sub-path entry (with full ESM + CJS conditions, `.d.ts` + `.d.cts` mirror for attw compliance).
- `@theokit/sdk/eval` sub-path entry (same shape; `Scorers` co-located here per locality of reference).

## 1.4.1 (workspace-only — NOT published to npm)

> **Drift note (2026-06-02):** versions 1.4.0 and 1.4.1 landed in workspace and were merged to develop, but never reached the `@latest` npm dist-tag. npm `@theokit/sdk@latest` remains at **1.3.0** (last shipped 2026-05-30). The 1.4.x patch chain will be consolidated into the next published release (1.5.0 or higher) — consumers who need the LanceDB wiring fix (1.4.0) or the zod v3/v4 universal converter (1.4.1) must install `@theokit/sdk@1.5.0-next.X` (when published on `next`) or wait for the consolidated `latest` cut. Drift root cause: 1.4.0 sub-paths extraction work changed the publish requirements (workspace `pnpm changeset version` chain was bumped but `pnpm changeset publish` was deferred while 1.5.0 sub-path API surface stabilized). All entries below reflect REAL code changes that DID land on develop.

### Patch Changes

- **`defineTool` now works on zod v3 + v4 (universal converter).** Before this patch, `defineTool({ inputSchema: z.object(...) })` failed at runtime with `z.toJSONSchema is not a function` whenever the consumer's resolved `zod` was v3 (which is the case for `theokit` and `dogfood-app` today — both pin `^3.25.0`). The SDK delegates conversion to the existing universal `internal/zod/to-json-schema.ts` adapter (feature-detect zod 4 native `toJSONSchema` → fallback to `zod-to-json-schema` peer lib). Caught end-to-end via Chrome MCP dogfood — `/api/tools`, `/api/admin/sdk-config`, `POST /api/chat` all 500'd before the fix; all 200 after.
- **`internal/zod/to-json-schema.ts` cross-version safety net:** when the SDK runs under a dev-server (Vite SSR), `createRequire("zod")` resolves to the SDK's OWN `node_modules/zod` (v4 in devDeps), while the schema was built by the consumer's zod v3 instance. Calling v4's `toJSONSchema(v3Schema)` throws. The native path now catches that error and falls through to `zod-to-json-schema` (which understands both v3 and v4 schemas). Mode toggled in cache so subsequent calls go directly to the working path.
- Added `zod-to-json-schema: "^3.24.0"` as optional `peerDependency` (already silently required by zod-3 consumers; now declared explicitly so `pnpm install` resolves it deterministically).

## 1.4.0 (workspace-only — NOT published to npm)

> See drift note at the top of the 1.4.1 section. Code landed; npm `@latest` still at 1.3.0.

### Minor Changes

- **`Memory.create({ index: { backend: "lance" } })` is now wired end-to-end.** The `LanceIndex` implementation existed since 2026-05-17 (ADR D43) but `IndexManager.open` did not dispatch — public API accepted `backend: "lance"` silently and always fell through to SQLite. Fix: factory dispatcher in `IndexManager.open` + new portable `MemoryIndex` interface + new `LanceMemoryAdapter` wrapper + `@lancedb/lancedb` declared as optional `peerDependency` (`^0.30.0`).

  **Migration path:** consumer that wants Lance:
  ```bash
  pnpm add @lancedb/lancedb apache-arrow@^18.1.0
  ```
  ```ts
  await Memory.create({
    index: { backend: "lance" },
    embedding: { provider: "openai", apiKey: process.env.OPENAI_API_KEY },
  });
  ```
  Default keeps SQLite (zero added deps, zero breaking change vs 1.3.0).

  **When to opt-in (benchmark evidence — `.claude/knowledge-base/benchmarks/memory-backends-2026-05-31.md`):**
  - Lance wins **43x** ingest throughput at 100k facts (59849 ops/s vs SQLite-vec 1875 ops/s).
  - Lance uses **65% less disk** at 100k (33.8 MB vs 93.5 MB).
  - SQLite-vec recall p95 stays competitive up to 100k (~25 ms). Use Lance when ingest velocity or disk pressure matters; SQLite handles latency well below 1M facts.

  **EC-1 hardening:** new `ConfigurationError({code:"invalid_memory_backend"})` for typo-protection — `backend: "lancedb"` (typo) now throws instead of silently falling back to SQLite. Same hardening for `lance_requires_embedding` and `lance_backend_unavailable` typed errors.

  **Gotchas:**
  - `@lancedb/lancedb` ships prebuilds for linux-x64-gnu, darwin-arm64, darwin-x64, win32-x64-msvc. Alpine/musl/ARM-Linux require `node-gyp` toolchain. SQLite default covers those cases.
  - Bundlers (Next.js/Vite/webpack/rollup) must externalize `@lancedb/lancedb`:
    - Next.js: `experimental.serverComponentsExternalPackages: ["@lancedb/lancedb"]`
    - Vite: `optimizeDeps.exclude: ["@lancedb/lancedb"]` + `ssr.external: ["@lancedb/lancedb"]`
    - webpack/rollup: add to `externals` array

  Closes ADR D12 ("LanceDB deferred to v1.1") via fulfillment of D43.

- **EC-1/EC-8 fixes shipped atomically** (caught by the new integration test against real `@lancedb/lancedb@0.30.0`):
  - `LanceIndex.search` now uses SQL string predicate with `escapeSqlValue()` (single-quote doubling) instead of object filter — Lance 0.30 only accepts SQL string in `.where()`, contrary to D43's original assumption.
  - `LanceIndex.open` dim-mismatch detection now reads `schema().fields.type.listSize` (Apache Arrow `FixedSizeList` typeId=16 layout in Lance 0.30) — previously checked `fixedSize` which never matched.

### Patch Changes

- Refactored `RealLocalRun.executeAgentLoop` (complexity 11 → ≤10) via Extract Method: introduced `applyAgentLoopOutput` private helper that copies events/conversation/result/usage/cost/error onto the script. Behavior preserved byte-for-byte. (theokit-sdk-biome-cleanup)
- Removed redundant `// biome-ignore` directive from `internal/llm/fault-injection.ts` that no longer applied after the workspace enabled `javascript.parser.unsafeParameterDecoratorsEnabled`. (theokit-sdk-biome-cleanup)
- Extracted message-builder helpers (`buildSystemEvent`, `buildUserEvent`, `buildAssistantEvent`, `buildAssistantTurn`) from `internal/agent-loop/loop.ts` into a new sibling `message-builders.ts` to bring `loop.ts` back under the G8 file-size budget (400 LoC). Pure refactor — no behavior change. (theokit-sdk-biome-cleanup)
- Removed redundant `export` on `GraphSnapshot` interface (internal-only). (theokit-sdk-biome-cleanup)
- Added inline `// biome-ignore lint/correctness/useYield` on two intentional non-yielding async-generator mocks in `tests/internal/agent-loop/error-packaging.test.ts` (legitimate test seam — throws before yielding). (theokit-sdk-biome-cleanup)
- Vitest configuration: switched `pool` to `forks` (top-level) with `singleFork: false` so each test file runs in its own subprocess. This is the only reliable way to isolate `process.env.HOME` mutations across the discovery / context-import-resolver / personality test files, which were producing 5 flaky failures under parallel-package validate. Stack-keyed `process.env.HOME` save/restore added to `vitest.setup.ts` for additional safety. (theokit-sdk-biome-cleanup)

- Refactored `RealLocalRun.executeAgentLoop` (complexity 11 → ≤10) via Extract Method: introduced `applyAgentLoopOutput` private helper that copies events/conversation/result/usage/cost/error onto the script. Behavior preserved byte-for-byte. (theokit-sdk-biome-cleanup)
- Removed redundant `// biome-ignore` directive from `internal/llm/fault-injection.ts` that no longer applied after the workspace enabled `javascript.parser.unsafeParameterDecoratorsEnabled`. (theokit-sdk-biome-cleanup)
- Extracted message-builder helpers (`buildSystemEvent`, `buildUserEvent`, `buildAssistantEvent`, `buildAssistantTurn`) from `internal/agent-loop/loop.ts` into a new sibling `message-builders.ts` to bring `loop.ts` back under the G8 file-size budget (400 LoC). Pure refactor — no behavior change. (theokit-sdk-biome-cleanup)
- Removed redundant `export` on `GraphSnapshot` interface (internal-only). (theokit-sdk-biome-cleanup)
- Added inline `// biome-ignore lint/correctness/useYield` on two intentional non-yielding async-generator mocks in `tests/internal/agent-loop/error-packaging.test.ts` (legitimate test seam — throws before yielding). (theokit-sdk-biome-cleanup)
- Vitest configuration: switched `pool` to `forks` (top-level) with `singleFork: false` so each test file runs in its own subprocess. This is the only reliable way to isolate `process.env.HOME` mutations across the discovery / context-import-resolver / personality test files, which were producing 5 flaky failures under parallel-package validate. Stack-keyed `process.env.HOME` save/restore added to `vitest.setup.ts` for additional safety. (theokit-sdk-biome-cleanup)

## 1.3.0

### Minor Changes

- Fix Finding B: provider/transport errors no longer leak as `SDKAssistantMessage` content. They surface structured on `RunResult.error` (`{ message, code?, cause? }`).

  **Background.** Previously, the agent loop's stream catch block (`internal/agent-loop/loop.ts`) and the runtime's `emitErrorEvent` (`internal/runtime/real-local-run.ts`) both pushed an `SDKAssistantMessage` carrying the error text. Downstream surfaces (notably `theokit`'s `streamAgentRun`) then yielded `{ type: 'message' }` events instead of `{ type: 'error' }`, hiding the failure from consumers' typed error handling and from chaos tests.

  **What changed.**

  - `AgentLoopOutput` now carries an optional `error?: AgentLoopErrorDetail` field.
  - The loop catch path and the in-stream `{ type: "error" }` event both populate `ctx.error` via a single `registerLoopError(ctx, cause)` helper that enforces the set-once invariant (first-error-wins, ADR D3) and EC-1 typeof-guards `cause.code` so a non-string code never lands on the wire as the literal `"undefined"`.
  - The abort path (`signal.aborted === true`) still emits `"[aborted]"` as an `SDKAssistantMessage` — that is a UX seam, not an error.
  - `executeAgentLoop` copies `output.error` onto `script.errorDetail`, which `buildResult()` already surfaces as `RunResult.error` (set-once invariant preserved).
  - `emitErrorEvent` (used by MCP-init / build-inputs / outer-catch paths) no longer pushes an assistant message — those errors flow exclusively via `script.errorDetail` → `RunResult.error`.

  **Migration (EC-8).** If your code grepped for the error inside `for await (const msg of run.stream()) { if (msg.type === 'assistant' && /401|API error/.test(...)) }`, switch to `const result = await run.wait(); if (result.status === 'error') { result.error.message; result.error.code; }`. The abort case still arrives as an assistant message with content `"[aborted]"` — distinct from errors.

  **Tests added.** `tests/internal/agent-loop/error-packaging.test.ts` (5 unit tests covering auth, transport, abort UX preservation, first-error-wins, happy-path sanity). `tests/runtime/error-packaging-e2e.test.ts` (2 E2E tests covering full `Agent.create → send → wait → result.error` pipeline with mocked 401 fetch and the EC-6 double-negative invariant).

## 1.2.0

### Minor Changes

- **D14 — Test fault injection via `THEOKIT_TEST_RESPONSE_OVERRIDE` env var.**

  Adds a deterministic chaos-testing seam at the LLM transport layer. When `NODE_ENV=test` AND `THEOKIT_TEST_RESPONSE_OVERRIDE` is set to a JSON string of shape `{"status": number, "body": object | string}`, every provider client returned by `resolveProviderChain` short-circuits the real network call and synthesizes the configured response.

  **Use cases (replaces flaky chaos patterns):**

  ```bash
  # 429 rate-limit — deterministic, zero quota burn
  export NODE_ENV=test
  export THEOKIT_TEST_RESPONSE_OVERRIDE='{"status":429,"body":{"error":{"code":"rate_limit_exceeded","message":"Rate limit hit"}}}'

  # 500 server error — for retry / circuit-breaker tests
  export THEOKIT_TEST_RESPONSE_OVERRIDE='{"status":500,"body":{"error":{"code":"internal_error"}}}'

  # 200 happy path — deterministic text for snapshot tests
  export THEOKIT_TEST_RESPONSE_OVERRIDE='{"status":200,"body":{"choices":[{"message":{"content":"hello"}}]}}'
  ```

  **Design (FAANG-grade fail-safe):**

  - **Two-gate activation.** Both `NODE_ENV === "test"` AND a non-empty env var must be present. Production deployments are unaffected (cheap noop in the hot path).
  - **Decorator pattern** (`FaultInjectingLlmClient`) wraps every resolved transport. Composes cleanly with `PoolAwareLlmClient` (credential pools D123-D133) and per-provider transports without modifying them.
  - **Graceful degradation on malformed JSON** — one-shot stderr warn + fall-through to the real client. Never throws on bad config.
  - **Error parity** — injected non-200 statuses go through the existing `mapOpenAICompatibleError` mapper, so the error class hierarchy (`RateLimitError`, `AuthenticationError`, `NetworkError`, `ConfigurationError`) is byte-equal to what the real provider would raise.
  - **Transparent passthrough** when override is absent — the wrapper preserves `client.name` for telemetry and exposes `inner` so layered-transport assertions (router pool-wiring tests, telemetry inspectors) can walk one level deep.

  **Tests:** 12 unit tests (`tests/llm-fault-injection.test.ts`) + 3 wiring tests (`tests/llm-fault-injection-router-wiring.test.ts`) — gate negative + active for each status class + idempotence + name preservation.

  **Rejects the anti-patterns:** "50 parallel requests to force 429" (flaky + quota burn + cost overrun), `nock`/`msw` (violates stranger persona), conditional code in templates (Strategy pattern instead).

  Inspired by Stripe test-mode + AWS SDK `AWS_SDK_LOAD_CONFIG=0`. Documented in dogfood-stranger Phase 13 (theokit plan `dogfood-fixes-and-coverage-expansion-plan.md` ADR D14).

## [Unreleased]

### Added — `THEOKIT_TEST_RESPONSE_OVERRIDE` env var (D14 fault injection)

Deterministic chaos-testing seam at the LLM transport layer. When both
`NODE_ENV=test` AND `THEOKIT_TEST_RESPONSE_OVERRIDE` are set to a JSON string
of shape `{"status": number, "body": object | string}`, every provider client
returned by `resolveProviderChain` short-circuits the real network call and
synthesizes the configured response.

Replaces flaky chaos patterns like "50 parallel requests to force 429" with
zero quota burn + zero network. Composes with credential pools (D123-D133)
and per-provider transports without modification (decorator pattern).

Use cases:

- Inject 429 for rate-limit handling tests
- Inject 5xx for retry / circuit-breaker tests
- Inject 200 with deterministic content for snapshot tests

See `docs.md` § "Test fault injection (v1.22+)" for the full contract,
supported status classes / body shapes, and graceful-degradation semantics.

Implementation:

- `src/internal/llm/fault-injection.ts` — `FaultInjectingLlmClient` decorator
  - parser + activation gate + one-shot stderr warn on malformed JSON
- `src/internal/llm/router.ts` — wraps every resolved client (1-line wire)
- `tests/llm-fault-injection.test.ts` — 12 unit tests (gate negative + active
  per status class + idempotence + name preservation)
- `tests/llm-fault-injection-router-wiring.test.ts` — 3 wiring tests proving
  end-to-end the override reaches `Agent.send` via the router

### Fixed — `Agent.getOrCreate` no longer returns disposed cached agents

Pre-existing race: any caller that did `await agent.dispose()` followed by
`Agent.getOrCreate(sameId, opts)` received the DISPOSED instance from
`Agent.registry`; the subsequent `agent.send()` threw
`"Agent has been disposed"`. Surfaced as 9/48 failures in the telegram-pro
2026-05-28 dogfood (`Remember:`, `/recall`, `/tool uuid`, `/tool roll`,
`/personality coder/poet/none/ghost`, post-personality text).

Fix:

- `LiveAgentRegistry.forget(id)` — new internal helper that removes a cache
  entry WITHOUT calling `dispose()` or `onEvict` (idempotent on unknown ids).
- `LocalAgent.dispose()` now calls `liveAgentRegistry.forget(this.agentId)`
  inside the `disposed = true` block, so a subsequent `Agent.getOrCreate(id)`
  always builds a fresh instance.

Regression tests:

- `tests/agent-registry-cache.test.ts` —
  `dispose() self-evicts so next getOrCreate returns a fresh agent`.
- `tests/internal/runtime/live-agent-registry.test.ts` —
  `forget(id) removes from cache without calling dispose` +
  `forget(id) is idempotent for unknown ids`.

Verified end-to-end by the telegram-pro 2026-05-28 dogfood after the fix:
**47/48 PASS, 1 SKIP (HONCHO_API_KEY env unset), 0 FAIL** (vs 38/48 PASS, 9
FAIL before the fix).

### Added — Auto-populated `RunResult.usage` + `RunResult.cost` (ADRs D375-D388, T4.2 scope-cut lifted)

- `agent.send`-driven runs now expose aggregated token usage on
  `RunResult.usage` (5-bucket `TokenUsage` per D376) and an inferred
  `RunResult.cost` (`CostBreakdown` per D377) automatically. No caller-side
  composition required for the read side — callers still wrap with
  `preflightCheck` / `chargeAndCheckThresholds` for budget enforcement.
- OpenAI / OpenRouter SSE accumulator parses 5 token buckets:
  `prompt_tokens_details.cached_tokens` → `cacheReadTokens`,
  `completion_tokens_details.reasoning_tokens` → `reasoningTokens`, plus the
  a peer#10266 top-level `cache_read_input_tokens` /
  `cache_creation_input_tokens` fallback for Anthropic-on-OpenRouter.
- `stream_options: { include_usage: true }` is now sent on every
  Chat Completions request so the final usage chunk arrives reliably.
- Agent loop carries a `UsageAccumulator` per send; each LLM turn merges in,
  the totals land on `AgentLoopOutput.usage` / `AgentLoopOutput.cost`.
- `FixtureScript` extended with `usage?` / `cost?` so non-fixture runs (the
  real local runtime) plumb the values into `RunResult` via
  `buildResult` in `FixtureRunBase` — fixture mode remains unchanged.
- Validated end-to-end against OpenRouter (`openai/gpt-4o-mini`): real
  reply, real tokens (`input=68 output=2`), real cost (`$0.000011 estimated`),
  ledger reconciles bit-identical. Report:
  `.claude/knowledge-base/reviews/budget-dogfood-2026-05-28.md`.

### Added — Task observability registry (ADRs D361-D374, Adoption Roadmap gap #2)

- `Task` namespace (`@theokit/sdk`) exposing static methods `submit`, `list`,
  `get`, `cancel`, `subscribe`, `configure`. Closed 5-state lifecycle
  (`queued | running | finished | error | cancelled`).
- Pluggable `TaskStore` interface + 2 backends — `InMemoryTaskStore` (default,
  transient) and `JsonFileTaskStore` (opt-in, one JSON file per task,
  single-process invariant documented). SQLite backend deferred to v0.2.
- New sub-export `@theokit/sdk/task-store` for cross-process readers
  (the `theokit tasks` CLI consumes this).
- Ring buffer (cap 64) per task for late-attach `subscribe` replay (D372).
- Idempotent cancel — `Task.cancel(id, reason?)` returns
  `{ cancelled, alreadyTerminal }`, never throws.
- Cross-process best-effort cancel via `cancelRequested: boolean` field on
  `TaskHandle`; the CLI writes it, the owning Node process honors it at the
  next checkpoint (EC-7).
- 3 OTel spans via existing telemetry seam (D34): `task.submit`,
  `task.transition`, `task.cancel` (D371). No new peer deps.
- Errors: `InvalidTaskIdError`, `TaskNotFoundError`,
  `UnsupportedTaskOperationError` exported from the main entry.
- Auto-eviction: terminal tasks GC'd after retention (InMemory 1h, JsonFile 7d
  defaults; configurable via `Task.configure({ retentionMs })`).
- 62 SDK tests passing across 6 files. 16 edge cases absorbed (EC-1..EC-16).

### Scope cuts (v1)

- `Agent.send` / `Agent.batch` / `Workflow.run` / `Cron.register` do NOT yet
  accept a `{ task: true }` option — that adapter integration is deferred to
  v0.2 (see plan v1.2). Today: callers compose via
  `Task.submit("kind", async (ctx) => agent.send(prompt, { signal: ctx.signal }))`.
- SQLite cross-process backend deferred to v0.2 — JsonFileTaskStore is
  documented as single-process-only.
- `CloudAgent` task ops throw `UnsupportedTaskOperationError` (D370).

## 1.1.0

### Minor Changes

- Production-readiness for serverless and multi-host deploys (6 gaps from TheoKit cross-repo handoff).

  **Added:**

  - **`ConversationStorageAdapter`** interface + `FileSystemConversationStorage` (default) + `InMemoryConversationStorage`. New `AgentOptions.conversationStorage` opt-in. Postgres + Redis recipes in `docs/recipes/`. Strict resume integrity check via `requiresCustomStorage` marker (D325).
  - **`Agent.registry`** — LRU + idle-timeout GC for live `SDKAgent` instances. `configure / evict / evictAll / size / ids` + `onEvict` listener. Defaults: `maxAgents: 100`, `idleTimeoutMs: 30 min`. Eliminates OOM in 24/7 Node deploys.
  - **`AgentRunErrorCode`** discriminated union (16 codes including `quota_exceeded`, `tool_runtime_error`, `aborted`, `invalid_model`, `safety_blocked`, `provider_unreachable`). Plus `AgentRunError.requestId` / `.conversationId` fields and `.retriable` / `.retryAfterMs` / `.providerError` getters. Anti-leak invariant: `providerError` never in `.message`.
  - **`SendOptions.signal`** propagates end-to-end to LLM `fetch({ signal })`. Tokens stop billing on caller cancel. `anySignal` ponyfill for a peer vendor Edge subsets without native `AbortSignal.any`. `agent.dispose()` fires lifecycle abort. Aborted runs throw `AgentRunError({ code: "aborted" })`; no partial assistant message persists.
  - **`AgentOptions.onToolStart` / `onToolEnd` / `onToolError`** — observation callbacks with `callId` pair correlation + `durationMs`. Hook errors swallowed (do not crash run).
  - **`AgentOptions.onBeforeCreate` / `onBeforeSend`** — admission gates for multi-tenant quota. Errors propagate (NOT swallowed — these are blockers, not observers).

  25 new ADRs (D303-D325). 113 new tests. 3 real-LLM examples in `examples/{conversation-storage,abort-mid-stream,tool-hooks-tracking}/`. Postgres + Redis recipes in `docs/recipes/`. Full `docs.md` sections: Conversation storage, Agent registry lifecycle, Error codes, Cancellation, Tool lifecycle hooks, Quota / abuse hooks.

  **Backward compatibility:** all new fields opt-in with safe defaults. Existing apps (telegram-pro, slack-bot, whatsapp-bot, email-bot, teams-bot, vertex-bot, bedrock-bot, handoffs, workflows, cache, eval, skills-google-workspace) compile and run unmodified.

  Closes Gaps 1-6 of `docs/handoffs/from-theokit/2026-05-25-production-readiness.md`.

## [Unreleased]

### Added (`onBeforeCreate` / `onBeforeSend` quota gates — Production-Readiness #6)

Closes Gap 6 of the TheoKit cross-repo handoff. Lets multi-tenant SaaS deploys enforce per-user / per-conversation quotas at the SDK boundary.

- **`AgentOptions.onBeforeCreate`** fires BEFORE the agent is registered or persisted. Receives `{ conversationId, userId? }`. Throwing blocks creation — error propagates as `Agent.create` rejection.
- **`AgentOptions.onBeforeSend`** fires BEFORE each `agent.send` (before LLM call, before storage append). Receives `{ conversationId, previousMessageCount }`. Throwing blocks the send.
- **Errors are NOT swallowed (D322).** Unlike tool lifecycle hooks (observation), quota hooks are admission gates — their throws propagate by design.
- **Order: validate → quota gate → side effects (D323).** Rejected hooks leave zero orphan state on disk or in memory.
- **`onBeforeCreate` skipped on `Agent.registry` cache hit** — caching is per-process, cold-path always runs the hook.
- **ADRs:** D322 (errors propagate), D323 (fire before side effects).
- **Tests:** 8 new in `tests/agent-quota-hooks.test.ts` covering resolve/reject paths, `userId` propagation, no-orphan-on-reject, `previousMessageCount` semantics.

### Added (`onToolStart` / `onToolEnd` / `onToolError` tool lifecycle hooks — Production-Readiness #4)

Closes Gap 4 of the TheoKit cross-repo handoff. Cost tracking, audit log, per-tool retry/alerting without writing a plugin.

- **`AgentOptions.onToolStart`**, **`onToolEnd`**, **`onToolError`** callbacks accepted in `AgentOptions` (top-level — no plugin needed; D315). Match a peer framework `onChunk`/`onFinish` ergonomics.
- **`callId` propagated** through the start/end (or start/error) pair from the existing `generateCallId()` in dispatch (D316). Consumers correlate without managing their own counter.
- **`durationMs`** measured between start hook fire and end/error hook fire — handler latency.
- **Hook errors swallowed** via single `safeEmitToolHook` chokepoint (D317). Listener throws logged to stderr but never crash the run.
- **`onToolError.event.error` is ALWAYS an `Error` instance** (EC-6 absorbed) — stderr-string-only failures wrapped in `new Error(stderr)`.
- **`attempt: 1`** always in v1 (D317 placeholder — reserved for future tool retry policy).
- **ADRs:** D315 (AgentOptions surface), D316 (callId reuse), D317 (hook errors swallowed — EC-6 absorbed).
- **Tests:** 3 new in `tests/agent-tool-hooks.test.ts` (surface acceptance + listener-throw safety).

### Added (`AbortSignal` end-to-end propagation — Production-Readiness #5)

Closes Gap 5 of the TheoKit cross-repo handoff. Tokens stop billing the moment a caller (browser, route handler, `agent.dispose`) signals cancellation.

- **`SendOptions.signal`** (already typed) now flows from `LocalAgent.send` → `dispatchRun` → `real-local-run.buildLoopInputs` → `AgentLoopInputs.signal` → `streamLlmTurn` → LLM client `fetch({ signal })`. The infrastructure was already in place at every LLM client; only the orchestrator wiring was missing.
- **`LocalAgent.#lifecycleAbortController`**: every agent owns a private controller fired by `dispose()`. `send()` composes `[userSignal, lifecycleSignal]` via `anySignal` so eviction (`Agent.registry.evict`) cancels in-flight LLM calls promptly.
- **`anySignal` ponyfill** (`internal/runtime/abort-utils.ts`) absorbs EC-5: native `AbortSignal.any` when available, ponyfill for runtimes (a peer vendor Edge subset) that lag. Single-signal short-circuit, undefined entries filtered, abort `reason` propagated.
- **`AgentLoopInputs.signal`** new optional field; loop uses caller's signal when present, never-aborting placeholder otherwise (legacy behavior preserved when nothing wired).
- **Aborted runs surface as `AgentRunError({ code: "aborted", retriable: false })`** (D321 + T3.5 finalization). `err.cause` preserves the original `DOMException`.
- **Aborted runs do not persist partial assistant messages** (D320): the user message persists at entry; the abort path skips the assistant append, preserving conversation history invariant.
- **ADRs:** D318 (signal plumbing), D319 (lifecycle controller composition), D320 (no partial persist), D321 (AgentRunError aborted wrapping), D324 (anySignal ponyfill — absorbed from EC-5).
- **Tests:** 13 new (abort-utils — native + ponyfill + edge cases) + 3 wiring sanity tests. Full real-LLM abort dogfood is part of Phase 7.

### Added/Changed (`AgentRunError` discriminated codes + retryAfterMs + requestId — Production-Readiness #3)

Closes Gap 3 of the TheoKit cross-repo handoff. Makes `AgentRunError` consumer-branchable for proper UX (retry CTAs, billing upsell, cancel suppression) without parsing `.message` strings.

**Added:**

- **`AgentRunErrorCode`** discriminated union (16 codes) exported from `@theokit/sdk`. Supersets `ErrorCode` with non-HTTP origins (`quota_exceeded`, `tool_runtime_error`, `aborted`, `invalid_model`, `safety_blocked`, `provider_unreachable`). Trailing `(string & {})` keeps autocomplete + accepts legacy provider-prefixed strings.
- **`AgentRunError.requestId`** + **`AgentRunError.conversationId`** fields. Provider's `x-request-id` / `request-id` header parsed via `parseRequestId` helper in `internal/errors/mappers/shared.ts`. `conversationId` settable by caller for log correlation.
- **`AgentRunError.retriable`** getter — alias for `isRetryable` (handoff contract; future v2 deprecates `isRetryable`).
- **`AgentRunError.retryAfterMs`** computed getter — `metadata.retryAfter * 1000` so callers compose with `Date.now()` / `setTimeout` directly. Returns `0` (not `undefined`) when provider sent `Retry-After: 0` (EC-11).
- **`AgentRunError.providerError`** getter — aliases `metadata.raw`. Anti-leak invariant: `.message` NEVER contains the raw body (D313).
- **`DispatchResult.errorCode`** field — distinguishes tool dispatch failures: `tool_runtime_error` (handler throw), `invalid_request` (validate failure), `unknown` (registry miss). Consumers mapping DispatchResult → AgentRunError use this directly.
- **`docs/error-codes.md`** standalone reference with provider mapping tables.

**Changed:**

- **OpenAI-compatible mapper** detects HTTP 402 + body `code: "insufficient_quota"` / `"quota_exceeded"` and maps to `invalid_request` (ErrorCode is HTTP-pure per D314 — quota_exceeded at AgentRunError layer).
- **`buildErrorMetadata`** now exposes `parseRequestId` companion for mapper consumption (D314).

**ADRs:** D311 (code union + escape hatch), D312 (retryAfterMs getter), D313 (providerError alias), D314 (mapper priorities).

**Tests:** 20 new in `tests/errors/agent-run-error-fields.test.ts` (all 6 new codes accepted, getters compute correctly, EC-11 zero-retryAfter, anti-leak invariant). 4 new in `tests/tool-dispatch/tool-error-code.test.ts`. 5 new in `tests/internal/errors/mappers/shared.test.ts` for parseRequestId. 2 new in `tests/internal/errors/mappers/openai-compatible.test.ts` for 402 / insufficient_quota.

**Backward compat:** existing `AgentRunError` callers unaffected — new fields are optional, getters compute on demand, `code: string` accepted via `& {}`.

### Added (`Agent.registry` — LRU + idle GC for live agents — Production-Readiness #2)

Closes Gap 2 of the TheoKit cross-repo handoff. Eliminates OOM in 24/7 Node deploys that previously had no eviction for the live agent set (TheoKit's `dev-agent-gc.ts` only ran in dev mode; production servers accumulated agents until heap pressure crashed them).

- **`Agent.registry`** static property exposes the process-wide `LiveAgentRegistry` singleton (ADR D310). Surface: `configure`, `evict`, `evictAll`, `size`, `ids`.
- **LRU eviction** when `size > maxAgents`. Sync `set` path; eviction runs fire-and-forget (caller doesn't await `dispose`).
- **Idle timeout sweep** drops agents whose `lastUsedAt < now - idleTimeoutMs`. Configurable sweep interval (default 60s). `setInterval` is `unref()`'d so it does not keep the event loop alive at process exit.
- **`onEvict(id, reason)`** observability listener. Reason is `"lru" | "idle" | "explicit"`. Listener errors are swallowed with stderr warn (D309 — eviction must not block).
- **Defaults** (ADR D308): `maxAgents: 100`, `idleTimeoutMs: 30 min`, `sweepIntervalMs: 60_000`. Calibrated for indie/small-team deploys. High-traffic SaaS sets larger; `maxAgents: 0` disables the cache entirely.
- **`agent.dispose()` called on every eviction** (D309). Errors caught + swallowed so a stuck dispose doesn't block subsequent evictions.
- **`Agent.getOrCreate` cache hit** (T2.6): consults `Agent.registry.get(id)` before resume/create. `get` refreshes `lastUsedAt` so frequently-used agents resist eviction.
- **EC-4 absorbed**: `set(id, newAgent)` when `id` already maps to a different agent disposes the old before overwriting (prevents leak under racing `getOrCreate` calls). Idempotent when same instance.
- **EC-8 absorbed**: idle sweep re-checks entry identity after the dispose await; a `set` that landed mid-sweep is not deleted.
- **ADRs:** D307 (live vs metadata registry separation), D308 (default tuning), D309 (dispose swallow on eviction), D310 (process-wide singleton).
- **Tests:** 22 new (16 unit + 6 integration). Coverage: LRU recency, refresh saves, dispose-on-overwrite, dispose-error-swallow, idle sweep eviction, onEvict reasons, maxAgents=0 disables cache.

### Added (`ConversationStorageAdapter` — pluggable conversation persistence — Production-Readiness #1)

Closes Gap 1 of the TheoKit cross-repo production-readiness handoff (`docs/handoffs/from-theokit/2026-05-25-production-readiness.md`). Unblocks serverless (a peer vendor, Cloudflare Workers, Lambda) and multi-host (K8s replicas, TheoCloud canary) deploys that cannot use the default `<cwd>/.theokit/agents/<id>/messages.jsonl` filesystem persistence.

- **`ConversationStorageAdapter`** interface exported from `@theokit/sdk`. 5 methods (`getMessages`, `appendMessage`, `deleteConversation`, optional `listConversationIds`, optional `compact`, optional `dispose`). Implementations return `Promise<>` uniformly for adapter polymorphism (ADR D306).
- **`FileSystemConversationStorage`** exported. Default when `AgentOptions.conversationStorage` is unset (zero migration — existing apps unaffected). Wraps the pre-D303 byte-identical behavior including redaction (D68) + compaction every 50 appends (D18). Path-traversal guard re-applied in `deleteConversation` (EC-1, ADR D304); ENOENT swallowed in `listConversationIds` for first-run deploys (EC-2).
- **`InMemoryConversationStorage`** exported. `Map<conversationId, StoredMessage[]>` for tests + ephemeral dev. Returns defensive copies from `getMessages`.
- **`StoredMessage`** widened from `user|assistant` to 5 roles (`user|assistant|system|tool_call|tool_result`) for forward compat with tool-shaped messages flowing through the adapter (EC-10, ADR D304). Legacy JSONL files continue to parse — `readSessionFile` filters defensively.
- **`AgentOptions.conversationStorage?`** opt-in field. Backward compatible: undefined → default FS adapter at `local.cwd`.
- **Strict resume integrity (EC-3, ADR D325)** — when an agent is created with a custom `conversationStorage`, the registry stores a `requiresCustomStorage: true` marker. `Agent.resume` throws `ConfigurationError(code: "conversation_storage_required")` if the marker is set and the caller did not pass `conversationStorage` again. Prevents silent FS fallback that would lose Postgres/Redis history.
- **Recipes** at `docs/recipes/conversation-storage-postgres.md` and `docs/recipes/conversation-storage-redis.md`. Both ship Node (pg / ioredis) + Edge (`@neondatabase/serverless` / `@upstash/redis`) flavors. SDK keeps these out of core deps to stay light (ADR D305).
- **Tests:** 33 new tests in `tests/internal/persistence/conversation-storage-*.test.ts` + `tests/agent-conversation-storage.test.ts`. Contract suite runs against both InMemory + FS via `describe.each`. Coverage includes: lazy create, insertion order, 50× concurrent appends, idempotent delete, defensive copy, path-traversal rejection, ENOENT empty list, tool_call/tool_result roles, redaction, FS-restart persistence, EC-3 marker round-trip + strict-resume throw.
- **ADRs:** D303 (main barrel export), D304 (FS default + InMemory primary), D305 (Postgres/Redis as recipes), D306 (Promise-uniform interface), D325 (requiresCustomStorage marker).

### Fixed (`Agent.streamObject` / `Agent.generateObject` provider routing)

- **`StreamObjectOptions.providers?` + `GenerateObjectOptions.providers?`** — new optional field forwarded to the transient agent. Without it, the transient agent infers provider from `model.id` prefix per ADR D186; users running `model: "openai/gpt-4o-mini"` with only `OPENROUTER_API_KEY` set hit `ConfigurationError(provider_unresolved)` because the SDK looks for `OPENAI_API_KEY`. Forwarding `providers: { routes: [{capability:"chat", provider:"openrouter"}], fallback: ["openrouter"] }` routes through OpenRouter as the user expects.
- **Underlying-error surfacing** — when the transient agent fails BEFORE the LLM is called (e.g. `provider_unresolved`), both `StreamObjectError` and `GenerateObjectError` now wrap the original cause with a clear message ("Agent run failed before the model could reply: …") instead of the misleading "The model returned text instead of calling the `output` tool." Pre-fix users saw a tool-call diagnostic for what is actually a config error.
- **Evidence:** real-LLM dogfood `examples/telegram-pro` → `/factstream jazz` failed deterministically with OpenRouter key + `openai/gpt-4o-mini` model. Bot's `/factstream` handler updated to forward `buildProviderRouting()` to `Agent.streamObject({ providers })`. Post-fix: `/factstream` PASSES consistently; full dogfood 40/42 (vs prior 39/42).

### Added (`Agent.prompt` ergonomics — `throwOnError` + `AgentRunError`)

- **`AgentRunError`** — new public error class (extends `TheokitAgentError`). Carries `code`, `provider`, `raw` fields from a failed `RunResult.error`. Exported from the package barrel.
- **`AgentOptions.throwOnError?: boolean`** — opt-in flag (default `false`, non-breaking). When `true`, `Agent.prompt` rejects with `AgentRunError` instead of resolving with `{ status: 'error', error }`. Reduces idiomatic chat-handler snippets from ~10 lines (status branch) to ~6 lines (try/catch). Cancelled status (`'cancelled'`) does NOT throw — cancel ≠ error. Defensive guard skips throw when `result.error === undefined` (malformed RunResult).
- **Tests:** 8 tests for `AgentRunError` shape (instanceof chain, fields, message preservation, cause chaining, barrel export). 7 tests for `throwOnError` semantics including EC-2 (cancelled doesn't throw) + EC-3 (defensive guard).

### Security (defence-in-depth fix in `assertNoSymlinkEscape`)

- **Intermediate-symlink escape closed.** Previous implementation called `lstatSync(path)` only on the **terminal** component. If an intermediate directory in the path was itself a symlink to a location outside `base` (`/project/inner → /outside`), accessing `/project/inner/file.txt` would physically read `/outside/file.txt` and the guard would NOT detect the escape — `lstat` followed the intermediate symlink and reported a regular file. **Fix:** walk to the deepest existing ancestor, `realpathSync` it, then re-attach the lexical suffix; compare against the canonical base. Two new tests pin the fix (terminal-not-yet-created variant included). All 27 existing consumer tests (`agent-session-store`, `persistence/paths`, `lint/no-unguarded-path-input`) remain green.

### Added (`@theokit/sdk/tools` sub-export — built-in tools for coding agents)

**Drop-in toolkit any coding agent on top of `@theokit/sdk` needs without reimplementing: read, list, search, diff, test.**

- **`createReadFileTool({ projectRoot })`** — read a project-relative file as UTF-8. Refuses traversal, sensitive files (`.env*` / `.git/` / `node_modules/` / `.theo/` / lock files), binary files (null-byte detection in first 8 KB; EC-5), and files larger than 5 MB. Returns `{ ok, content, size }` or `{ ok: false, error }`. 12 tests.
- **`createListDirTool({ projectRoot, max? })`** — list direct entries of a project-relative directory. Defaults to a 500-entry cap (EC-6: avoid 5 MB JSON payloads in 10k-file projects). Each entry exposes `{ name, type: 'file' | 'directory' }`. Result includes `{ truncated, totalCount }` so the agent can refine. 8 tests.
- **`createSearchTextTool({ projectRoot, maxMatches?, maxFileSize? })`** — recursive literal-text search. Skips sensitive dirs, binary files, and files larger than 1 MB. Defaults to a 100-match cap. Returns `{ matches: [{ file, line, preview }], truncated, totalMatches }`. 8 tests.
- **`createGitDiffTool({ projectRoot, timeoutMs?, maxStdoutBytes? })`** — `git diff` wrapper. Supports `{ path, cached }` scoping. 30s timeout (kills the whole process group on expiry; EC-7). 5 MB stdout cap. Returns `{ diff, truncated }` or `{ ok: false, error: 'not_a_repo' | 'timeout' | 'git_failed' }`. 7 tests.
- **`createRunVitestTool({ projectRoot, timeoutMs?, maxStdoutBytes? })`** — vitest runner via `npx --no-install vitest`. **EC-12** fix: parser walks stdout bottom-up to extract the last valid JSON line — skips node deprecation warnings that vitest prepends. 120s timeout + process-group kill. Returns `{ ok, summary }` with `{ numTotalTests, numPassedTests, numFailedTests, success }`. Helper `extractTrailingJson` exported for direct testing. 6 tests.
- **Public surface** at `@theokit/sdk/tools`. Tsup entry `tools: "src/tools/index.ts"` produces `dist/tools.js` + `.d.ts`; package.json `exports["./tools"]` resolves both ESM + CJS + types. Sub-export smoke test (`tests/tools/sub-export-smoke.test.ts`) pins the 5 named exports.

44 tests total in `tests/tools/` (12 + 8 + 8 + 7 + 6 + 5 smoke).

### Added (`@theokit/sdk/path-safety` sub-export — path-traversal primitives go public)

- **`safePathJoin`, `assertNoSymlinkEscape`, `PathTraversalError`** now exported from `@theokit/sdk/path-safety`. Previously `@internal`; promoted so consumer agents (TheoKit Studio, cli-bot, future coding agents) can validate user-supplied paths without reinventing the guard. Wire shape is unchanged — same signatures, same `ConfigurationError` code (`path_traversal`).
- **`isForbiddenPath(input)`** — new public primitive shipping the universal sensitive-file blocklist (`.env*` except `.env.example`, `.git/**`, `node_modules/**`, `.theo/**`, lock files). Cross-platform path normalisation (backslashes folded to forward slashes). 15-case test suite covering each blocklist family. Companion error `ForbiddenPathError` (extends `ConfigurationError`, code `forbidden_path`).
- **Dedicated sub-export** (`./path-safety` in package.json `exports`, separate from the main barrel). Architectural choice: the path-guard module reaches into `internal/runtime` via `errors.js`, which participates in a known import cycle `types/agent.ts ↔ fork-agent.ts`. The dedicated sub-export keeps DTS bundling decoupled — without it, rollup-plugin-dts surfaces a fatal "ForkOptions not exported" false positive on the main bundle.
- **Public-API smoke test** (`tests/path-safety-public-api.test.ts`) pins the sub-export so a refactor cannot silently revert these to `@internal`.

### Added (Ollama integration complete — ADRs D182-D190)

**Local-first LLM stack: chat, embeddings, RAG, models discovery, plus LM Studio
and llama.cpp sibling profiles. 100% local, zero remote API keys required.**

- **Ollama builtin provider profile** (D182). `Agent.create({ model: "ollama/llama3.2:3b" })`
  works zero-config after `ollama serve`. `authType: "none"` + sentinel
  `"ollama-local"` Bearer token; local Ollama ignores the Authorization header.
- **`Ollama embedding adapter`** (D183). Sixth entry in `MEMORY_EMBEDDING_ADAPTERS`,
  targets `/v1/embeddings` (OpenAI-compat). Default model `nomic-embed-text`
  (768 dim). First adapter with `transport: "local"` — `transport` union
  extended from `"remote"` to `"remote" | "local"`. Supports `nomic-embed-text`,
  `all-minilm`, `bge-large`, `bge-m3`, `mxbai-embed-large`.
- **`Theokit.models.list({ provider: "ollama" })`** (D184). New optional
  `provider` field on `TheokitRequestOptions` routes to the provider's local
  `/v1/models` endpoint when targeted profile has `authType: "none"`. Cloud
  catalog path unchanged when no `provider` is passed (backward compat).
- **Typed actionable error mapping** (D185). New `mapOllamaTransportError`
  (ECONNREFUSED/ENOTFOUND → "Run \`ollama serve\`") and `mapOllamaHttpError`
  (404 → "Run \`ollama pull <model>\`"; 503 model-loading → retryable). Wired
  into `OpenAIClient` via new optional `providerName` constructor option.
- **Provider inference from model.id prefix** (D186). `model: "ollama/llama3.2:3b"`
  routes to the Ollama profile and sends `llama3.2:3b` as the model name to the
  LLM body. Aligned with OpenRouter / Hermes / a peer framework patterns. Aliases
  `llama-cpp`/`llama.cpp` → `llamacpp`, `lm-studio` → `lmstudio`.
- **CredentialPool no-op for `authType: "none"`** (D187). `apiKeys: { ollama: [...] }`
  is silently ignored with one-shot stderr warn instead of building a meaningless
  pool of sentinels.
- **LM Studio builtin profile** (D188). `name: "lmstudio"`, aliases
  `["lm-studio", "lm_studio"]`, default port 1234, `LMSTUDIO_HOST` override.
- **llama.cpp server builtin profile** (D189). `name: "llamacpp"`, aliases
  `["llama-cpp", "llama.cpp"]`, default port 8080, `LLAMACPP_HOST` override.
- **OLLAMA_HOST / LMSTUDIO_HOST / LLAMACPP_HOST baseUrl overrides** wired in
  `selectTransport` (alongside existing `OPENAI_API_BASE_URL` etc.).
- **`OLLAMA_API_KEY`** env var override (optional) for Ollama Cloud or
  reverse-proxy-with-auth setups.
- **Memory.runDreamingSweep accepts `provider: "ollama"`** in its embedding
  union — fully-local dreaming/clustering is now possible.
- **`examples/ollama-hello/`** (D190) — minimal Agent.create + send + stream
  against `ollama/llama3.2:3b`. Zero API keys.
- **`examples/ollama-local-rag/`** (D190) — 100%-local RAG pipeline: embedding
  via `nomic-embed-text`, cosine similarity ranking, context-augmented
  `agent.send` against `llama3.2:3b`. Sample corpus included.
- **Integration tests against real Ollama** (T1.2, T3.1, T5.1) under
  `tests/integration/` with `skipIf` probes — silent when daemon absent,
  proves end-to-end when present. Per `.claude/rules/real-llm-validation.md`.

**Internal: `parseModelId`** sync helper for provider/name splitting; reused by
`buildLoopInputs` and exported from `internal/llm/model-identifier.ts`.

### Added (v1.14 personality-presets — Hermes #26, ADRs D160-D169)

- **`Agent.usePersonality(name, opts?)`** public API on `SDKAgent`
  (#roadmap-row-5). Activates a personality preset for the next `send`.
  Reserved names `none` / `default` / `neutral` clear the active preset.
  Returns the resolved `PersonalityPreset` (or `null` when cleared).
  Cloud agents reject with `UnsupportedRunOperationError` (D169).
- **`PersonalityRegistry`** + **`PersonalityPreset`** re-exported from
  `@theokit/sdk` (read-only). Reads from `<cwd>/.theokit/personalities/*.md`
  (project) + `~/.theokit/personalities/*.md` (user) with project-wins-on-
  collision (D162).
- **Markdown + Zod frontmatter shape** (D161) — `name` (lowercase-only
  slug, EC-C), `description?`, `tools?` (advisory whitelist), `model?`,
  `tags?`, body = system-prompt overlay. Mirrors `.theokit/agents/*.md`.
- **Session-default + persistent-opt-in state** (D163) — in-memory per
  `agentId` by default; `{ save: true }` writes to
  `$THEOKIT_HOME/personality.json`. **EC-B:** clear with save DELETES
  the key (never `"agent-id": null`).
- **Switch lifecycle** (D164) — preserves history by default
  (`{ reset: true }` for opt-in clear), appends user-role transcript
  marker (`[persona switched to <slug>]` or `[persona cleared]`), and
  invalidates the prompt cache via D94 deferred (`reason:
"personality-switch"`).
- **Tool whitelist filter** (D167) — `applyPersonalityFilter` narrows
  the exposed `customTools` set; missing entries log a one-shot warn
  with Levenshtein-distance-≤2 "did you mean" hint. Subtractive only
  (D102 layer 4). MCP-style names (`mcp__server__tool`) matched as
  exact strings (EC-I).
- **Fork inheritance via `AsyncLocalStorage`** (D168) — fork captures
  the parent's active slug **at construction time** as a primitive
  snapshot (EC-A). Parent mid-flight `usePersonality` does NOT mutate
  the fork's voice. `usePersonality` inside a fork = no-op + one-shot
  warning.
- **CloudAgent.usePersonality** throws `UnsupportedRunOperationError`
  synchronously (D169, matches D122 pattern).

### Added (v1.13 context-files-coverage — ADRs D150-D159)

- **`FileContextManager` auto-discovery extended** beyond `.theokit/context/*.md`
  to the 2026 industry-standard set:
  - `AGENTS.md` — Linux-Foundation-stewarded, 60k+ repo adoption.
  - `CLAUDE.md` — Anthropic's house format, walk-up + `@import` syntax.
  - `GEMINI.md` — Google Gemini CLI, same shape as CLAUDE.md.
  - `.cursor/rules/*.mdc` — Cursor's current format with frontmatter
    (globs/description/alwaysApply); legacy `.cursorrules` deliberately
    skipped (deprecated by Cursor itself).
  - `.theokit/THEO.md` — new SDK-specific override file (D153 placed
    inside `.theokit/` for zero root pollution).
- **Walk-up-to-git-root discovery** (D151) — pure `existsSync` checks,
  no `.gitignore` parsing (EC-A KISS), no `.theokitignore` (EC-B scope
  creep dropped). `realpathSync` dedupes symlink chains (EC-F). Git
  worktrees work via `.git` as a file (EC-N).
- **`@path` import resolver** (D156) — Anthropic/Gemini convention,
  5-hop cap with cycle detection. EC-D: every imported file capped at
  `maxBytesPerFile` BEFORE concatenation (prevents balloon from
  multi-import). EC-Q: line-anchored (`^@\S+$`), inline references
  preserved.
- **MDC parser** (D154) — YAML frontmatter (`globs`/`description`/
  `alwaysApply`), in-house glob → regex (no `minimatch` dep). EC-I: at
  `agent.send()` time `touchedFiles=[]`, so only `alwaysApply: true`
  rules activate in v1.
- **Aggregate cap** (D155) — per-file 40_000 chars + total 120_000
  chars. 70/20 head/tail truncation with `…[truncated by theokit]`
  marker. EC-C guard: if `max ≤ MARKER.length`, return head-only slice
  without marker. EC-J: same-priority sort tie-breaks by source path lex
  for prompt-cache stability.
- **EC-E privacy fix** — disambiguation uses `relative(gitRoot ?? cwd,
dirname(path))` for source names, NEVER absolute paths. Prevents
  developer home dir / project name from leaking into LLM provider
  logs.
- **Telemetry counters** (D159) — `context_files_truncated` (per-file)
  - `context_files_total_truncated` (aggregate drop). Lazy `tracer`
    lookup via `globalThis.__theokit_tracer`; no-op when OTel not
    installed (EC-L).
- **Backward compat** (D158) — existing `.theokit/context/*.md` Zod
  frontmatter sources keep working unchanged. Legacy `.theokit/
context.json` loads CONTENT and emits one-time deprecation warning
  (EC-K verified).
- **Public API additions** in `AgentOptions.context`:
  - `maxBytesPerFile?: number` (default 40_000)
  - `maxBytesTotal?: number` (default 120_000)

### New internal modules

- `internal/runtime/context-discovery.ts` — DiscoverySpec + `findGitRoot`
  - `walkUpForFile` + `walkUpForGlob`.
- `internal/runtime/context-loaders.ts` — `loadPlainMarkdown` +
  `truncateWithMarker`.
- `internal/runtime/context-import-resolver.ts` — `resolveImports`
  with 5-hop + cycle detection + per-import cap.
- `internal/runtime/context-mdc-parser.ts` — MDC frontmatter parser +
  `shouldActivate`.
- `internal/runtime/context-aggregator.ts` — `applyAggregateCap`.
- `internal/runtime/context-discovery-runner.ts` — orchestrator over
  all specs.

### Test counts

- 1062 → **1132 PASS** baseline + **70 new tests** across:
  - `context-discovery.test.ts` (17)
  - `context-loaders.test.ts` (15)
  - `context-import-resolver.test.ts` (12)
  - `context-mdc-parser.test.ts` (8)
  - `context-aggregator.test.ts` (7)
  - `context-manager-multi-format.test.ts` (11)
  - `context-backward-compat.test.ts` (5) — 5 regression
- 10 new ADRs (D150-D159).
- CLAUDE.md SDK Roadmap row #4 → ✅ DONE.

---

### Added (v1.12 memory-provider-adapters — ADRs D141-D149)

- **`packages/sdk/src/types/memory-adapter.ts`** — public `MemoryAdapter`,
  `MemoryContext`, `MemoryFact`, `MemoryId`, `MemoryRevision`,
  `MemoryAdapterCapabilities`, `AgentMemory`, `MemoryToolSchema`,
  `MemoryTurnMessage` types. `mkMemoryId(provider, raw)` +
  `extractRawId(id, expected)` enforce cross-adapter id integrity
  (EC-B: prevents `mem0.delete(supermemoryId)` footgun).
- **`packages/sdk/src/errors.ts`** — new public `MemoryAdapterError`
  - finite `MemoryAdapterErrorCode` literal union (`"auth_failed"`,
    `"rate_limited"`, `"not_found"`, `"network"`, `"invalid_input"`,
    `"unknown"`).
- **`packages/sdk/src/internal/plugins/types.ts`** — narrows
  `MemoryProviderFactory` return type from `unknown` to
  `MemoryAdapter | Promise<MemoryAdapter>`. Adds `PreUserSendContext`,
  `PreUserSendResult`, `PostAssistantReplyContext` interfaces and
  the two new `HookName` entries.
- **`packages/sdk/src/internal/plugins/manager.ts`** —
  `runPreUserSendHooks(ctx, maxBytes)` concatenates handler results,
  caps at `maxRecallContextBytes` (EC-A), isolates per-handler
  failures to stderr. `runPostAssistantReplyHooks(ctx)` fire-and-forget.
- **`packages/sdk/src/internal/runtime/local-agent.ts`** wires the new
  hooks: `pre_user_send` injects `<memory-context>` fence around the
  prompt (EC-G safe — only injected fence is trimmed); `post_assistant_reply`
  fires after `run.wait()` via a wrapped `Run` proxy.
- **`packages/sdk/src/internal/runtime/local-agent-memory-direct.ts`**
  — `buildAgentMemory(pluginManager, cwd, defaultCtx)` builds the
  `agent.memory.{write,recall,delete}` direct API. Lazy initialize
  (EC-I, fires once on first call). Multi-adapter fan-out for writes;
  merge + dedupe by content for recalls.
- **`packages/sdk/src/types/agent.ts`** — extends `AgentOptions` with
  `memoryContext` + `maxRecallContextBytes`; `SDKAgent` interface with
  `memory: AgentMemory`. `SendOptions.signal: AbortSignal` for EC-H.

### New workspace packages

- **`@theokit/memory-supermemory@0.1.0`** — Supermemory wrapper
  (`supermemory@^4.21`, zero-dep MIT). EC-C identifier sanitization
  on every containerTag component.
- **`@theokit/memory-honcho@0.1.0`** — Honcho wrapper
  (`@honcho-ai/sdk@^2.1`). EC-D session namespaced under userId to
  prevent cross-user leak. AGPL self-host disclosure in README.
- **`@theokit/memory-mem0@0.1.0`** — Mem0 cloud-only wrapper (D148:
  no OSS local mode). Unique `history(id)` capability. Circuit
  breaker (EC-K: 429 does NOT trip). CVSS 8.1 disclosure in README.

### Test counts

- 1032 → **1062 PASS** baseline + 9 new memory-adapter tests in SDK
  (memory-adapter contract + aggregation + dispatch + direct API).
- Adapter packages: Supermemory 21/21, Honcho 17/17, Mem0 18/18 =
  **56 adapter-package tests**.
- 9 new ADRs (D141-D149).
- 3 real-LLM examples (`examples/memory-*-basic`).
- CLAUDE.md SDK Roadmap row #3 (Memory Providers, score 7) → ✅ DONE.

---

### Added (v1.11 batch-processing — ADRs D134-D140)

- **`Agent.batch(prompts, options)`** — new static method on the `Agent`
  façade. Runs N prompts in parallel with bounded concurrency, isolated
  per-prompt failures, optional `onResult` / `onProgress` callbacks, and
  `AbortSignal` support. Default concurrency 4 (D136); capped to
  `prompts.length` to avoid idle workers.
- **`packages/sdk/src/batch.ts`** — `batchImpl(prompts, options, deps)`
  core. Builds shared `CredentialPool` instances ONCE from
  `options.providers.apiKeys` and wraps the entire batch in
  `withCredentialPool(pools, ...)` (ALS) so every in-flight agent
  observes the SAME pool — one 429 cools the key down once, not N
  times (EC-A fix, D138).
- **`packages/sdk/src/types/batch.ts`** — public types: `BatchItem`,
  `BatchOptions extends AgentOptions`, `BatchResult` (discriminated
  union by `ok`), `BatchProgress`. Re-exported from `types/index.ts`.
- **`packages/sdk/src/trajectory-helpers.ts` + `types/trajectory.ts`** —
  opt-in `toShareGptTrajectory(result, options?)` helper for fine-tuning
  dataset generation (D139). Pure transformation; returns `null` for
  failed results so callers can `.map(...).filter(Boolean)`.
- **`packages/sdk/src/internal/runtime/async-semaphore.ts`** — in-house
  N-permit FIFO semaphore (~50 LoC). No `p-limit` / `p-queue` dependency
  added (D135). `createSemaphore(permits)` throws `ConfigurationError`
  on zero / negative / non-integer.
- **Router wiring** (`internal/llm/router.ts`) — `buildClient` now
  consults `currentCredentialPool(name)` (ALS) before building a fresh
  pool from `routerOptions.apiKeys`. Backward compatible: outside an
  ALS scope, the existing per-agent pool path is unchanged.

### Tests added

- `tests/batch.test.ts` — 18 RED → GREEN (empty, parallel, concurrency,
  failure isolation, order preservation, callbacks, abort, EC-A pool
  reference, EC-C pre-aborted, EC-D `signal.reason`, EC-B slow
  `onResult` parallel timing).
- `tests/batch.property.test.ts` — 5 fast-check properties × 200 runs
  each (1000+ randomized assertions): input order under random delays,
  no prompt loss, failure isolation, filter discipline, bounded
  concurrency.
- `tests/agent-batch-wiring.test.ts` — 3 façade integration tests
  (Agent.batch exists, empty array, BatchItem metadata round-trip).
- `tests/integration/batch-with-pool.test.ts` — 3 integration scenarios
  with 2-key pool + concurrency=2.
- `tests/trajectory-helpers.test.ts` — 14 tests (EC-11..EC-14, EC-F
  malformed messages, tool_use → tool_calls, completed=true).
- `tests/internal/runtime/async-semaphore.test.ts` + `.property.test.ts`
  — 9 unit + 3 properties × 200 runs (FIFO, peak in-flight bounded,
  release idempotent).

### Test counts

- 1021 → **1032 PASS** baseline + batch surface in 7 new test files
  (55 new tests + 1600 randomized fast-check assertions).
- 7 new ADRs (D134-D140).
- CLAUDE.md SDK Roadmap row #2 (Batch Processing, score 8) → ✅ DONE.

---

### Added (v1.10 credential-pools — ADRs D123-D133)

- **`internal/llm/credential-pool.ts`** — same-provider key rotation primitive
  (CredentialPool class, 4 strategies: fill_first/round_robin/least_used/random,
  ADRs D123-D124, D128).
- **`internal/llm/credential-pool-types.ts`** — `PooledCredential`,
  `CredentialPoolSnapshot`, `CredentialPoolStrategy`, cooldown ladder constants
  (D125).
- **`internal/llm/credential-pool-context.ts`** — `withCredentialPool` /
  `currentCredentialPool` AsyncLocalStorage scope for fork inheritance (D131).
- **`internal/llm/pool-aware-client.ts`** — composition wrapper over `LlmClient`
  (D127) with retry-then-rotate on 429 (D126), immediate rotate on 402/401,
  propagate on 5xx/NetworkError. EC-A: persistence failures during rotate
  degrade to in-memory; do not abort the stream. EC-D: buildClient errors
  propagate without marking pool entry exhausted.
- **`internal/persistence/credential-pool-store.ts`** — JSON persistence
  (`$THEOKIT_HOME/credential-pool.json`) with D62 versioned envelope, D61
  cross-process file lock, lazy load + 200 ms debounced write (D129).
- **`errors.ts`** — new public `CredentialPoolExhaustedError` (D133).
- **`types/providers.ts`** — extends `ProviderRoutingSettings` with optional
  `apiKeys: Record<string, string[]>` + `credentialPoolStrategy:
Record<string, CredentialPoolStrategy>` (D130).
- **Router wiring** (`internal/llm/router.ts`) — `buildClient` branches on
  pool presence: ≥2 effective keys → wrap in `PoolAwareLlmClient`; 0/1 → existing
  single-key fast path (D132 backward compat). EC-B: warn once per unknown
  provider in apiKeys config. Empty strings filtered.
- **`validate-agent-options.ts`** — EC-J ambiguity check: `apiKey` +
  `apiKeys[provider]` together throws `ConfigurationError(code:
"credential_pool_ambiguous")` with an educative message.

### CI gates

- **`tests/lint/no-unredacted-pool-token.test.ts`** — bans `.accessToken`
  outside the credential-pool module (and the MCP OAuth allowlist).
- **`tests/internal/llm/credential-pool.property.test.ts`** — 5 strategy
  invariants × 200 fast-check runs = 1000+ randomized assertions.

### Test counts

- 960 → **970 PASS** (+10 new wire tests). With property + lint + integration:
  total Phase 5 footprint adds ~55 tests.
- 11 new ADRs (D123-D133).
- CLAUDE.md SDK Roadmap row #1 (Credential Pools, score 9) → ✅ DONE.

---

### Added (v1.9 background-work-block-completion — ADRs D110-D122)

- **`internal/runtime/async-local-storage.ts`** — per-fork tool whitelist
  via `AsyncLocalStorage<Set<string>>` (ADR D111). Public helpers:
  `withToolWhitelist(set, fn)`, `currentToolWhitelist()`,
  `checkToolWhitelist(toolName)`. Parallel forks observe their own
  whitelist; nested `withToolWhitelist` shadows the outer set (EC-F).
- **`internal/runtime/fork-agent.ts`** — fork primitive (ADRs D110-D114):
  - `forkAgentImpl(parent, options, deps)` — inherits parent system
    prompt byte-identical (D112 — cache hit), credentials, model;
    overrides `agentId`, `skills`, `metadata.forkOrigin`
  - `filterMemoryPlugins(unknown)` — EC-B fix: preserves
    `kind: "memory"` plugins so fork can write memory with provenance;
    drops general/model-provider (redundant per-fork re-init)
  - `LocalAgent.fork(options)` shorthand instance method
- **`internal/judge/`** — judge primitives (ADRs D119-D121):
  - `types.ts` — `Verdict` enum (`done | continue | skipped`),
    `JudgeResult` interface
  - `parse-verdict.ts` — pure prefix matcher with fail-safe `continue`
    (ADR D121). Strict case-sensitive; documents EC-E (BOM trimmed,
    U+200B not)
  - `judge-call.ts` — `judgeCallImpl(ctx, opts, deps)` instantiates aux
    agent (default `openai/gpt-4o-mini` via `OPENROUTER_API_KEY`,
    `tools: []`, EC-A single-env-source); always disposes; folds errors
    into fail-safe `JudgeResult`
  - `verify-side-effect.ts` — `verifyClaim<T>(claims, oracle)`
    hallucination-gate helper, generic over claim type
- **`types/goal-events.ts`** — `GoalEvent` discriminated union (5
  variants, ADR D115), `GoalResult` return value, `GoalOptions`
  configuration (ADRs D117 AbortSignal, D119 judge model defaults).
- **`internal/runtime/run-until.ts`** — Ralph loop (ADR D116
  `AsyncGenerator<GoalEvent, GoalResult, void>`):
  - Yields `status_change: active` + per-turn events + final
    `status_change: completed | failed | paused`
  - EC-C: pre-aborted signal yields only `[paused]` (no preceding
    `active`)
  - EC-D: `maxTurns: 0` is supported (vacuous active → failed)
  - Counts consecutive judge parse failures; bails at
    `maxConsecutiveJudgeFailures` (default 3)
  - `LocalAgent.runUntil(goal, options)` instance method
- **Public API** — `GoalEvent`, `GoalResult`, `GoalOptions`, `Plugin`
  `kind: "memory"` Extract, re-exported via `packages/sdk/src/index.ts`.
- **`AgentOptions.metadata?: Record<string, unknown>`** — new optional
  field, used by fork (`metadata.forkOrigin` / `metadata.parentAgentId`)
  and judge (`metadata.forkOrigin: "judge"`) for downstream attribution.

### Changed (background-work-block-completion)

- `internal/agent-loop/tool-dispatch.ts:dispatchSingleCall` — whitelist
  gate fires FIRST (before plugin pre_tool_call hook and file hooks).
  A tool not in the fork's `allowedTools` returns a `tool_result` with
  `"Tool blocked by fork whitelist"` content; agent narrative continues
  unimpeded. Cost: one import + one branch (microseconds per call).
- `types/run.ts:RunOperation` — gains `"runUntil"` and `"fork"` so
  `UnsupportedRunOperationError` on CloudAgent for these surfaces
  satisfies type narrowing (ADR D122).
- `CloudAgent.runUntil()` / `CloudAgent.fork()` — throw synchronously
  with explicit messaging; documented as EC-G (sync throw despite
  AsyncGenerator return type).

### CI gates

- **`tests/lint/no-global-tool-whitelist.test.ts`** — regex grep
  test enforcing AsyncLocalStorage as the only path for per-fork
  whitelist; bans `let _toolWhitelist`-style declarations.
- **`tests/internal/judge/parse-verdict.property.test.ts`** —
  4 properties × 200 fast-check runs = 800 randomized invariant
  assertions.
- **`tests/internal/runtime/async-local-storage.property.test.ts`** —
  200 fast-check runs verifying parallel-fork whitelist isolation.

### Edge-case review (referenced from `.claude/knowledge-base/plans/background-work-block-completion-plan.md` v1.1)

- **EC-A (MUST FIX)**: judge defaults to `OPENROUTER_API_KEY` (single
  source). No multi-provider auto-detect — caller passes
  `judgeApiKey` for Anthropic-only or direct-OpenAI envs.
- **EC-B (MUST FIX)**: `filterMemoryPlugins` preserves memory plugins
  in fork; drops other kinds.
- **EC-C (SHOULD TEST)**: pre-aborted signal yields paused only.
- **EC-D (SHOULD TEST)**: `maxTurns: 0` test covered.
- **EC-E (SHOULD TEST)**: parseVerdict + BOM/ZWSP edge documented.
- **EC-F (SHOULD TEST)**: nested `withToolWhitelist` shadow test.
- **EC-G/H/I/J (DOCUMENT)**: cloud sync throw, whitelist case
  sensitivity, mid-iteration dispose, judge whitelist inheritance.

### Test counts

- 853 → 911 (+58 new tests; 1000+ fast-check runs).
- 13 new ADRs (D110-D122).
- Background work block: **3/3 ✅**. SDK roadmap totals: **19 → 22 (96%)** DONE.

---

### Added (v1.8 plugin-extension-block-completion — ADRs D97-D109)

- **`internal/plugins/`** — full Plugin contract (ADRs D97-D101):
  - `types.ts` — `Plugin` discriminated union (`general`/`model-provider`/`memory`),
    `PluginContext`, `HookName` (8 fixed hooks), `definePlugin` helper
  - `context.ts` — `createPluginContext()` with dev-mode Proxy seal (D99) +
    `ctx.on()` defense-in-depth against non-function handlers (EC-2)
  - `manager.ts` — `PluginManager` with `initialize` (once), dispatch by
    kind, `runPreToolCallHooks` (first-block-wins, D101); EC-4 duplicate
    plugin name surfaces stderr warn
  - `lifecycle.ts` — `runFireAndForgetHooks` + `runTransformHooks` (EC-6:
    null replaces; undefined keeps current)
- **`internal/tool-registry/`** — 3-layer tool surface (ADRs D102-D104):
  - `registry.ts` — `ToolRegistry` central + `ToolEntry` (with checkFn,
    requiresEnv, emoji, maxResultSizeChars)
  - `toolset.ts` — flat-list `Toolset` + `resolveToolset`/`resolveToolsetStrict`
    (EC-7: duplicates kept, caller dedups)
  - `check-fn-cache.ts` — 30s TTL per tool name + `requiresEnv` check
    (EC-8: concurrent Promise.all idempotent)
  - `result-cap.ts` — `applyResultCap` (default 100k chars)
- **`internal/providers/`** — provider-as-plugin (ADRs D105-D107):
  - `types.ts` — `ProviderProfile` data-only (D105), `ApiMode` literal union
  - `registry.ts` — `registerProvider`/`getProviderProfile`/`listProviders`
    - EC-5 alias collision warn
  - `builtin/{anthropic,openai,openrouter,gemini}.ts` — 4 profiles
    migrated from hardcoded switch
  - `discovery.ts` — lazy scan of `~/.theokit/plugins/model-providers/`
    via `pathToFileURL` (EC-9 Node 22 ESM support)
- **Public API** — `Plugin`, `PluginContext`, `HookName`, `definePlugin`,
  `ProviderProfile` re-exported via `packages/sdk/src/index.ts`.

### Changed (plugin-extension-block-completion)

- `internal/llm/router.ts:buildClient` — consults `getProviderProfile`
  - `selectTransport(apiMode)` instead of hardcoded switch (T4.3).
    EC-3: unsupported apiMode throws `transport_unavailable` with
    actionable message. EC-10: `envVars` ordered fallback (OPENROUTER_API_KEY
    then OPENAI_API_KEY for OpenRouter).
- `LocalAgent.initialize` — wires `pluginManagerCode.initialize(codePlugins)`
  via `extractCodePlugins` filter (EC-1 discriminates legacy `{ enabled }`
  metadata from new `Plugin[]`); telegram-pro + 7 examples continue to
  compile + run unchanged (D108).
- `agent-loop/tool-dispatch.ts` — invokes plugin `pre_tool_call` hooks
  BEFORE file-based hooks (T4.2). Author intent (code plugin) wins
  early over operator policy (file hooks).
- `real-local-run.ts` — `buildCustomToolsInput` concatenates plugin tools
  onto the effective tool catalog without replacing user-supplied tools.

### Fixed (plugin-extension-block-completion)

- Closes Plugin & extension block of the SDK Patterns Roadmap:
  `plugin-contract-design` (❌ → ✅), `tool-registry-pattern` (⚠️ → ✅),
  `provider-as-plugin` (❌ → ✅). Roadmap totais 16 → 19 (83%) DONE.
- Adding a new provider now requires zero code changes in `packages/sdk/`
  — publish `@theokit-provider-X` with a `ProviderProfile` and drop in
  `~/.theokit/plugins/model-providers/X/index.mjs`.

### Added (v1.7 agent-core-loop-completion — ADRs D86-D96)

- **`internal/tool-dispatch/repair-middleware.ts`** — `repairToolCall`
  applies 3 idempotent repairs (case-insensitive name match,
  JSON-string-args parse, type coercion against schema). Fixes 10+
  provider-specific failure modes catalogued in `sdk-references/
tool-call-failure-recovery.md` (Hermes v0.2 #444, v0.3 #1300,
  v0.8 #5265, etc.).
- **`internal/tool-dispatch/strip-think.ts`** — `stripThinkBlocks`
  removes `<think>...</think>` chain-of-thought from LLM responses
  BEFORE they enter the message history. Prevents prompt-cache
  invalidation with DeepSeek-R1, Qwen-QwQ providers (Hermes v0.2 #174).
- **`internal/tool-dispatch/dispatch.ts`** — `dispatchToolWithRepair`
  validate-then-execute wrapper. NEVER throws; all errors return as
  `DispatchResult { isError: true }` so the LLM can self-correct
  (ADR D89).
- **`internal/runtime/budget.ts`** — `IterationBudget` class with
  iteration cap + compression cap (default 3) + grace-call semantics.
  Closes the 4 compression death spirals Hermes shipped (v0.4 #1723,
  v0.7 #4750, v0.11 #10065, v0.11 #10472). EC-4: NaN-safe `consume`.
- **`internal/runtime/validate-response.ts`** — detects empty-content +
  zero-toolCalls as a model-bailout signal.
- **`internal/runtime/compression-helpers.ts`** — `selectCompressionWindow`
  (preserve recent N) + `assertCompressionReduced` (≥10% floor, ADR D92).
- **`internal/cache-discipline-guard.ts`** — dev-mode warns when system
  prompt / toolset / history mutates mid-conversation. Zero production
  overhead via `shouldGuard()` function (EC-1: not module-init constant).
- **`Agent.invalidateCache(reason, options?)`** public API (ADR D94).
  Default deferred — applied at next `agent.send()`. `{ applyNow: true }`
  disposes immediately.
- **CI lint gate** `tests/lint/no-history-mutation-outside-loop.test.ts`
  (ADR D85 mirror) — prevents `ctx.messages.push` outside `agent-loop/`.
  EC-8: bounded by contextual prefix to avoid false positives.
- **Adversarial property tests** via fast-check (1400+ random inputs):
  - `repair-middleware.property.test.ts` (4 properties × 200 runs)
  - `budget.property.test.ts` (3 properties × 200 runs)
- **`internal/agent-loop/strip-think-wiring.test.ts`** — integration
  test with mock LLM client validating strip-think wiring end-to-end
  (T7.2 / EC-2 fix).

### Changed (agent-core-loop-completion)

- `agent-loop/loop.ts` uses `IterationBudget` instead of a bare counter
  (T4.2, ADRs D90-D91). Grace call permits one final iteration after
  budget exhausted.
- `agent-loop/loop.ts` strips `<think>` blocks via `stripThinkBlocks`
  in `streamLlmTurn` before text returned (T4.1, ADR D96).
- `agent-loop/tool-dispatch.ts` applies `repairToolCall` before the
  registry lookup (T4.1, ADRs D86-D88). Repairs surface via telemetry
  span attribute `tool.repairs`.
- `LocalAgent` consumes pending invalidation at the start of every
  `sendLocked` via `consumePendingInvalidation()`. EC-7: failure path
  clears pending state so refresh doesn't get stuck retrying.

### Fixed (agent-core-loop-completion)

- Closes Agent core loop block of the SDK Patterns Roadmap:
  `prompt-cache-discipline` (📚 → ✅), `tool-call-failure-recovery`
  (❌ → ✅), `compression-death-spiral` (❌ → ✅). Roadmap totals
  13 → 15 (65%) DONE.

### Added (v1.6 security-block-completion — ADRs D79-D85)

- **`internal/security/path-guard.ts`** is the canonical module for
  path defense (ADR D79). Exports `safePathJoin` (resolve-then-check,
  ADR D80), `assertNoSymlinkEscape` (realpath-based chain resolution),
  `sanitizeIdentifier` (strict grammar `^[a-z0-9][a-z0-9-_]*$`, ADR D81),
  and `PathTraversalError extends ConfigurationError` with code
  `path_traversal` (ADR D65 — no new error hierarchy).
- **`internal/persistence/exclusive-create.ts`** exports `createExclusive`
  using O_EXCL semantics (ADR D82). Default mode `0o600` (owner-only) —
  EC-2 fix prevents world-readable token/lock files under typical
  umask 022.
- **`internal/persistence/sqlite-cas.ts`** exports `casUpdate` for
  optimistic concurrency in SQLite-backed stores (ADR D83). Canonical
  `UPDATE ... WHERE version = ?` pattern from Hermes `kanban_db.py`.
- **CI lint gate** `tests/lint/no-unguarded-path-input.test.ts`
  (ADR D85) prevents regression by flagging any new
  `join(cwd, ".theokit", ..., varName)` callsite that doesn't use
  `safePathJoin` or `sanitizeIdentifier`.
- **Adversarial property tests** for `safePathJoin` + `sanitizeIdentifier`
  via `fast-check` (~1200 random inputs across 6 properties).

### Changed (security-block-completion)

- `plugins-manager.assertEntryFileExists` now uses canonical
  `safePathJoin` (replaces inline T3.2 guard from
  markdown-config-migration). Error code `plugin_entry_escape` →
  `path_traversal`.
- `agent-session-store.sessionFilePath` validates `agentId` via
  `sanitizeIdentifier` (maxLen 128) + `safePathJoin`. Local
  `agent-<uuid>`, cloud `bc-<uuid>`, and bot IDs like
  `tg-dogfood-chat-A` pass natively.
- `skills-manager.refresh` wraps `entry.name` joins with
  `safePathJoin` + `assertNoSymlinkEscape` (defense-in-depth against
  hostile symlinks inside `.theokit/skills/`).
- `legacyMemoryJsonPath` (memory/types.ts) sanitizes `namespace`,
  `scope`, `userId` before joining. `storePath` (programmatic) bypasses
  sanitization (trusted).
- `mcp/client.ts` resolves stdio MCP `cwd` field via `safePathJoin`
  for relative paths; absolute paths trusted.

### Fixed (security-block-completion)

- Closes the Security block of the SDK Patterns Roadmap:
  `path-traversal-vectors` (❌ PENDING → ✅ DONE) and
  `toctou-race-prevention` (⚠️ PARTIAL → ✅ DONE). Roadmap totals
  11 → 13 DONE (57%).

### Added (v1.5 markdown-config-migration — ADRs D74-D78)

- **`.theokit/hooks/<name>.md`** is the new canonical format for hooks
  (ADR D74). One file per hook with YAML frontmatter (event, matcher,
  command, enabled, priority, timeoutMs) + optional markdown body for
  rationale prose. Mirrors `skills/<name>/SKILL.md`.
- **`.theokit/context/<name>.md`** is the new canonical format for
  context sources (frontmatter: name, path, enabled, maxTokens).
- **`.theokit/plugins/<name>/PLUGIN.md`** replaces `plugin.json` per
  plugin (frontmatter: name, version, capabilities, entry).
- **Zod schemas** type each frontmatter category (HookFrontmatter,
  ContextSourceFrontmatter, PluginFrontmatter — ADR D76). Schema
  errors surface as `ConfigurationError` with typed codes
  (`hook_frontmatter_invalid`, etc.), same pattern as D10
  SkillFrontmatter.
- **Path-traversal guard** on plugin `entry` (T3.2, EC-1 MUST FIX
  from edge-case review): rejects `..` segments and absolute paths
  with `plugin_entry_escape` code. Closes a latent security gap that
  predated the markdown migration.
- **`theokit-migrate-config` CLI** in `packages/sdk/bin/` (ADR D78,
  espelha D44 `theokit-migrate-memory`). Converts legacy JSON to MD
  with timestamped `.bak` backups, atomic writes per file, pre-flight
  abort on existing MD destination.
- **`atomicWriteText` helper** in `internal/persistence/atomic-write.ts`
  (T4.1, EC-2 MUST FIX). Same `tmpfile + rename` crash-safety as
  `atomicWriteJson`, with auto-mkdir of parent dir.

### Changed (markdown-config-migration)

- **`parseSimpleYaml` return type widened** to
  `Record<string, string | number | boolean | string[] | undefined>`.
  Empty values now coerce to `undefined` so Zod `.optional().default(...)`
  applies correctly (EC-3 fix). Skills and subagents loaders adapted
  with narrow helpers (zero behavior change in their schemas).
- **`HooksExecutor.initialize` + `loadProjectHooks`** delegate to new
  shared `loadHookConfig(cwd)` in `internal/runtime/hooks-source.ts`.
  Tries `.theokit/hooks/` first; falls back to `hooks.json` with
  one-time stderr deprecation warn (ADR D77).
- **`FileContextManager.refresh`** uses the same MD-first chain. Same
  fallback + warn semantics.
- **`PluginsManager.refresh`** detects `PLUGIN.md` per folder before
  `plugin.json`. Warns on the JSON path; warns on conflict
  ("both files detected — using markdown").
- **`telegram-pro` example** migrated: `.theokit/hooks/shell-policy.md`
  - `.theokit/context/bot-readme.md` replace the legacy JSONs.
    `workspace-seeds.ts` writes the MD files (idempotent via `ensureFile`).
    The seed-only `plugins.json` (never consumed by the SDK) was removed.

### Deprecated (markdown-config-migration)

- `.theokit/hooks.json`, `.theokit/context.json`,
  `.theokit/plugins/<name>/plugin.json` — emit a one-time stderr warn
  on each call to the loader. **Deprecated in v1.5 (warn). Removed in
  v2.0 (planned Q2 2027)** — users must migrate via
  `theokit-migrate-config` before v2.0 ships.

### Added (v1.3 secret-redaction-discipline — Security block 1/2 patterns)

- **`Security` public namespace** (ADR D68). New top-level export `Security.addPattern(re: RegExp)` registers custom redaction patterns for org-internal token shapes. Additive — built-in patterns cannot be removed. Throws if `/g` flag is missing.
- **Canonical secret redactor** in `internal/security/redact.ts` (ADR D68/D71). 12 builtin credential patterns (OpenAI/Anthropic `sk-*`, GitHub PAT classic + fine-grained, GitLab, AWS `AKIA`, Google `AIza`, Slack `xox*-`, Sentry `sntrys_`, Stripe `sk_live_` / `rk_live_`) plus parametric `key=value` matcher (Authorization Bearer, access_token, api_key, password, x-api-key) plus dedicated Bearer pattern. Two-bucket masking: short tokens (<18 chars) → `***`; longer → `prefix...suffix` for debuggability.
- **Env opt-out: `THEOKIT_REDACT_SECRETS`** (ADR D69/D70). Default ON. Set to `"false"`/`"0"`/`"no"`/`"off"` to disable; SDK emits one-time stderr warning. Env var snapshotted at module init — runtime mutation (e.g., prompt injection) cannot disable mid-process.
- **Wired at output boundaries** (ADR D73):
  - `internal/errors/mappers/shared.ts:truncateRaw` redacts `ErrorMetadata.raw` before exposure. Closes the vector created by v1.3 error-context-surfacing where 2KB of raw provider response body could echo `Authorization: Bearer sk-...` headers.
  - `internal/telemetry/tracer.ts` wraps `setAttribute`/`setAttributes`/`addEvent`/`startSpan` to redact string values before they reach Langfuse / Sentry / PostHog exporters.
  - `internal/runtime/agent-session-store.ts:appendToSessionFile` redacts JSON.stringify(record) before appendFile to the transcript JSONL.
  - `internal/memory/migrate-sqlite-to-lance.ts` wraps the migration logger so any fact text containing secrets is masked at the egress.
- **CI gate against new unredacted sinks** — `tests/lint/no-unredacted-sink.test.ts` greps `src/` for new `console.log`/`appendFile`/`writeFile`/`span.setAttribute` callsites that bypass `redactSecrets`, fails the test run if any land without joining the whitelist (with rationale).
- **Adversarial property tests** via `fast-check` — 12 builtin patterns × 200 runs + PARAM_PATTERN × 200 + BEARER × 200 + 4 sink adversarial tests × 50-100 runs each = ~3000 randomized inputs proving zero leak.

### Changed (secret-redaction-discipline)

- **`ErrorMetadata.raw` shape**: pre-T1.1 the field returned the original `body` object when ≤2KB; post-T1.1 it always returns a (possibly redacted) string because the redactor coerces non-strings via `JSON.stringify`. A workspace-wide grep at land time confirmed zero callers of `err.metadata.raw.someKey`. Consumers that need the parsed shape must `JSON.parse(err.metadata.raw)`.
- **`redactSecrets` consolidated**: the two duplicate impls in `internal/memory/types.ts` (3 patterns) and `internal/runtime/fixture-responder.ts` (5 patterns) are gone — both now route through the canonical module. The fixture sentinel `fixture-search-secret` is replaced locally in `redactEventSecrets` (NOT via `addPattern`) to avoid being cleared by the vitest `beforeEach` reset hook.
- **`vitest.setup.ts`** also resets `_extraPatterns` and re-enables redaction between tests (ADR D60 + secret-redaction EC-3) to prevent test bleed across files.

### Added (v1.3 error-context-surfacing — Error handling block 1/2 patterns)

- **`ErrorMetadata` + `ErrorCode` types exposed from `errors.ts`** (ADR D65/D66). New optional `metadata` field on `TheokitAgentError` and subclasses carries `{ provider, endpoint, code, statusCode?, retryAfter?, raw? }` when the error originates from a provider HTTP call. `ErrorCode` is a finite literal union (`"rate_limit" | "auth_failed" | "invalid_request" | "timeout" | "server_error" | "context_too_long" | "content_filtered" | "model_unavailable" | "network" | "unknown"`) enabling exhaustive `switch` checks at consumer code.
- **Provider error mappers** (ADR D67):
  - `mapAnthropicError({ status, body, headers, endpoint })` — translates raw Anthropic API HTTP errors into typed `TheokitAgentError` subclasses with full metadata. Handles 401/403/429/400/408/5xx with detail mapping (e.g., 400 with context-length signal → `context_too_long` code; 529 overloaded_error → `server_error` with retryAfter).
  - `mapOpenAICompatibleError({ providerId, status, body, headers, endpoint })` — same shape for OpenAI-compatible dialects (OpenAI, OpenRouter, DeepSeek, Together, Mistral, DeepInfra, Voyage). Inspects `body.error.code` / `body.error.type` for fine-grained mapping; gracefully falls back to status-based code when body doesn't follow the OpenAI shape (EC-3).
  - Both mappers truncate raw body to ~2KB in `metadata.raw` to avoid log bloat.
  - Both ignore HTTP-date format `retry-after` headers (EC-5) — only numeric-seconds form populates `metadata.retryAfter`.
- **Wired in call sites**:
  - `internal/llm/anthropic.ts` — `/v1/messages` HTTP errors go through `mapAnthropicError`.
  - `internal/llm/openai.ts` — `/v1/chat/completions` HTTP errors go through `mapOpenAICompatibleError`.
  - `internal/memory/adapters/openai-compatible.ts` — `/v1/embeddings` HTTP errors go through `mapOpenAICompatibleError`; legacy `mapErrorStatus` deleted.
  - `internal/llm/fallback-client.ts` — fallback decision now considers `AuthenticationError` and `RateLimitError` (not just `NetworkError`), so 401 / 429 from one provider triggers fallback to the next (EC-1 fix).

### Changed

- **Refined subclass selection on HTTP errors** (breaking change for callers asserting on specific subclasses). Previously every non-OK HTTP response from Anthropic/OpenAI/OpenRouter/embedding adapters threw a `NetworkError` (or a coarse mapping). Now:

  - `401` / `403` → `AuthenticationError`
  - `429` → `RateLimitError`
  - `400` → `ConfigurationError` (with `code: "context_too_long" | "content_filtered" | "model_unavailable" | "invalid_request"` depending on body inspection)
  - `408` → `NetworkError` (`code: "timeout"`)
  - `5xx` → `NetworkError` (`code: "server_error"` — covers Anthropic 529 overloaded_error)
  - Other → `UnknownAgentError`

  Callers using `instanceof TheokitAgentError` (the base class) are unaffected. Callers using subclass-specific `instanceof` may need to broaden (e.g., switch from `instanceof NetworkError` to `instanceof TheokitAgentError`) or handle the additional subclasses. **Affected internal tests updated**: `tests/golden/llm/anthropic-client.golden.test.ts` (401 now asserts `AuthenticationError`), `tests/golden/memory/openai-embedding.golden.test.ts` (400 now asserts `ConfigurationError`).

### Added (v1.3 persistence & state hardening — 6 patterns from sdk-references)

- **`internal/persistence/` shared primitives directory** (ADR D59). Cross-cutting state helpers consolidated in one place; `internal/memory/atomic-write.ts` and `internal/memory/cwd-mutex.ts` kept as backward-compatible re-export shims.
- **`getTheokitHome(cwd)` + `getProfilesRoot()` + `displayTheokitHome(cwd)`** (ADR D60). Canonical path resolver. Honors `THEOKIT_HOME` env override when set (test isolation, profile switching, multi-tenant deployments); defaults to `<cwd>/.theokit`. Profile root always anchored to `~/.theokit/profiles/` regardless of env.
- **`atomicWriteJson<T>(path, data, options?)` typed helper** with auto-mkdir of the parent directory (EC-4 fix). Sits on top of existing `replaceFileAtomic`. Migrated callers: `agent-registry-store`, `transcript-store`, `mcp/token-storage`.
- **`withFileLock<T>(path, fn, options?)` cross-process file-lock helper** (ADR D61). Uses `proper-lockfile` optional peer dep with a companion `<path>.lock` file and `realpath: false` so the target file does not need to exist yet (EC-1 fix). Falls back gracefully to in-process `withCwdMutex` (with one-shot stderr warning) when the peer dep is missing. Combines `withCwdMutex` + `proper-lockfile` for full in-process AND cross-process serialization.
- **`migrateSchema({ db, currentVersion, migrations })`** SQLite forward-only migration runner via `PRAGMA user_version` (ADR D62). Migrations run inside a transaction (atomic rollback on failure); downgrade attempts throw; gaps in the migration sequence are accepted (result.to reflects last applied version).
- **`readVersionedJson<T>(opts)` / `writeVersionedJson<T>(path, data, version)`** JSON envelope helpers with `_schemaVersion` field. The migrate callback receives the FULL parsed object (not just `.data`), so legacy shapes without the wrapper migrate correctly (EC-2 fix). Agent registry migrated from ad-hoc `SCHEMA_VERSION = "1.0"` to standard envelope; legacy-on-disk files are auto-migrated on next save.
- **`applyWalWithFallback(db, label)`** SQLite WAL mode helper with DELETE fallback for NFS/SMB/FUSE filesystems (ADR D63). Wired in `internal/memory/index-db.ts` for the memory index. Warns once per label on fallback.
- **`sanitizeFts5Query(query)` + `containsCjk(text)`** FTS5 query sanitization (ADR D64). 6-step port of Hermes' `_sanitize_fts5_query` — preserves quoted phrases, strips unmatched specials, collapses repeated asterisks, strips dangling boolean operators, auto-quotes hyphenated/dotted/underscored identifiers, restores phrases. Empty-after-sanitize is short-circuited at call sites (EC-3 fix) to avoid `MATCH ''` runtime errors. CJK detection deferred-routing helper for v1.4 trigram table.

### Added (test infrastructure)

- **Vitest hermetic test isolation** (`vitest.setup.ts`). Autouse `beforeEach` sets `THEOKIT_HOME` to a fresh tmpdir per test; `afterEach` cleans up + restores the original env value. Tests never touch the developer's real state.
- **Lint test `tests/lint/no-hardcoded-theokit-path.test.ts`** that audits `.theokit` literal usage in `src/` and gates regressions (current debt allowlisted; new code MUST use `getTheokitHome(cwd)`).
- **Integration E2E test** exercising the full persistence stack — env override → atomic-write → file-lock → schema migration → WAL → FTS5 sanitization — in a single hermetic test.

### Changed

- `agent-registry-store.ts` now reads/writes via `readVersionedJson` + `writeVersionedJson`. Legacy on-disk shape `{ schemaVersion: "1.0", agents: {...} }` is migrated transparently on next save to `{ _schemaVersion: 1, data: {...} }`.
- `index-manager.ts:ftsSearch` now uses `sanitizeFts5Query` (replacing the previous coarse per-token quoter) and short-circuits when the sanitized result is empty.
- `index-db.ts` calls `applyWalWithFallback` before applying schema; `MemoryDb` interface now exposes `pragma()`.
- `index-schema.ts` PRAGMA_STATEMENTS no longer includes `journal_mode=WAL` (now applied via the helper for graceful fallback).
- `transcript-store.ts` switched from non-atomic `writeFile` to `atomicWriteJson` (auto-mkdir + atomic rename).
- `mcp/token-storage.ts` switched from sync `writeFileSync` to async `atomicWriteJson` (still followed by `chmodSync(0o600)` for POSIX permission tightening).

### ADRs added

- D59 — `internal/persistence/` is the home for cross-cutting state primitives; memory/ re-exports preserved for backward compat
- D60 — `getTheokitHome(cwd)` returns `THEOKIT_HOME || join(cwd, ".theokit")` (single getter, env override optional)
- D61 — file-lock via `proper-lockfile` optional peer dep with companion lockfile + graceful in-process fallback
- D62 — schema versioning: SQLite `PRAGMA user_version` + JSON `_schemaVersion` envelope, forward-only migrations
- D63 — WAL primary, DELETE journal fallback on NFS/SMB; warn once per label
- D64 — FTS5 sanitizer 6-step + CJK auto-detection (trigram routing deferred to v1.4)

### Added (v1.2 features — paridade técnica com a peer vendor AI / a peer framework)

- **`Agent.streamObject<T>({ schema, prompt, ... })`** — typed structured output WITH partial-object streaming via synthetic forced tool (ADR D39). Returns `AsyncIterator<StreamObjectEvent<T>>` emitting zero or more `{ type: "partial", partial: DeepPartial<T>, attempt }` events plus exactly one `{ type: "complete", object: z.infer<T>, ... }` at the end. Reuses 80% of `generateObject` infrastructure. EC-4 (cancellation cleanup), EC-5 (refine/transform fallback), EC-6 (parallel tool-use dedup) covered by tests.
- **`@theokit/react` v1.2.0 — family of 3 hooks** (ADR D40): `useTheoChat` (multi-turn, existing) + `useTheoCompletion` (single-shot text gen, equivalent to a peer vendor `useCompletion`) + `useTheoAssistant<T>` (object-shaped streaming, wraps `Agent.streamObject`). Each hook has a matching server-side handler: `streamTheoChat`, `streamCompletion`, `streamAssistant`. Shared SSE parser in `internal/sse-parser.ts` handles all wire codes including new `o:`/`O:` for object streaming (ADR D45).
- **OAuth 2.1 PKCE for MCP HTTP servers** (ADR D41). `McpAuthConfig.oauth` opts into the flow. Two modes: `manual` (paste callback URL via stdin, SSH-friendly) and `localhost` (auto-spawned http.createServer on a free port). Token storage prefers OS keychain (`keytar`, optional peer dep) with `~/.theokit/mcp-tokens.json` (chmod 600) fallback. EC-2 (state CSRF validation), EC-9 (concurrent refresh serialization), EC-10 (default expires_in 3600s) covered.
- **Auto-instrumentation of telemetry vendors** (ADR D42). `tracer.ts` feature-detects `@langfuse/node` v3+, `@sentry/node`, and `posthog-node` via `createRequire`. When present + `telemetry.enabled: true`, registers OTel exporter automatically. Opt-out via `telemetry.autoDetect: false` OR `telemetry.disable: ["langfuse"]`. EC-12 (double-billing prevention) covered.
- **LanceDB backend for Memory.index** (ADR D43). `Memory.create({ index: { backend: "lance" } })` activates `@lancedb/lancedb` (optional peer dep). SQLite remains default. Lance scales to 100k+ facts. Filters use Lance's structured filter API — NO string interpolation, EC-1 MUST FIX. EC-8 (embedding dim mismatch) typed error.
- **Migration CLI `theokit-migrate-memory`** (ADR D44). Migrates Memory.index from SQLite to Lance preserving 100% of facts. Atomic commit via rename (`lance-new/` → `lance/`); SQLite preserved by default for rollback. EC-3 MUST FIX: validation uses NFC unicode normalization on both sides so facts with accents/emojis migrate correctly.

### Added (ADRs locked)

- D39 — `Agent.streamObject<T>` returns AsyncIterator with partial+complete events
- D40 — React hooks family: 3 separate hooks (useTheoChat / useTheoCompletion / useTheoAssistant)
- D41 — OAuth 2.1 PKCE for MCP HTTP + token storage with keychain fallback
- D42 — Auto-instrumentation via createRequire feature-detect
- D43 — LanceDB backend behind same IndexManager interface
- D44 — Migration SQLite → Lance is standalone CLI (theokit-migrate-memory)
- D45 — `SDKObjectDelta` variant + wire codes `o:`/`O:`
- D46 — Cross-agent shared memory deferred to v1.3 (threat-model own scope)

### Deferred

- **Cross-agent shared memory** (`MemoryOptions.scope: "global" | "team"`): postponed to v1.3 because the threat-model around write authorization across users requires its own ADR. Workaround in the meantime: `scope: "user"` with constant `userId` (e.g., `"team-shared"`).

### Added (v1.1 features)

- **`Agent.generateObject<T>({ schema, prompt })`** — typed structured output via synthetic forced tool (ADR D33). Returns `{ object: z.infer<T>, raw, usage, finishReason }`. Retry-on-parse-fail with `maxRetries` (default 1). Transient agent disposed AND hard-deleted from registry across retries (EC-3 no leak). Same provider routing/fallback as `agent.send`.
- **`AgentOptions.telemetry`** — opt-in OpenTelemetry spans for `agent.send`, `llm.call`, `tool.call` (ADR D34). Privacy-by-default: NO content logged unless `includeContent: true`. `@opentelemetry/api` is OPTIONAL peer dep loaded via `createRequire`. All OTel calls wrapped in `safe()` so exporter errors NEVER propagate to `agent.send` (EC-1).
- **`@theokit/react` v1.0.0** — new workspace package (ADR D32). `useTheoChat` React hook (HTTP fetch + SSE parser, AbortController on unmount, EC-6 5xx handling, EC-8 graceful close). `streamTheoChat` Next.js-compatible SSE handler (EC-2 pre-stream typed errors return HTTP 400/401). Wire format = a peer vendor AI Data Stream v1 (drop-in `useChat` migration; no `ai` package runtime dep). React peer dep `^18 || ^19`.

### Validations (v1.1 pillar audits)

- **Persistence chaos** — 20/20 random-timed SIGKILL recoveries, 0 registry corruptions (snapshot: `persistence-chaos-2026-05-17.md`).
- **MCP servers** — 4 distinct MCP servers operational across stdio+http (filesystem, mcp-http, tavily, puppeteer); snapshot: `mcp-audit-2026-05-17.md`.
- **Memory at scale** — 12 facts → 12 clusters via `text-embedding-3-small`, 100% Active Memory recall on 4 thematic queries (snapshot: `memory-scale-2026-05-17.md`).
- **Chat-bot DX portability** — N=2 examples using all 4 helpers: `telegram-pro` + new `cli-bot` (snapshot: `dx-chatbot-portability-cli-2026-05-17.md`).
- **Adversarial safety** — 8/8 validation/permission/state scenarios blocked; 0 crashed (snapshot: `safety-adversarial-2026-05-17.md`).

### Added

- Public `AgentOptions.tools` field for inline custom tools (#tools-inline). The SDK now exposes a `CustomTool` type — `{ name, description, inputSchema, handler }` — that consumers can pass at `Agent.create()` or `Agent.resume()`. Handlers are invoked locally when the model emits `tool_use`. Local runtime only; cloud agents throw `ConfigurationError(code: "cloud_custom_tools_rejected")` when `tools.length > 0`. Handlers are not persisted (allow-list strip in `stripSecretsFromOptions`) — re-pass on resume. Reserved-name collisions (`shell`, `memory_search`, `memory_get`, `mcp_*`) and duplicate names rejected at validation time.
- Per-call `SendOptions.tools` override (#tools-percall). `agent.send(msg, { tools: [...] })` fully replaces `AgentOptions.tools` for that run, matching the existing `mcpServers` semantics. `undefined` → fall back to agent-level tools; `[]` → explicit clear (no custom tools); `[t1, t2]` → exact replacement. Same validation rules apply per-call. Cloud agents reject per-call tools with the same `cloud_custom_tools_rejected` code.
- `Agent.getOrCreate(agentId, options)` static helper (ADR D22). Consolidates the resume-or-create dance into a single call: tries `Agent.resume` first; falls through to `Agent.create({ ...options, agentId })` on `UnknownAgentError`; retries `Agent.resume` once on same-process create race (`ConfigurationError(agent_id_already_exists)`). Re-throws every other error verbatim. Eliminates ~30 LoC of boilerplate from each of the 6 examples that previously hand-rolled the pattern.
- `createAgentFactory(common)` public function (ADR D23). Captures shared `AgentOptions` once and exposes `forSession(agentId, overrides?)` + `getOrCreate(agentId, overrides?)`. Top-level shallow merge with `overrides` winning; deep merge for `local`/`memory`/`cloud`; total replace for collection-shaped fields. The function-level `agentId` always wins. Designed for chat-bot patterns where most config is shared across users.
- `defineTool<T extends ZodType>(spec)` Zod-driven type-safe builder for `CustomTool` (ADR D24). Converts schema to JSON Schema via Zod 4's native `z.toJSONSchema` (with `unrepresentable: "any"` for transforms/refines). Wraps the handler with a runtime `schema.parse` step — handler receives `z.infer<T>` instead of `Record<string, unknown>`. Removes `as` casts in tool handlers. Zod is an OPTIONAL peer dependency — consumers who don't use `defineTool` don't pay any bundle cost.
- `Agent.builder()` fluent alternative to the options bag (ADR D25). Returns an `AgentBuilder` with chainable setters (one per top-level `AgentOptions` field) and three terminals: `.build()` (shallow-cloned snapshot), `.create()` (delegates to `Agent.create`), `.getOrCreate(agentId)` (delegates to `Agent.getOrCreate`). Validation runs inside the terminal — no duplicate rules.

## 1.0.0

### Major Changes

- v1.0.0 — General availability.

  This release closes the 14 gaps tracked in `.claude/knowledge-base/plans/sdk-v1-ga-completion-plan.md` and locks the architectural decisions in the ADR directory (`.claude/knowledge-base/adrs/D01-..D14-`).

  ### Highlights

  **Memory subsystem** (already in 0.x, now stabilized):

  - Markdown-first storage at `.theokit/memory/MEMORY.md` + `notes/*.md`
  - SQLite + FTS5 + sqlite-vec hybrid index
  - `memory_search` / `memory_get` tools
  - Active Memory with circuit breaker + LRU cache
  - Dreaming/REM consolidation with `dream-diary.md`

  **Embedding catalog** (ADR D11):

  - 5 fully-implemented providers: `openai`, `mistral`, `openrouter`, `voyage`, `deepinfra`
  - `lmstudio`, `google`, `bedrock` are deferred to v1.1 (ADRs in the SDK repo)

  **`OpenAiCompatibleConfig.embeddingsPath`** (EC-2 fix):

  - New optional config field on the shared embedding factory. REPLACES the default `/v1/embeddings` suffix; never concatenates. DeepInfra uses `/v1/openai/embeddings`.

  **Strict skills frontmatter** (ADR D10) — BREAKING:

  - `.theokit/skills/<name>/SKILL.md` now requires YAML frontmatter with `name` + `description`.
  - Malformed YAML or missing required fields exclude the skill from `agent.skills.list()` with a stderr warning. The agent run continues.
  - Migration: `grep -rL "^---$" .theokit/skills/*/SKILL.md` finds skills needing the frontmatter block.

  **`Symbol.asyncDispose` on `SDKAgent`** (ADR D5):

  - `await using agent = await Agent.create(...)` typechecks and runtime-works on both Local and Cloud runtimes.
  - `CloudAgent.dispose()` is now idempotent (EC-3); double-dispose runs the side-effect at most once.

  **Embedding adapter unknown-model rejection** (EC-4):

  - `createOpenAiCompatibleRuntime` throws `ConfigurationError(code: "embedding_unknown_model")` when the chosen model is not in the adapter's dimension table. Prevents downstream vec0 dimension mismatches.

  **Node 22.12+ mandatory** (ADR D1):

  - All gates (test, typecheck, biome, knip, validate, dogfood) run on Node 22.12+.
  - Pre-push hook gates Node version with a friendly remediation message (EC-1).
  - GitHub Actions CI matrix pins Node 22.12 + 22-latest.

  **`pnpm validate` strict on publint + attw** (ADR D6):

  - Either tool's failure blocks `pnpm validate` and CI. No warning-only mode.

  ### Default model id

  The default agentic model is `google/gemini-2.0-flash-exp:free` (OpenRouter free tier). Override per-agent with `model: { id: "..." }` or query `Theokit.models.list()` for the canonical PaaS catalog (ADR D4).

  ### Cloud runtime

  Pre-release. `Agent.getRun({ runtime: "cloud" })`, `agent.listArtifacts()`, `agent.downloadArtifact()` throw `ConfigurationError(code: "cloud_runtime_pre_release")` when invoked with non-fixture API keys. Fixture mode (`theo_test_*` keys) remains the documented test seam.

All notable changes to `@theokit/sdk` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added (multimodal demo `examples/telegram-pro`)

- **New `examples/telegram-pro/`** — ~600 LoC Telegram bot that reproduces the 5 highest-value patterns from peer-project's `extensions/telegram` (187 production files) on top of `@theokit/sdk` 1.0.0:
  - **Voice transcription** ([`src/transcribe.ts`](../../examples/telegram-pro/src/transcribe.ts)) — downloads the OGG/Opus from Telegram, POSTs multipart to Whisper. Provider order: `OPENAI_API_KEY` → `GROQ_API_KEY` → graceful "voice not configured" reply. Transcript is injected into the agent loop as `[voice transcript: ...]`.
  - **Vision** ([`src/vision.ts`](../../examples/telegram-pro/src/vision.ts)) — photo and sticker descriptions via `google/gemini-2.0-flash-001` multimodal on OpenRouter. Disk-cached at `.theokit/cache/vision/<sha256>.txt` keyed by Telegram's `file_unique_id`, so repeated stickers (common in groups) skip the LLM roundtrip.
  - **Inline buttons** ([`src/buttons.ts`](../../examples/telegram-pro/src/buttons.ts)) — agent emits `[BUTTONS: A | B | C]` at end of reply; example strips the marker, renders a grammy `InlineKeyboard`, and routes button taps back to the agent as `[user tapped button: A]` so conversation history stays consistent.
  - **Group `@mention` gating** ([`src/group-policy.ts`](../../examples/telegram-pro/src/group-policy.ts)) — `shouldRespondInChat(ctx, policy)` filter; private chats always pass; groups only when message text contains `@<botname>`, replies to the bot, or starts with `/`.
  - **Forum-topic scoping** ([`src/agent.ts`](../../examples/telegram-pro/src/agent.ts)) — per-`message_thread_id` agentId (`tg-pro-tpc-<chatId>-<threadId>`) so each topic in a supergroup gets its own isolated session JSONL. Memory namespace stays scoped to `userId` so facts follow the user across topics.
- **README walkthrough** — full BotFather setup including `/setprivacy → Disable` (so the bot sees all group messages, not just commands), per-pattern try-it examples, filesystem layout inspection, and an explicit "what this example does NOT cover" honesty note.
- **examples/README.md inventory** — `telegram-pro` listed at the top as the **Multimodal demo**, ahead of `telegram-assistant` (personal assistant) and `telegram-bot` (minimal reference).

### Added (chat assistant readiness — flagship demo `examples/telegram-assistant`)

- **New `examples/telegram-assistant/`** — ~300 LoC Personal Assistant Telegram bot built on `@theokit/sdk` 1.0.0. Demonstrates the full chat-assistant surface end-to-end against a real LLM:
  - **Commands**: `/start /help /me /remember /forget /recall /summary /reset` — covers explicit fact write, fact removal by substring, past-conversation search via `corpus="sessions"`, dreaming consolidation via `Memory.runDreamingSweep`, and conversation reset.
  - **Per-user isolation** — agent id = `tg-assistant-<userId>`, memory namespace pinned to `ctx.from.id` so group chats keep each member's facts separated (EC-11 documented).
  - **Allow-list** — optional `TELEGRAM_ALLOWED_USERS` env var locks the bot to specific Telegram user-ids so a randomly-discovered bot can't burn the operator's LLM budget.
  - **Format-aware replies** — Telegram MarkdownV2 escape + auto-split for responses > 4096 chars (`splitForTelegram` chooses paragraph/newline boundaries before hard-splitting at 4000 chars).
  - **Daily dreaming hook** — `runDream()` wraps `Memory.runDreamingSweep` and picks the embedding provider from available env keys (`OPENAI_API_KEY` → `MISTRAL_API_KEY` → `OPENROUTER_API_KEY`).
- **README walkthrough** — full BotFather token-acquisition flow (no prior Telegram knowledge needed), OpenRouter signup, `.env` template, restart-proof demo, file-system layout inspection, and a "what survives restart vs `/reset`" matrix.
- **examples/README.md inventory** — `telegram-assistant` listed as the **Flagship demo** at the top of the table; existing minimal `telegram-bot` reference kept intact.

### Fixed (chat assistant readiness — Phase 5 dogfood-driven bug)

- **Persistent-registry coalescing dropped second-mutation data.** Two synchronous `registerAgent` calls (e.g., create chat A then create chat B in quick succession) used to coalesce into ONE save whose snapshot only captured the agent that registered before the first microtask flushed. The second agent's full options were never persisted; on restart, `Agent.resume` cold-started a fresh agent with no model, no memory, no system prompt — the run then failed with `claude-sonnet-4-6 is not a valid model ID` because real-local-run's fallback model is not on OpenRouter. Caught in Phase 5 dogfood against real Gemini-flash.
- **Fix**: the save loop now uses a `dirtyCwds` Set. Every mutation marks the cwd dirty. The in-flight save's IIFE loops while dirty: clear flag, yield once to settle burst, snapshot, save. If a mutation arrives DURING the save's await, the loop runs again. Two registers within one microtask burst still coalesce to one save; mutations during the save no longer drop on the floor.
- **No regression** — 284/284 vitest suite green; Phase 0 golden tests (50 parallel `Agent.create` calls produce valid JSON) still pass with the new loop.

### Added (chat assistant readiness — Phase 5 / Dogfood QA)

- **`examples/telegram-bot/src/dogfood.ts` + `dogfood-restart.ts`** — automated end-to-end validation against a REAL LLM (OpenRouter gemini-2.0-flash-001), no Telegram token required:
  1. Two distinct chats (`tg-dogfood-chat-A`, `tg-dogfood-chat-B`) on the same workspace cwd, each says "Remember: ..." and asks a follow-up. **PASS** in-process recall.
  2. Inspect persisted state: registry.json + per-agent messages.jsonl + sessions corpus dir all exist on disk.
  3. **Real process restart** via `spawnSync("npx tsx ...", ...)` runs a fresh node process. The subprocess `Agent.resume`s both chats — pulling registry.json + messages.jsonl + MEMORY.md from disk. Both LLMs answer with the persisted facts ("Vitest + alpha-7", "PostgreSQL + project-beta") after the restart boundary. **PASS** post-restart recall.
  4. Concurrent burst: 5 parallel sends into one chat produce strictly-alternating user/assistant records (16 records total). **PASS** mutex serialization.
  5. Sessions corpus: 11+ `.md` summaries on disk after all runs. **PASS** corpus seeding.
- **Result**: 10 PASS / 0 WARN / 0 FAIL against real LLM. The chat assistant pattern works end-to-end with `@theokit/sdk` v1.0.0.

### Added (chat assistant readiness — Phase 4 / `examples/telegram-bot`)

- **New `examples/telegram-bot/`** — ~120 LoC `grammy` bot proving the chat assistant pattern end-to-end. One persistent agent per chat (`Agent.resume(`tg-${chatId}`)` first, fall back to `Agent.create` on `UnknownAgentError`). Memory enabled with `namespace: "telegram-bot"`, `userId: ctx.from.id`, `activeRecall.enabled`. A `/recall <query>` command uses `memory_search({ corpus: "sessions" })` to surface past conversations.
- **README walkthrough** documents: BotFather setup, `.env` template, run, chat, `kill -9`, restart, chat-again-and-see-memory. Inspects `.theokit/agents/registry.json`, `.theokit/agents/<id>/messages.jsonl`, `.theokit/memory/MEMORY.md`, and `.theokit/memory/sessions/<runId>.md` to show what survived.
- **EC-10 doc** — explicit callout that v1 supports exactly ONE SDK process per cwd; co-locating a bot + a standalone cron worker on the same workspace will race the registry.
- **EC-11 doc** — explicit callout that group-chat `ctx.chat.id` is the group id (not the user); the example uses `ctx.from.id` to keep per-user memory isolated in groups.
- **examples/README.md inventory** updated with the bot at the top of the list — it is the marquee proof for v1.0 chat assistant readiness.

### Added (chat assistant readiness — Phase 3 / ADR D20)

- **`memory_search({ corpus: "sessions" })` actually works.** Per-run summaries are written to `<cwd>/.theokit/memory/sessions/<runId>.md` after every finished run. IndexManager discovers them via the new `session-loader` and tags each chunk with `source: "sessions"`. The `corpus` filter in `memory_search` was already wired; this PR plugs in the data source.
- **EC-9: only `status === "finished"` runs write summaries.** Cancelled, errored, or still-running runs leave no marker behind, so the recall corpus never returns fragments of failed conversations as authoritative context.
- **EC-3: post-run sync is automatic.** `writeSessionSummary` triggers `IndexManager.sync()` in the background immediately after the markdown write. `memory_search({ corpus: "sessions" })` sees the new file on the next call without an ambiguous lazy trigger.
- **Secret redaction.** Both user and assistant text run through the shared `redactSecrets` regex before persisting, matching the MEMORY.md write pipeline.
- **`local-agent.ts` post-run hook moved INSIDE the send mutex.** The user-turn append, assistant-turn append, summary write, hooks executor, and `flushSessionWrites` all happen before the lock releases. `agent.dispose()` waits on the same mutex so it can never return before the summary lands on disk.
- **`agent.dispose()` is now strict** — it acquires the per-agent send mutex before flushing, guaranteeing the in-flight `run.wait()` and post-run lifecycle complete before any caller's `await dispose()` resolves.
- **New tests**: 8 golden cases under `tests/golden/memory/sessions-corpus.golden.test.ts` cover summary-on-finish, hit-on-sessions-search, memory-corpus excludes sessions, redaction, corrupt-file tolerance, EC-3 sync-after-wait, EC-9 cancelled-run, and EC-9 errored-run.

### Added (chat assistant readiness — Phase 2 / ADR D19)

- **Per-agent send mutex** keyed by `agent-send:${agentId}` (ADR D19). `LocalAgent.send` and `CloudAgent.send` now serialize end-to-end per agent: dispatch → `run.wait()` → assistant-turn append → disk flush all happen inside the lock. Two webhook calls hitting the same chat id can no longer interleave `appendSessionMessage` records mid-turn.
- **Concurrent-distinct-agents stay parallel** (EC-8) — the mutex key is per-agentId. A parent agent's send and a subagent send (distinct ids) acquire different locks and run concurrently. Proven by the deadlock-free golden case.
- **`agent.send()` returns the Run as soon as it dispatches**, but the mutex internally awaits completion + post-run hook + session flush before releasing. Streaming consumers keep their `run.stream()` access unchanged; the only observable difference is that a second `agent.send()` on the same agent now waits for the first to finish.
- **New tests**: 5 golden cases under `tests/golden/agent/concurrent-send.golden.test.ts` cover two-concurrent-sends-serialize (strict role alternation), different-agents-stay-parallel, EC-8 subagent no-deadlock, sequential history linearity, and dispose-with-pending-send safety.

### Added (chat assistant readiness — Phase 1 / ADR D18)

- **Persistent session messages** at `<cwd>/.theokit/agents/<agentId>/messages.jsonl` (ADR D18). Append-only JSONL with one record per turn (`{role, text, at}`). `LocalAgent.send` now writes both the user turn and the assistant turn to disk; `Agent.resume()` hydrates the conversation back into memory on `initialize()`. Survives `kill -9` between sends.
- **Opportunistic compaction** — when the JSONL exceeds 400 lines (2× the default `maxTurns=200`), the file is trimmed copy-on-write to the most recent 200 turns. Compaction also runs once during `dispose()` so a long-running chat does not leave 10k stale lines on disk.
- **Race-free append + compaction** (EC-2) — both operations chain through a single per-`(agentId, cwd)` promise queue. Appends and compactions never race each other on the read+rename window. Reentry into `withCwdMutex("agent-send:...")` was rejected because Phase 2's send mutex uses the same key (non-reentrant) and would deadlock; the dedicated queue is the canonical serializer.
- **Multi-line text** (EC-6) — `JSON.stringify` on append and `JSON.parse` per-line on read keep newlines, tabs, and embedded quotes intact across a restart.
- **Crash-safe reader** (EC-7) — malformed lines (e.g., a half-written final record from a power loss) are skipped with a stderr warning. The reader never throws.
- **New tests**: 10 golden cases under `tests/golden/runtime/agent-session-persistence.golden.test.ts` cover round-trip restart, compaction trim, EC-2 (concurrent appends + compaction across threshold), per-agent isolation, EC-6 (tricky text), EC-7 (partial last line), JSONL validity, hydrate-fills-cache, end-to-end Agent.create→send→resume conversation continuity, and direct 500-record compaction.

### Added (chat assistant readiness — Phase 0 / ADRs D17 + D21)

- **Persistent agent registry** at `<cwd>/.theokit/agents/registry.json` (ADR D17). Every `Agent.create / archive / update / delete` mutation triggers a coalesced, atomic write-through. The in-memory `Map` stays as the read-through cache; persistence is keyed per-cwd (EC-5). Survives `kill -9` + process restart.
- **`Agent.resume()` falls back to disk** (ADR D21). On in-memory miss, `Agent.resume(id)` reads the persisted registry, validates the rehydrated entry (local agents check `local.cwd` still exists), and reconstructs the matching `LocalAgent` / `CloudAgent`. Throws `UnknownAgentError(code: "agent_rehydration_failed")` when the workspace path is missing.
- **`Agent.create({ agentId })` collision** (EC-1) — pinning an `agentId` that already lives in the persisted registry now throws `ConfigurationError(code: "agent_id_already_exists")`. Forces the resume-first pattern that chat assistants need.
- **Secret stripping on persist** — `apiKey`, MCP server `headers` / `env`, hook closures, and inline tool handlers are never written to disk. The allow-list mirrors the cloud-config-serializer (ADR D15).
- **Corrupt-registry recovery** (EC-4) — invalid JSON / schema-version mismatch logs a stderr warning and falls back to `{}`. The next mutation overwrites the file with valid JSON.
- **`replaceFileAtomic` multi-writer safe** — per-call unique `.<pid>.<rand>.tmp` suffix replaces the shared `.tmp` path. Removes a cross-process race that surfaced as `ENOENT` on rename when parallel writers raced on the same target.
- **New tests**: 11 golden cases under `tests/golden/runtime/agent-registry-persistence.golden.test.ts` cover round-trip, cross-restart rehydration, stale-cwd rejection, secret stripping, concurrent-write integrity (50 parallel creates), archived-flag persistence, cloud-agent rehydration, EC-1 collision throw, EC-4 corruption recovery, and EC-5 per-cwd isolation.

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

### Changed (memory-system-peer-project-parity, Increment D — Dogfood follow-ups)

- **`local-agent.ts` decomposed** — memory glue (lazy IndexManager + tools cache + Active Memory breaker + summary cache) extracted to `local-agent-memory.ts`. Brings `local-agent.ts` under the G8 400-LoC cap.
- **`legacyMemoryJsonPath` centralized in `memory/types.ts`** — removes the 9-line jscpd clone between `migration.ts` and `runtime/memory-store.ts`. Both now call the leaf-module helper.

### Added (memory-system-peer-project-parity, Increment C — Dogfood examples + Memory namespace)

- **`Memory` public namespace** exported from `@theokit/sdk` — `Memory.runDreamingSweep({ cwd, embedding })` lets users trigger consolidation outside of `agent.send()` (e.g. from a cron job handler).
- **`MemoryEmbeddingRuntime` public type** — `embedding` now accepts either a built-in provider id (`{ provider, model? }`) OR a BYO runtime (`{ runtime: MemoryEmbeddingRuntime }`). Enables self-hosted/local embedding models and self-contained demos without external API creds. Mirrors peer-project's `EmbeddingRuntime` shape from ADR D3.
- **4 new example apps** under `examples/`:
  - **`memory-search`** — LLM uses `memory_search` to find facts in MEMORY.md.
  - **`memory-get`** — LLM uses `memory_get` for bounded reads of `notes/*.md`.
  - **`active-memory`** — blocking pre-send recall injects an `<active-memory>` block.
  - **`memory-dreaming`** — `Memory.runDreamingSweep` consolidates duplicates + clusters + writes a dream-diary entry. Ships with a deterministic local-demo embedding fallback so the example runs without `OPENAI_API_KEY` / `MISTRAL_API_KEY`.
- **`examples/README.md` inventory** updated with all 4 new examples marked ✅ Full.

### Added (memory-system-peer-project-parity, Increment B — Active Memory wire-up)

- **`memory.activeRecall.enabled`** runtime wire-up — when `true`, the SDK calls `runActiveMemory` before every `send()` and prepends the recall summary as a `<active-memory>` block to the LLM system prompt (priority 5 — above context/skills/memory).
- **Per-agent `CircuitBreaker` + `ActiveMemoryCache`** — instantiated lazily on first send with active recall enabled. Keyed by `agentId` so multiple agents in the same process don't share state.
- **Stub-server E2E proof** — captured Anthropic request body contains `<active-memory>` when enabled, and does NOT when disabled.
- **Active recall config surface** — `queryMode` (`"message"` / `"recent"` / `"full"`), `timeoutMs`, `maxSummaryChars`, `persistTranscripts` are all wired from `MemorySettings.activeRecall` through to `runActiveMemory`.

### Added (memory-system-peer-project-parity, Increment A — Agent.create/send wire-up)

- **`MemorySettings.index`** public field — `{ tools?: boolean; backend?: "sqlite-vec" | "lancedb"; embedding?: { provider, model? } }`. When `memory.enabled === true` and `index.tools !== false`, the SDK lazily opens an `IndexManager` on first send + registers `memory_search` and `memory_get` with the LLM. Default backend is `sqlite-vec`; default embedding is none (FTS-only mode).
- **`MemorySettings.activeRecall`** public field — reserved for Phase 7 wire-up (next increment). Type surface live today; runtime hookup pending.
- **Stub-server E2E tests** prove memory tools appear in the captured Anthropic request body's `tools` array when memory is enabled, and are absent when disabled or opted-out via `index.tools: false`.
- **Lazy embedding adapter resolution** — when `index.embedding.provider` is set, the SDK looks the adapter up via `MEMORY_EMBEDDING_ADAPTERS` and instantiates it on first send. Adapter failures degrade gracefully to FTS-only mode with a stderr warning.

### Added (memory-system-peer-project-parity, Phase 13)

- **Cross-validation report** at `.claude/knowledge-base/reviews/cross-validation/memory-system-peer-project-parity-xval-2026-05-16.md`. Verdict **APROVADO COM RESSALVAS**, zero BLOCKERs. All 10 ADRs cross-checked against shipped code; all 13 edge cases verified resolved or documented.

### Added (memory-system-peer-project-parity, Phase 12)

- **Backend selector** — `IndexManager.open({ backend: "sqlite-vec" | "lancedb" })`. Default `"sqlite-vec"`. `"lancedb"` reserved for Phase 12.1; throws `ConfigurationError(code: "memory_backend_not_implemented")` today (same KISS pattern as the Phase 11 stub embedding adapters).

### Added (memory-system-peer-project-parity, Phase 11)

- **`MEMORY_EMBEDDING_ADAPTERS` catalog** exports all 7 peer-project provider ids: `openai`, `mistral`, `voyage`, `deepinfra`, `lmstudio`, `google`, `bedrock`. Switching is one config field.
- **Mistral adapter** fully implemented — `mistral-embed` (1024 dims) via shared OpenAI-compatible factory (`POST /v1/embeddings`). Honors `MISTRAL_API_KEY` + `MISTRAL_API_BASE_URL`.
- **`createOpenAiCompatibleRuntime` shared factory** — extracted from the OpenAI adapter so any provider exposing the `{ model, input }` → `{ data: [{ embedding }] }` REST shape can plug in with a one-file thin wrapper.
- **5 stub adapters** (Voyage, DeepInfra, LMStudio, Google, Bedrock) — metadata-only. `embed()` throws `ConfigurationError(code: "adapter_not_implemented")` so callers detect the gap without crashing the agent loop.

### Added (memory-system-peer-project-parity, Phase 10)

- **Wiki supplements** — files under `.theokit/memory/wiki/*.md` are read-only auxiliary corpora discovered by `discoverWikiFiles`. Indexed alongside `MEMORY.md` + `notes/*.md` with `source: "wiki"` tag in the `files` table.
- **Corpus filtering in search** — `IndexManager.search(query, { sources: ["wiki"] })` returns only wiki hits; default search returns memory + wiki together. `memory_search` tool already honors `corpus: "wiki" | "memory" | "all"` per the peer-project schema from Phase 6.
- **Source coercion on conflict** — `upsertFile` accepts an explicit `source` arg so reclassifying a file (moving a note into the wiki dir, etc.) updates the tag on next sync via `ON CONFLICT DO UPDATE SET source = excluded.source`.

### Added (memory-system-peer-project-parity, Phase 9)

- **`runDreamingSweep`** — cron-driven memory consolidation (ADR D7). Three phases mirror peer-project:
  - **light** — drop near-duplicate facts via cosine similarity (default threshold 0.95).
  - **REM** — single-link agglomerative clustering by cosine similarity (default threshold 0.75).
  - **deep** — write a `notes/dreamed-<ts>.md` per sweep with consolidated clusters.
- **Dream-diary at `.theokit/memory/dream-diary.md`** — append-one-entry-per-sweep. Each entry carries timestamp + content hash (idempotency contract) + counts (`factsBefore`, `factsAfter`, `duplicatesRemoved`, `clustersCreated`, `notesWritten`).
- **All dreaming writes are atomic (EC-3)** — `replaceFileAtomic` for notes and diary; per-cwd mutex held for the whole sweep so concurrent `Remember:` appends can't race.
- **LLM narrative summarization deferred to Phase 9.1** — v1 ships deterministic clustering only. The interface is stable enough to plug an LLM-mediated `narrative.ts` later without changing the orchestrator.

### Added (memory-system-peer-project-parity, Phase 8)

- **CircuitBreaker** for Active Memory — `{ maxTimeouts: 3, cooldownMs: 60000 }` defaults. After N consecutive timeouts, `shouldSkip(key)` returns `true` until cooldown elapses. `recordSuccess` resets the counter immediately. Per-key isolation (multiple agents in one process don't share state).
- **`ActiveMemoryCache`** — TTL-bounded LRU keyed by `sha256(userText + queryMode)`. Default TTL 15s, capacity 1000. Cache hits skip the IndexManager search entirely.
- **`runActiveMemory` integration** — accepts optional `breaker` + `cache` + `agentKey` + `runId` + `persistTranscripts` + `cwd`. Breaker is consulted on entry and updated by status; cache stores results on the way out; transcripts written under `.theokit/memory/transcripts/active-memory/<runId>.json` when enabled.
- **`persistActiveMemoryTranscript`** — JSON transcript persistence. Failures swallowed with stderr warning so transcript IO never crashes the agent run.

### Added (memory-system-peer-project-parity, Phase 7)

- **`runActiveMemory`** — blocking pre-send recall (ADR D6). Default `mode: "search"` calls `IndexManager.search` deterministically; `mode: "subagent"` (LLM-mediated curation) is stubbed for Phase 7.1. Query modes: `"message"` (only the user text), `"recent"` (user text + last N user turns, default 2), `"full"` (entire conversation). Hard timeout via `Promise.race` (default 15000ms) — returns `status: "timeout"` instead of throwing.
- **Status discriminator** — `ActiveMemoryStatus` covers `"ok" | "timeout" | "skipped" | "no-recall" | "error"`. Caller-side dispatch is one switch statement.
- **`ActiveMemoryPromptProvider`** at priority 5 (before context/skills/memory) — contributes the `<active-memory>` block via `SystemPromptAssemblyContext.activeMemorySummary`. Summary is XML-escaped (D9). Block omitted when summary is empty.
- **Pipeline auto-registration** — `SystemPromptPipeline.default()` now wires 5 providers: ActiveMemory (5) → Context (10) → Skills (20) → Memory (30) → Base (100).

### Added (memory-system-peer-project-parity, Phase 6)

- **`memory_search` + `memory_get` tools** (ADR D5) with peer-project-mirrored JSON schemas and descriptions. `memory_search` returns ranked hits with `{ path, startLine, endLine, score, snippet, citation, source }`; `memory_get` returns bounded excerpts with truncation info.
- **Path-traversal guard (EC-2)** — `memory_get` resolves the requested path against the memory root and throws `ConfigurationError(code: "memory_path_escapes_root")` if the resolved path escapes (e.g. `../../etc/passwd`).
- **Result-size cap (EC-10)** — `memory_search` truncates the response when concatenated snippets exceed `maxTotalChars` (default 16384). Low-rank hits are dropped first; `truncated: true` marker on the payload.
- **Agent-loop integration** — new `AgentLoopInputs.memoryTools?: MemoryToolSpec[]` field; `collectTools` appends memory tools alongside shell + MCP tools; `tool-dispatch` routes `origin === "memory"` calls through a dedicated handler that wraps JSON-encoded results.

### Added (memory-system-peer-project-parity, Phase 5)

- **sqlite-vec vector index** under the existing SQLite DB (ADR D2). `vec0` virtual table stores per-chunk embeddings; `vectorSearch` runs KNN with `MATCH` syntax. `loadSqliteVecExtension` wraps the native load with a typed `sqlite_vec_unavailable` ConfigurationError (EC-8) instead of a raw native exception.
- **`meta` table tracks embedding identity** (`providerId` + `model` + `dimension`). On `IndexManager.open`, current adapter config is compared against stored meta — any mismatch drops the `embeddings` table and forces a full re-embed on next `sync()` (EC-1).
- **Hybrid scoring** (ADR D4): FTS top-K + vector top-K merged, scores combined via `vectorScore * vectorWeight + textScore * textWeight` (defaults `0.6` / `0.4`, configurable per-call). Vector-only hits surface alongside FTS hits via a chunk-id outer join. `MemorySearchHit.vectorScore` exposed when vector backend is active.
- **`IndexManager.open({ cwd, embedding? })`** — embedding-aware constructor. FTS-only still works when `embedding` is omitted; backend reported via `status().backend` as `"fts-only"` or `"hybrid"`.

### Added (memory-system-peer-project-parity, Phase 4)

- **`MemoryEmbeddingProviderAdapter` interface** (ADR D3) mirrors peer-project's contract: `id`, `defaultModel`, `transport`, `authProviderId`, `autoSelectPriority`, `create(options) → EmbeddingRuntime`. Adapters live under `internal/memory/adapters/`.
- **OpenAI embedding adapter** (`openai-embedding.ts`) — native fetch only, no `openai` SDK dep. Batches at 100 texts/call. Retries once on 429 + 5xx with linear backoff (EC-9). Empty inputs skipped. Honors `OPENAI_API_KEY` + `OPENAI_API_BASE_URL`. Default model `text-embedding-3-small` (1536 dims).
- **LRU embedding cache** keyed by `sha256(model+text)`. Max 5000 entries; oldest evicted first. Observable via `runtime.stats()` (`cacheHits` / `cacheMisses` / `httpCalls` / `retries`).

### Added (memory-system-peer-project-parity, Phase 3)

- **SQLite + FTS5 index** at `.theokit/memory/.index/memory.sqlite` (ADR D2). Schema: `files`, `chunks`, `chunks_fts` (FTS5 virtual table), `meta`. Triggers keep FTS in sync with `chunks` on insert/delete. WAL mode, foreign keys on. Backed by `better-sqlite3` (optional peer dep) — `node:sqlite` fallback path documented for Node 22.5+.
- **`IndexManager.open / sync / search / status / close`** — full lifecycle. `sync()` walks `MEMORY.md` + `notes/*.md`, computes content hashes, skips unchanged files, deletes old chunks before reindexing changed ones. `search()` runs FTS5 BM25 ranking, returns `MemorySearchHit[]` with `path`, `startLine`, `endLine`, `score`, `textScore`, `snippet`, `source`, `citation` (path:startLine-endLine).
- **Corrupt-DB recovery (EC-7)** — when opening fails with "malformed" / "not a database" / "encrypted" errors, the file is renamed to `<path>.corrupt-<ts>` (plus `-wal` and `-shm` siblings) and the schema is rebuilt from scratch. Diagnostic line emitted to stderr.

### Added (memory-system-peer-project-parity, Phase 2)

- **`chunkMarkdown`** splits markdown by heading boundaries + blank-line paragraph boundaries. Oversize paragraphs split on word-boundary nearest the cap (EC-6) — never mid-word. Each chunk carries `startLine` / `endLine` / `text` / `hash` (sha256) / optional `heading`.
- **`readMemoryFileBounded`** — bounded read with `from` (1-indexed) + `lines` (default 200, mirrors peer-project's `DEFAULT_MEMORY_READ_LINES`). Returns `linesReturned`, `totalLines`, `remainingLines`, `truncated` (true when content remains past the slice). Foundation for Phase 6's `memory_get` tool.
- Public types `MemoryChunk`, `MemoryReadResult`, `MemoryFileEntry` in `internal/memory/types.ts` mirroring peer-project's engine-storage shapes.

### Added (memory-system-peer-project-parity, Phase 1)

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

- License standardized to **Apache-2.0** (was MIT). Aligns all Theo open-core pillars under a single license — see root `CLAUDE.md` strategic review of 2026-05-14.
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
