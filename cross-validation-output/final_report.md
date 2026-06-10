# Cross-Validation Report: theokit-sdk vs peer-agents

**Date:** 2026-06-10
**Target:** theokit-sdk (TypeScript AI agent SDK, @theokit/sdk v1.7.0-develop)
**Reference:** peer-agents (Python AI agent framework by a framework, v0.5.x)
**Analyst:** chief-analyst (loop-cross-validation)

---

## Executive Summary

theokit-sdk is a comprehensive TypeScript AI agent SDK (45,650 LoC, 729 test files, 430 ADRs) that competes favorably against peer-agents (112,411 LoC, 340 test files), a production Python agent framework by a framework built on a framework.

**Overall Weighted Score: 3.92 / 5.0 (78.4%)**

theokit-sdk excels in 9 of 12 dimensions, with particular strengths in memory system (5/5), workflow orchestration (5/5), architecture (4/5), and error handling (4/5). peer-agents has advantages in multi-agent delegation (3/5 -- theokit-sdk has lower integration) and developer experience (3/5 -- peer-agents has lower barrier to entry with built-in tools and CLI).

The two projects reflect different design philosophies: theokit-sdk is a framework-independent, type-safe SDK with rich built-in capabilities; peer-agents is a a framework ecosystem product leveraging a framework for graph-based agent execution with strong middleware composition.

---

## Score Card

| Dimension | Weight | Score (0-5) | Rating | Notes |
|-----------|--------|-------------|--------|-------|
| Architecture | 1.5x | 4 | Strong | Framework-independent, clear layering, DIP applied, 430 ADRs |
| Agent Runtime | 1.5x | 4 | Strong | Retry with full jitter, fallback chains, credential pooling, parallel tool dispatch |
| Tool System | 1.2x | 4 | Strong | Zod schemas, repair middleware, MCP bridging |
| Memory System | 1.2x | 5 | Excellent | 12 embedding providers, dual vector backends, active memory, dreaming |
| Multi-Agent | 1.0x | 3 | Adequate | A2A message bus exists but lacks peer-agents-level task tool integration |
| Error Handling | 1.2x | 4 | Strong | Closed error code union, 5 provider mappers, error envelope, secret redaction |
| Security | 1.3x | 3 | Adequate | Path guard + redaction, but lacks sandbox isolation |
| Testing | 1.0x | 4 | Strong | 729 test files, type tests, real LLM validation rule |
| Observability | 0.8x | 4 | Strong | 7 vendor adapters, OpenTelemetry native |
| Developer Experience | 1.0x | 3 | Adequate | More setup ceremony; no built-in coding tools or CLI TUI |
| Workflow Orchestration | 1.0x | 5 | Excellent | 7 step types, snapshot persistence, retry, suspend/resume |
| Build/Packaging | 0.8x | 4 | Strong | Dual ESM/CJS, sub-path exports, publint+attw validation |

**Weighted Average: 3.92 / 5.0** | **Simple Average: 3.92 / 5.0**

---

## Gap Analysis

### High Severity Gaps

#### 1. Sandbox Isolation Backend
- **Reference:** `libs/peer-agents/peer-agents/backends/sandbox.py`
- **Issue:** peer-agents has `SandboxBackendProtocol` enabling fully sandboxed code execution via remote containers. theokit-sdk has path guards (`PathTraversalError`, `SensitivePathError`) but no sandbox execution boundary. For coding agents, sandbox isolation prevents arbitrary code from affecting the host system.
- **Suggestion:** Implement a sandboxed execution backend (Docker/Firecracker) for shell tool execution.
- **Effort:** Large

#### 2. Integrated Subagent Delegation via Task Tool
- **Reference:** `libs/peer-agents/peer-agents/middleware/subagents.py:27`
- **Issue:** peer-agents `SubAgent` system provides declarative subagent specs (`SubAgent` TypedDict) with automatic `task` tool registration, middleware inheritance, per-subagent permissions, and HITL. theokit-sdk `a2a/message-bus.ts` is lower-level without this integration.
- **Suggestion:** Extend `Agent.create` to accept subagent specs that auto-register as callable tools with inherited middleware and permissions.
- **Effort:** Large

