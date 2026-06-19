# Target Architecture Map — `@theokit/sdk`

**Path:** `/home/paulo/Projetos/usetheo/theokit-tools/theokit-sdk`
**Language:** TypeScript (ESM + dual CJS) · **Build:** tsup · **Test:** vitest (forks pool) · **Lint:** biome
**Shape:** pnpm monorepo. Core `packages/sdk` (~45.9k LOC, ~307 internal modules) + extracted subsystems.

## Packages

| Package | Responsibility |
|---|---|
| `sdk` | Agent harness kernel: `Agent.create/send`, `Run.stream`, agent loop, LLM clients, MCP, plugins, errors |
| `sdk-memory` | Memory impl: markdown store, active-memory recall (circuit breaker, TTL LRU), embedding adapters |
| `sdk-budget` | USD-cost budget tracker (port impl) |
| `sdk-cache` | Semantic LLM response cache (vector + FTS) |
| `sdk-handoff` | Inter-agent dispatch, loop protection |
| `sdk-tools` | Built-in tools: readFile/writeFile/editFile/execShell/git/glob/search/webFetch/runVitest |
| `acp` | Agent Client Protocol server (stdio JSON-RPC 2.0) |
| `cli` | `theokit init/dev/inspect/eval` |

## Public API surface

- **Façades (static classes, private ctor):** `Agent` (`src/agent.ts:64`), `Theokit` (`src/theokit.ts:46`), `Cron`.
- **Builder:** `AgentBuilder` (`src/agent-builder.ts:41`) + `createAgentFactory` (ADR D23).
- **Streaming:** `Run.stream(): AsyncGenerator<SDKMessage, void>` — discriminated union `SDKMessage` (`types/messages.ts`): system/user/assistant/thinking/tool_call/error/end/update.
- **Subpath exports** (`package.json`): `./errors`, `./path-safety`, `./concurrency`, `./retry`, `./cron`, `./task-store`, `./workflow`, `./eval`, `./server/auth`, `./subscription`, `./a2a`, `./client`, `./sandbox`, `./internal/{persistence,plugins,observability,security}`.

## Agent loop (`src/internal/agent-loop/`)

`runAgentLoop(inputs)` (`loop.ts:29`) — imperative LLM↔tool loop:
1. `initLoopContext` (tools registry, memory tools, conversation)
2. `while budget.shouldContinue()`: `evaluateBudgetGate` (fail-closed, D318) → `streamLlmTurn` → `buildAssistantMessage` → `dispatchTools` (bounded `mapWithConcurrency`, max 4, D135)
3. per-call: repair (D86-88) → fork whitelist (D111) → OTEL span → plugin veto (D101) → file-hook veto → lifecycle → post-hook
4. memory sync (fire-and-forget)

## Patterns

- **Hexagonal ports & adapters:** `MemoryProvider`, `BudgetTracker` ports in kernel; no-op default impl in core; rich impl in separate package; injected via `Agent.create({...})`.
- **Plugin registry, fixed 11-hook enum** (not extensible, D100) with `pre_tool_call` veto (D101).
- **Closed error union:** `KnownAgentRunErrorCode` exhaustive; `assertNever` audit.
- **AsyncGenerator streaming** (matches `@anthropic-ai/claude-agent-sdk`).
- **Multi-provider in-box:** Anthropic/OpenAI/OpenRouter/Ollama/LMStudio/Gemini (`internal/llm/clients/*`), router by apiMode.

## Error handling (`src/errors.ts`, 692 LOC)

`TheokitAgentError` base → `AuthenticationError`/`RateLimitError`/`ConfigurationError`/`NetworkError`/`UnknownAgentError`/`AgentRunError`. Each carries `isRetryable` + `ErrorMetadata` (provider, endpoint, code, statusCode, retryAfter, raw≤2KB). Provider error-mappers in `internal/error-mappers/*`.

## Testing

`packages/sdk/tests/` — `smoke/` (fast unit), `golden/` (contract, RED-excluded), `a2a/`. Pool `forks` + `fileParallelism:false` (HOME mutation races, libuv saturation). Coverage soft gate 80/80/75. Fixture mode via `sk-fixture-` key.

## Observability

OTEL opt-in, lazy `safe-require` tracer; auto-register Langfuse/Sentry/PostHog if installed. Span names canonical (`agent.create/send`, `tool_call`, `memory.recall`). Histogram `theokit_memory_recall_duration_ms` (D34).
