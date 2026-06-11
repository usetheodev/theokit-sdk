# Cross-Validation Report: TheoKit SDK vs a peer project

**Date:** 2026-06-10
**Target:** TheoKit SDK (`@theokit/sdk`) -- TypeScript AI agent SDK
**Reference:** a peer project -- Python AI agent framework
**Methodology:** 6-phase loop-cross-validation with code-level evidence

---

## Executive Summary

TheoKit SDK scores **3.93/5 (79%)** weighted average across 14 comparison dimensions against a peer project. The target excels in error handling (5/5), observability (5/5), developer experience (5/5), and build/packaging (5/5). The primary gaps are in knowledge/RAG sources (2/5), multi-agent orchestration (3/5), workflow DSL (3/5), and event system (3/5).

TheoKit and a peer project represent different architectural philosophies: TheoKit is a composable TypeScript monorepo with static facade patterns and type safety; a peer project is a role-based Python framework with Pydantic models and decorator-driven DSLs. Each excels in different areas, and neither is strictly superior.

---

## Scoring Summary

| Dimension | Score | Weight | Bar |
|---|---|---|---|
| Knowledge/RAG | 2/5 | 1.0 | `==---` |
| Multi-Agent Orchestration | 3/5 | 1.3 | `===--` |
| Workflow/Flow DSL | 3/5 | 1.0 | `===--` |
| Event System | 3/5 | 0.8 | `===--` |
| Architecture | 4/5 | 1.5 | `====-` |
| Agent Runtime | 4/5 | 1.5 | `====-` |
| Tool System | 4/5 | 1.2 | `====-` |
| Memory System | 4/5 | 1.2 | `====-` |
| Testing | 4/5 | 1.0 | `====-` |
| Security | 4/5 | 1.0 | `====-` |
| Error Handling | 5/5 | 1.2 | `=====` |
| Observability | 5/5 | 1.0 | `=====` |
| Developer Experience | 5/5 | 1.0 | `=====` |
| Build & Packaging | 5/5 | 0.8 | `=====` |

**Weighted Average: 3.93/5 (79%)**
**Simple Average: 3.93/5 (79%)**

---

## Dimension Deep-Dive

### 1. Architecture (4/5, weight 1.5)

**TheoKit:** Static facade pattern (`Agent.create/send`) with private constructor. pnpm monorepo with 30 packages enforcing module boundaries. Internal modules under `src/internal/` encapsulate implementation. Runtime split into `local-agent.ts` and `cloud-agent.ts` behind common `SDKAgent` interface.
- Evidence: `packages/sdk/src/agent.ts:74` -- private constructor enforces static-only usage

**a peer project:** Pydantic BaseModel inheritance (`Agent extends BaseAgent`) with 27 top-level source directories. Event-driven architecture with `crewai_event_bus` singleton. Less encapsulation in core modules (`agent/core.py` imports from 30+ modules directly).
- Evidence: `lib/a peer project/src/a peer project/agent/core.py:1-118` -- 30+ direct imports

**Analysis:** Both have good separation of concerns. TheoKit monorepo package boundaries are stronger for encapsulation. a peer project event-driven architecture provides better decoupling between lifecycle phases. TheoKit dual runtime (local/cloud) behind common interface is a clean DIP implementation.

---

### 2. Agent Runtime (4/5, weight 1.5)

**TheoKit:** `Agent.create()` returns `SDKAgent`. `send()` runs agent loop with tool dispatch. `getOrCreate()` with LRU cache. `streamObject` for structured output. Builder pattern via `AgentBuilder`.
- Evidence: `packages/sdk/src/agent.ts:107`

**a peer project:** Agent is Pydantic model with role/goal/backstory semantic identity. `execute_task()` runs `CrewAgentExecutor` with ReAct loop. Checkpoint/resume via `CheckpointConfig`. Agent adapters for a framework and OpenAI Agents. Guardrails on output.
- Evidence: `lib/a peer project/src/a peer project/agent/core.py:171`

**Analysis:** a peer project Agent is richer at the individual agent level with semantic identity (role/goal/backstory), guardrails, checkpoint/resume, and framework adapters. TheoKit Agent is more composable with static facade, builder pattern, clean local/cloud split, and stronger type safety.

---

### 3. Tool System (4/5, weight 1.2)

**TheoKit:** `defineTool()` with Zod schema and type inference via `z.infer<T>`. `@Tool` decorator via `@theokit/di-agent`. `CustomTool` interface. MCP integration.
- Evidence: `packages/sdk/src/define-tool.ts:44`