### Medium Severity Gaps

#### 3. Built-in Coding Agent Tools
- **Reference:** `libs/peer-agents/peer-agents/middleware/filesystem.py:75`
- **Issue:** peer-agents ships rich built-in file operation tools (`ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`, `execute`) out of the box. theokit-sdk requires consumers to define file tools manually or use MCP.
- **Suggestion:** Ship `@theokit/sdk/tools/filesystem` sub-path with pre-built file operation tools.
- **Effort:** Medium

#### 4. Conversation Summarization/Compaction
- **Reference:** `libs/peer-agents/peer-agents/middleware/summarization.py:1`
- **Issue:** peer-agents `SummarizationMiddleware` auto-compacts conversations when token usage exceeds configurable threshold, offloading to backend storage. theokit-sdk has compression helpers but no auto-triggered summarization.
- **Suggestion:** Implement auto-summarization triggered at configurable token thresholds.
- **Effort:** Medium

#### 5. CLI TUI for Interactive Agent Sessions
- **Reference:** `libs/code/peer-agents_code/`
- **Issue:** peer-agents ships `libs/code` with a full Textual TUI: chat input, notifications, session stats, MCP auth/trust, theme system, approval flow, onboarding, thread selector. theokit-sdk has no built-in CLI agent interface.
- **Suggestion:** Build `@theokit/cli-agent` package with TUI for interactive development.
- **Effort:** Large

#### 6. Human-in-the-Loop Interrupt System
- **Reference:** `libs/peer-agents/peer-agents/graph.py:248`
- **Issue:** peer-agents has `HumanInTheLoopMiddleware` with configurable `interrupt_on` per tool, enabling approval flows before dangerous operations with checkpointed state. theokit-sdk has hooks (`preToolUse`/`postToolUse`) but no built-in HITL with checkpointing.
- **Suggestion:** Extend hook system with built-in HITL middleware that pauses execution, persists state, and resumes after human approval.
- **Effort:** Medium

#### 7. SWE-bench Evaluation Integration
- **Reference:** `libs/evals/peer-agents_evals/`
- **Issue:** peer-agents has `libs/evals` with SWE-bench integration for evaluating coding agent quality against real software engineering tasks.
- **Suggestion:** Build SWE-bench eval adapter in the existing eval framework.
- **Effort:** Medium

### Low Severity Gaps

#### 8. Model-specific Harness Profiles
- **Reference:** `libs/peer-agents/peer-agents/profiles/harness/harness_profiles.py`
- **Issue:** peer-agents `HarnessProfile` provides model-specific prompt tuning per model family (Anthropic Sonnet/Opus/Haiku, OpenAI Codex).
- **Suggestion:** Add optional model profiles for prompt tuning based on LLM provider.
- **Effort:** Small

---

## Areas Where theokit-sdk Excels

### 1. Framework Independence
theokit-sdk is fully self-contained with zero dependency on a framework/a framework. All LLM clients, tool dispatch, and runtime are implemented in-house. This avoids framework lock-in and gives full control over the runtime. peer-agents `graph.py` has 20+ imports from `a framework`/`a framework`.

### 2. Workflow Engine (Score: 5/5)
`Workflow.create().then().commit().run()` API with 7 step types (`fn`, `agentStep`, `branch`, `parallel`, `foreach`, `dowhile`, `sleep`), snapshot persistence, retry policies (`maxAttempts`, `backoff`), single-flight execution, Zod validation, suspend/resume. 14 files in `internal/workflow/`. peer-agents has no equivalent; it relies on lower-level a framework graph primitives.

### 3. Memory System (Score: 5/5)
12 embedding providers (OpenAI, Mistral, Cohere, Voyage, Jina, Ollama, DeepInfra, Gemini, Azure OpenAI, OpenRouter), dual vector index backends (SQLite-vec, LanceDB), active memory with circuit breaker, dreaming/consolidation phases (diary, phases, run), session storage with markdown transcripts, embedding cache, migration utilities. 25+ files in `internal/memory/`. peer-agents memory is simple AGENTS.md file loading (~200 LoC).

