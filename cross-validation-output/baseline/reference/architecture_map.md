# Reference Architecture Map — `@google/adk` (peer-js)

**Path:** `.claude/knowledge-base/reference/peer-js`
**Language:** TypeScript · **Build:** esbuild/tsc · **Test:** vitest (project suites) · **Lint:** gts + secretlint
**Shape:** npm monorepo. `core/` (`@google/adk`) + `dev/` (`@google/adk-devtools`). Google Agent Development Kit ported to JS (v1.2.0).

## Entry points

- **`Runner`** (`core/src/runner/runner.ts:123`) — main SDK facade. DI of `sessionService`, `memoryService`, `artifactService`, `credentialService`, `pluginManager`. `runAsync(params): AsyncGenerator<Event>`. `InMemoryRunner` variant.
- **Dev server** `AdkApiServer` (`dev/src/server/adk_api_server.ts:59`) — Express REST wrapping Runner.
- **CLI** `adk` (`dev/src/cli/cli.ts`) — run/create/deploy-cloud-run/deploy-agent-engine.

## Core modules (`core/src/`)

| Module | Key constructs |
|---|---|
| `agents` | `BaseAgent` (`base_agent.ts:74`, abstract `runAsyncImpl`), `LlmAgent` (`llm_agent.ts:80`, 11 processors), composite `Sequential/Parallel/Loop/RoutedAgent`; `InvocationContext`/`Context`/`ReadonlyContext`; `RunConfig` (StreamingMode LIVE/REGULAR) |
| `models` | `BaseLlm` (`base_llm.ts:36`, abstract `generateContentAsync`/`connect`), `Gemini`/`ApigeeLlm`/`RoutedLlm`; `LLMRegistry` (`registry.ts:58`, regex match + LRU 32) |
| `tools` (26 files) | `BaseTool` (`base_tool.ts:62`), `FunctionTool`, `BaseToolset`, `AgentTool`; OpenAPI tool gen (`openapi_tool/`), MCP (`mcp/`, MCPToolset/MCPTool/MCPSessionManager), built-in Google tools, long-running/active-streaming |
| `sessions` | `BaseSessionService` (`base_session_service.ts:25`): InMemory/Database(MikroORM PG/MySQL/SQLite/MariaDB)/VertexAi; URI registry; `Session`/`State` |
| `memory` | `BaseMemoryService` (`base_memory_service.ts:44`): InMemory/VertexAiMemoryBank; addSessionToMemory/searchMemory |
| `artifacts` | `BaseArtifactService`: InMemory/File/Gcs; URI registry factory |
| `auth` | `AuthCredential` union, `BaseAuthProvider`, exchangers (OAuth2/OIDC), refreshers, credential services, `ToolAuthHandler`; `CredentialExchangeError` |
| `code_executors` | `BaseCodeExecutor` (`base_code_executor.ts:50`): Unsafe/AgentEngineSandbox/BuiltIn; errorRetryAttempts |
| `context` | `BaseContextCompactor`: TokenBased/Truncating + `LlmSummarizer` |
| `events` | `Event` (`event.ts:20`, extends LlmResponse), `EventActions`, `toStructuredEvents()` union, branch isolation |
| `plugins` | `BasePlugin` (`base_plugin.ts:27`, optional before/after agent/model/tool callbacks), `PluginManager`; `LoggingPlugin`/`SecurityPlugin` |
| `telemetry` | OTEL-native: `tracer` (gen_ai semconv 1.37), `traceAgentInvocation`/`traceCallLlm`, GCP CloudTrace/Logging exporters |
| `a2a` | `RemoteA2AAgent`, `A2AAgentExecutor`, `toA2a()` — ADK↔A2A adapter |
| `skills` | frontmatter+scripts loader (dir/zip), `GCPSkillRegistry`, `SkillToolset`, Load/Run skill tools |
| `integrations` | `AgentRegistry` (GCP Cloud Agent Registry client) |
| `utils` | winston `logger`, zod→JSON schema, `failover_utils` (exp backoff), `async_queue`, model-name detection |

## Patterns

Registry everywhere (LLM/session/artifact/skill/auth — URI or class-based) · Strategy (executors/compactors/plugins/tools) · Chain-of-responsibility (processor pipeline, plugin callbacks) · Template method (`runAsync`→`runAsyncImpl`) · Composite (agent tree, toolsets) · Adapter (A2A/OpenAPI/MCP) · DI (Runner services) · Discriminated union (structured events).

## Error handling

**Event-centric** — errors mostly modeled as event data (`ToolResult.error`, `LlmResponse.error`, `EventActions.error`) rather than thrown. Few custom exceptions: `CredentialExchangeError` (`auth/exchanger/base_credential_exchanger.ts:13`), `CredentialRefresherError`. Most other failures throw plain `Error` + winston log.

## Testing

`vitest.config.ts` project suites: `unit:core`, `unit:dev`, `integration` (real DB via MikroORM), `e2e` (Vertex/Gemini), `cross-language` (conformance with Java/Python ADK). Coverage targets 86% stmts / 87% branches / 88% funcs. Tests mirror source (`core/test/...`). `DummyLlm` mock.

## Dependencies

vertexai/genai (Gemini-first), `@a2a-js/sdk`, `@mikro-orm/core` + drivers, `google-auth-library`, OTEL SDK + GCP exporters, `@modelcontextprotocol/sdk`, zod v4, winston, express, commander, ts-graphviz.