**a peer project:** `BaseTool` + `@tool` decorator with Pydantic schema. Tool registry for serialization. Built-in delegation tools (`delegate_work`, `ask_question`), cache tools, image/file tools. MCP native tool wrapper.
- Evidence: `lib/a peer project/src/a peer project/tools/base_tool.py:1`

**Analysis:** TheoKit `defineTool` has superior type inference. a peer project has richer built-in tools (delegation, cache, image/file) and tool result caching with configurable `cache_function`.

---

### 4. Memory System (4/5, weight 1.2)

**TheoKit:** `sdk-memory` package with 40+ files. 6 embedding adapters (OpenAI, Mistral, Voyage, DeepInfra, Ollama, OpenRouter). SQLite-vec and LanceDB backends. Active memory, dreaming phases, session transcripts. Circuit breaker for adapter resilience.
- Evidence: `packages/sdk-memory/src/index.ts`

**a peer project:** Unified `Memory` class with LLM-analyzed storage. LanceDB and Qdrant Edge backends. `MemoryScope`/`MemorySlice` for isolation. Encoding/recall flows. `extract_memories_from_content` for intelligent analysis.
- Evidence: `lib/a peer project/src/a peer project/memory/unified_memory.py:56`

**Analysis:** TheoKit has broader embedding adapter variety (6 vs 1) and unique dreaming feature. a peer project has more intelligent LLM-powered memory analysis and structured scoping. Both are sophisticated; different strengths.

---

### 5. Multi-Agent Orchestration (3/5, weight 1.3)

**TheoKit:** `defineSubAgent()` creates child agents as tools. `MaxDelegationDepthError` prevents infinite recursion. Basic agent mailbox.
- Evidence: `packages/sdk/src/a2a/subagent.ts:35`

**a peer project:** `Crew` class orchestrates multiple agents with sequential/hierarchical process. Delegation tools. Full A2A protocol (40+ files) with auth, streaming, push notifications, UI extensions. Agent adapters for a framework/OpenAI.
- Evidence: `lib/a peer project/src/a peer project/a2a/__init__.py`

**Analysis:** a peer project is significantly more mature. The Crew pattern with roles/goals/tasks is a first-class orchestrator. A2A protocol is comprehensive. TheoKit `defineSubAgent` is simpler tool-based delegation without higher-level orchestration.

---

### 6. Workflow/Flow DSL (3/5, weight 1.0)

**TheoKit:** `run-until.ts` provides basic workflow orchestration. No declarative flow DSL.
- Evidence: `packages/sdk/src/internal/runtime/run-until.ts`

**a peer project:** Full Flow framework with `@start`/`@listen`/`@router` decorators. State management with Pydantic. SQLite persistence. Visualization builder. Conversational flows. Human feedback integration. Resume capability. 35+ files.
- Evidence: `lib/a peer project/src/a peer project/flow/flow.py`, `lib/a peer project/src/a peer project/flow/runtime.py`

**Analysis:** a peer project is significantly ahead with a mature, declarative Flow DSL. TheoKit lacks this capability entirely.

---

### 7. Knowledge/RAG (2/5, weight 1.0)

**TheoKit:** Wiki loader and markdown chunking. No abstract knowledge source abstraction. No typed document loaders.
- Evidence: `packages/sdk-memory/src/internal/wiki-loader.ts`

**a peer project:** Full Knowledge module with `BaseKnowledgeSource`. Typed sources: PDF, CSV, Excel, JSON, text, docling. Knowledge storage with factory pattern. 21 files.
- Evidence: `lib/a peer project/src/a peer project/knowledge/knowledge.py`

**Analysis:** a peer project significantly ahead with comprehensive document source abstractions for all common formats. This is TheoKit's largest gap.

---

### 8. Error Handling (5/5, weight 1.2)

**TheoKit:** `KnownAgentRunErrorCode` closed union type with exhaustive switch support. 6 provider-specific error mappers (Anthropic, Bedrock, Ollama, OpenAI-compat, Vertex). Secret redaction in errors. `coerceToKnownAgentRunErrorCode` boundary normalizer.
- Evidence: `packages/sdk/src/errors.ts:56`

**a peer project:** Converter with retry. Guardrail processing (hallucination, LLM-based). Less structured error codes.
- Evidence: `lib/a peer project/src/a peer project/utilities/converter.py`

