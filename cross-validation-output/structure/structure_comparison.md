# Structure Comparison — `@theokit/sdk` (target) vs `peer-js` (reference)

Phase 2 output. 14 comparison dimensions registered; 11 structural findings (each cites both projects).

## Dimensions

| # | Dimension | Category | Weight |
|---|---|---|---|
| 1 | Folder Organization & Layering | architecture | 1.5 |
| 2 | Dependency Injection & Extensibility | architecture | 1.5 |
| 3 | Error Handling | error_handling | 1.5 |
| 4 | Testing Strategy | testing | 1.5 |
| 5 | Design Patterns | design_patterns | 1.0 |
| 6 | API Design & DX | api_design | 1.5 |
| 7 | Provider / Model Abstraction | api_design | 1.0 |
| 8 | Observability & Telemetry | observability | 1.0 |
| 9 | Security & Auth | security | 1.5 |
| 10 | Build & Tooling | devops | 1.0 |
| 11 | Modularity & Code Organization | code_organization | 1.0 |
| 12 | Streaming & Concurrency Model | performance | 1.0 |
| 13 | Session & State Persistence | architecture | 1.0 |
| 14 | Agent Composition | design_patterns | 1.0 |

## Structural contrasts (high-signal)

### Where the reference (peer-js) is structurally stronger
- **Security & Auth (high):** full OAuth2/OIDC credential subsystem — `core/src/auth/` (exchangers, refreshers, credential services, `ToolAuthHandler` parsing OpenAPI security). Target ships only `./server/auth` adapters + API keys.
- **Session & State Persistence (high):** `DatabaseSessionService` over MikroORM (PG/MySQL/SQLite/MariaDB) + URI registry — `core/src/sessions/base_session_service.ts:25`. Target persists conversations to fs/memory JSON only.
- **Testing Strategy (high):** project suites unit/integration/e2e/**cross-language conformance** (Java/Python parity) + 86-88% coverage — `peer-js/vitest.config.ts`, `tests/cross_language/`. Target excludes golden/contract tests by default (RED roadmap).
- **Agent Composition (medium):** typed composite agents (Sequential/Parallel/Loop/Routed) as `BaseAgent` subclasses — `core/src/agents/sequential_agent.ts:41`. Target composes via the handoff plugin + markdown subagents.
- **DI & Extensibility (medium):** uniform URI/class registry for every pluggable service — `core/src/models/registry.ts:58`. Target mixes hexagonal ports + a fixed hook enum (less discoverable for "register my own backend").

### Where the target (`@theokit/sdk`) is structurally stronger
- **Error Handling:** typed `TheokitAgentError` hierarchy with `isRetryable` + `ErrorMetadata` + closed `KnownAgentRunErrorCode` union — `errors.ts` (692 LOC). Reference mostly throws plain `Error` and models failures as event data.
- **Provider breadth:** Anthropic/OpenAI/OpenRouter/Ollama/LMStudio/Gemini in-box (`internal/llm/clients/*`). Reference is Gemini-first.
- **Build discipline:** native-bindings ABI preflight (`tools/preflight-native-bindings.mjs`, ADR D01), dual ESM/CJS, publint/attw, changesets.
- **API ergonomics:** `Agent.create/getOrCreate/prompt` façade + `AgentBuilder` + `createAgentFactory`; one-shot `Agent.prompt` has no reference equivalent.

### Comparable
- **Observability:** both OTEL-native. Reference uses gen_ai semconv 1.37 + GCP exporters; target uses lazy auto-registered exporters (Langfuse/Sentry/PostHog) + recall histogram.
- **Folder organization:** both package-by-feature; reference single-package-per-domain vs target kernel + extracted subsystems.

## Quality gate
PASS (0.90). Required categories (architecture, testing, error_handling) covered; every dimension has two-project evidence.