### 4. Error Handling (Score: 4/5)
`KnownAgentRunErrorCode` closed union (11+ codes) enabling exhaustive `switch` handling. Provider-specific error mappers for Anthropic, OpenAI, Bedrock, Ollama, Vertex. Error envelope (`server/errors-envelope.ts`) for cross-layer transport. Secret redaction in error messages via `internal/security/redact.ts`.

### 5. Observability (Score: 4/5)
OpenTelemetry-native tracing with 7 vendor adapter integrations: Langfuse, LangSmith, Braintrust, Datadog, Sentry, PostHog, Arize. Safe dynamic require for optional dependencies. Adapter registry pattern for extensibility. peer-agents focuses primarily on LangSmith (same company).

### 6. Budget System (No Equivalent in peer-agents)
Comprehensive cost management: pricing registry, usage accumulator, calendar windows for time-based cost limits, `BudgetTracker` integration in the agent loop. Enables production cost governance. peer-agents has no equivalent.

---

## Improvement Roadmap (Priority Order)

| Priority | Gap | Effort | Impact | Rationale |
|----------|-----|--------|--------|-----------|
| 1 | Sandbox isolation backend | Large | High | Security boundary for coding agents. Blocks enterprise adoption without it. |
| 2 | Integrated subagent delegation | Large | High | Multi-agent is a core use case. peer-agents pattern is proven. |
| 3 | Built-in coding tools | Medium | Medium | Reduces friction for the most common agent type (coding). |
| 4 | HITL interrupt system | Medium | Medium | Safety-critical for production agents modifying files/infra. |
| 5 | Conversation summarization | Medium | Medium | Long-running agents need context management. |
| 6 | SWE-bench eval integration | Medium | Medium | Industry-standard agent benchmark for credibility. |
| 7 | CLI TUI | Large | Low | Nice-to-have for development; not a core SDK concern. |
| 8 | Model-specific profiles | Small | Low | Optimization, not a missing capability. |

---

## Most-Cited Reference Files

| File | Citations | Description |
|------|-----------|-------------|
| `libs/peer-agents/peer-agents/graph.py` | 7 | Core agent graph assembly |
| `libs/peer-agents/peer-agents/middleware/subagents.py` | 3 | SubAgent delegation system |
| `libs/peer-agents/peer-agents/middleware/filesystem.py` | 3 | File tools + permissions |
| `libs/peer-agents/peer-agents/middleware/memory.py` | 2 | AGENTS.md memory loader |
| `libs/peer-agents/peer-agents/middleware/summarization.py` | 2 | Conversation compaction |
| `libs/peer-agents/peer-agents/backends/sandbox.py` | 2 | Sandbox execution backend |
| `libs/peer-agents/peer-agents/backends/protocol.py` | 2 | Backend protocol interface |
| `libs/peer-agents/peer-agents/profiles/harness/harness_profiles.py` | 2 | Model-specific profiles |
| `libs/peer-agents/peer-agents/_tools.py` | 1 | Tool helpers |
| `libs/peer-agents/peer-agents/middleware/skills.py` | 1 | Skills middleware |

---

## Methodology

- **Phase 1 (Baseline):** Registered both projects, inventoried 200 source files, identified 15 target + 14 reference components.
- **Phase 2 (Structure Compare):** Defined 12 comparison dimensions with weights (architecture/agent_runtime at 1.5x, security at 1.3x, error_handling/tool_system/memory_system at 1.2x).
- **Phase 3 (Deep Analysis):** Read actual source code in both projects. Each comparison cites specific files and evidence from both codebases.
- **Phase 4 (Gap Detection):** Identified 8 gaps with reference file citations and 6 findings documenting target strengths.
- **Phase 5 (Scoring):** Computed weighted average (3.92/5.0) consistent with gap findings.
- **Phase 6 (Report):** This document.

---

## Conclusion

theokit-sdk is a strong, mature AI agent SDK that competes favorably against peer-agents in most dimensions. Its key advantages are framework independence, a sophisticated memory system, a declarative workflow engine, and rich error handling. The primary gaps are in sandbox isolation for secure code execution and integrated multi-agent delegation -- both addressable and neither blocking for the current use cases. The 3.92/5.0 score reflects a well-engineered SDK with clear areas for strategic improvement.