**Analysis:** **Target EXCEEDS reference.** TheoKit's discriminated error union with provider-specific mappers is a best-in-class pattern. Secret redaction in error messages is a production-ready feature a peer project lacks.

---

### 9. Testing (4/5, weight 1.0)

**TheoKit:** 746 test files. Vitest. Fixture mode with `fixture-responder`. Integration tests in separate pool. **Inviolable real-LLM validation rule**. Preflight native bindings checker.
- Evidence: `packages/sdk/tests/`

**a peer project:** 239 test files. Pytest. Mock-heavy approach. Thread safety tests for events. Flow resumability tests.
- Evidence: `lib/a peer project/tests/`

**Analysis:** TheoKit has 3x more test files and enforces real-LLM validation via inviolable rule (`rules/real-llm-validation.md`). Fixture mode is a thoughtful test seam. Both have integration-level tests.

---

### 10. Security (4/5, weight 1.0)

**TheoKit:** Path guard, secret redaction, API key validation, credential pool rotation.
- Evidence: `packages/sdk/src/internal/security/path-guard.ts`

**a peer project:** Fingerprint identity, OAuth2 providers (6: Auth0, Keycloak, Okta, WorkOS, Entra ID), A2A auth. TODO markers for scoping/delegation.
- Evidence: `lib/a peer project/src/a peer project/security/security_config.py:20`

**Analysis:** Different focuses. TheoKit: runtime protection. a peer project: identity and auth. Both are incomplete in different ways.

---

### 11. Observability (5/5, weight 1.0)

**TheoKit:** OTel with adapter registry. 7 integrations: Langfuse, Langsmith, Arize, Braintrust, Datadog, PostHog, Sentry. Budget tracking with cost computation.
- Evidence: `packages/sdk/src/internal/telemetry/adapter-registry.ts`

**a peer project:** OTel with OTLP exporter. Anonymous telemetry. Event-based tracing.
- Evidence: `lib/a peer project/src/a peer project/telemetry/telemetry.py`

**Analysis:** **Target EXCEEDS reference.** TheoKit's 7 adapter integrations vs a peer project's single OTLP exporter is a significant breadth advantage.

---

### 12. Developer Experience (5/5, weight 1.0)

**TheoKit:** TypeScript generics, Zod type inference, discriminated unions, static facade, builder pattern, React bindings, dual ESM+CJS, publint validation.
- Evidence: `packages/sdk/src/agent.ts:74`

**a peer project:** Pydantic validation, `@agent`/`@task`/`@crew` decorators, YAML config, Rich console, flow visualization, CLI scaffolding.

**Analysis:** **Target EXCEEDS reference** for type safety and packaging. a peer project has better CLI tooling.

---

### 13. Build & Packaging (5/5, weight 0.8)

**TheoKit:** pnpm workspace, 30 packages, tsup dual ESM+CJS, publint+attw, Changesets, Biome, native bindings preflight.
- Evidence: `package.json`

**a peer project:** uv workspace, 2 packages, hatch build, standard Python packaging.

**Analysis:** **Target EXCEEDS reference** in build sophistication (different ecosystem constraints apply).

---

### 14. Event System (3/5, weight 0.8)

**TheoKit:** Hooks with file-based discovery and programmatic registration. No centralized event bus.
- Evidence: `packages/sdk/src/internal/runtime/hooks-executor.ts`

**a peer project:** Full event bus with 80+ typed events, handler graph, dependency injection, RWLock, async support.
- Evidence: `lib/a peer project/src/a peer project/events/event_bus.py`

**Analysis:** a peer project significantly more mature. The event bus enables decoupled architecture that TheoKit's procedural hooks cannot match.

---

## Gaps (features a peer project has that TheoKit lacks)

### High Severity

| # | Gap | Reference File |
|---|---|---|
| 1 | **No Crew-style multi-agent orchestrator** -- role-based task assignment with sequential/hierarchical processes | `lib/a peer project/src/a peer project/crews/__init__.py` |
| 2 | **No declarative Flow DSL** -- `@start/@listen/@router` with state persistence, visualization, human feedback | `lib/a peer project/src/a peer project/flow/dsl/_start.py:17` |
| 3 | **No typed Knowledge source abstraction** -- PDF, CSV, Excel, JSON loaders with `BaseKnowledgeSource` | `lib/a peer project/src/a peer project/knowledge/source/base_knowledge_source.py` |

### Medium Severity

| # | Gap | Reference File |
|---|---|---|
| 4 | **No Task abstraction** with expected output format, guardrails, conditional execution | `lib/a peer project/src/a peer project/tasks/__init__.py` |
| 5 | **No full A2A protocol** -- auth, streaming, push, agent cards (40+ files) | `lib/a peer project/src/a peer project/a2a/config.py` |
| 6 | **No centralized typed event bus** with handler graph and dependency injection | `lib/a peer project/src/a peer project/events/event_bus.py` |
| 7 | **No checkpoint/resume** for long-running agents | `lib/a peer project/src/a peer project/state/checkpoint_config.py` |

### Low Severity

| # | Gap | Reference File |
|---|---|---|
| 8 | **No agent training/fine-tuning** pipeline | `lib/a peer project/src/a peer project/utilities/training_handler.py` |
| 9 | **No agent framework adapters** (a framework, OpenAI Agents interop) | `lib/a peer project/src/a peer project/agents/agent_adapters/a framework/langgraph_adapter.py` |

---

## Areas Where Target Exceeds Reference

| # | Area | Evidence |
|---|---|---|
| 1 | **Discriminated error union** with 6 provider-specific mappers | `packages/sdk/src/errors.ts:56` |
| 2 | **7 telemetry adapter integrations** (vs 1 OTLP exporter) | `packages/sdk/src/internal/telemetry/adapter-registry.ts` |
| 3 | **Type-safe tool definition** with Zod `z.infer<T>` | `packages/sdk/src/define-tool.ts:44` |
| 4 | **10-platform messaging gateways** (Telegram, Discord, Slack, WhatsApp, Teams, Email, SMS, LINE, Matrix, Mattermost) | `packages/gateway/src` |
| 5 | **DI container** with `@Injectable`, `@Inject`, scopes, 9 agentic decorators | `packages/di/src` |
| 6 | **Runtime security** -- path guard + secret redaction | `packages/sdk/src/internal/security/path-guard.ts` |

---

## Most-Cited Reference Files

| File | Citations | Description |
|---|---|---|
| `lib/a peer project/src/a peer project/agent/core.py` | 3 | Agent class -- role, goal, backstory, knowledge |
| `lib/a peer project/src/a peer project/events/event_bus.py` | 3 | Event bus with typed events, handler graph |
| `lib/a peer project/src/a peer project/flow/flow.py` | 2 | Flow framework entry point |
| `lib/a peer project/src/a peer project/flow/runtime.py` | 2 | Flow execution engine |
| `lib/a peer project/src/a peer project/memory/unified_memory.py` | 2 | Unified Memory with LLM analysis |
| `lib/a peer project/src/a peer project/tools/base_tool.py` | 2 | BaseTool class, @tool decorator |
| `lib/a peer project/src/a peer project/security/security_config.py` | 2 | SecurityConfig with fingerprinting |
| `lib/a peer project/src/a peer project/telemetry/telemetry.py` | 2 | Telemetry with OTLP exporter |
| `lib/a peer project/src/a peer project/knowledge/knowledge.py` | 1 | Knowledge source management |
| `lib/a peer project/src/a peer project/a2a/config.py` | 1 | A2A protocol configuration |

---

## Recommendations (Priority Order)

1. **Implement Knowledge Source abstraction** (Gap 3, score 2/5) -- largest gap. Start with `BaseKnowledgeSource` interface and PDF/CSV/JSON loaders.

2. **Build Crew-style orchestrator** (Gap 1, score 3/5) -- enables role-based multi-agent scenarios. Study a peer project `Crew` class pattern.

3. **Add Flow DSL** (Gap 2, score 3/5) -- declarative workflow definition with `@start/@listen/@router` decorators, state persistence.

4. **Implement typed event bus** (Gap 6, score 3/5) -- enables decoupled architecture. Study a peer project `events/event_bus.py`.

5. **Add Task abstraction** (Gap 4) -- structured task definition with expected output and guardrails.

6. **Implement checkpoint/resume** (Gap 7) -- critical for long-running agent workflows.

---

## Methodology Notes

- All scores based on reading actual source code in both projects
- 14 comparison dimensions with weights reflecting importance
- 29 components identified across both projects (14 target, 15 reference)
- 28 reference files cataloged and verified to exist
- 9 gaps and 6 target-exceeds findings registered
- Scores use 0-5 scale: 0=absent, 1=minimal, 2=partial, 3=comparable, 4=good, 5=exceeds reference
