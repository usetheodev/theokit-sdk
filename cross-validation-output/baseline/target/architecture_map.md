# theokit-sdk Architecture Map

## Overview
TypeScript AI agent SDK. Monorepo (pnpm workspaces) with `packages/sdk` as the publishable package.
45,650 LoC source, 729 test files, 430 ADRs.

## Layering

```
Public API (Agent, Workflow, Cron, Memory, Theokit, defineTool)
    |
Application (agent-factory, agent-builder, workflow, eval, batch, task)
    |
Domain (types/*, errors.ts, budget.ts, define-tool.ts, rag/*)
    |
Internal Runtime (internal/runtime/*, internal/agent-loop/*)
    |
Infrastructure Adapters
  +-- LLM clients (anthropic, openai, ollama, bedrock, vertex, gemini, openrouter, lmstudio, llamacpp)
  +-- Memory backends (sqlite-vec, lancedb, 12 embedding adapters)
  +-- MCP client (OAuth, token storage)
  +-- Persistence (SQLite WAL, atomic writes, file locks, CAS)
  +-- Telemetry adapters (langfuse, langsmith, braintrust, datadog, sentry, posthog, arize)
  +-- Server adapters (express, fastify, hono)
```

## Key Components (15)

1. **agent-runtime** — Agent.create/send/prompt, runAgentLoop, tool dispatch cycle, iteration budget
2. **llm-providers** — Multi-provider with retry, fallback chain, credential pooling, fault injection
3. **tool-system** — defineTool with Zod schemas, registry, dispatch pipeline, repair middleware
4. **memory-system** — Conversation storage, embeddings (12 providers), vector indices, active memory, dreaming
5. **workflow-engine** — Declarative steps (fn, agentStep, branch, parallel, foreach, dowhile, sleep), snapshots
6. **rag-pipeline** — Text splitter, vector retriever, reranker interface
7. **mcp-client** — MCP protocol client with OAuth support
8. **security** — Path traversal guard, secret redaction, API key validation, sensitive path blocking
9. **error-handling** — Typed hierarchy with 11+ error codes, error envelope, provider mappers
10. **observability** — OpenTelemetry tracing, 7 adapter integrations
11. **a2a-communication** — Message bus, agent mailbox for inter-agent messaging
12. **eval-framework** — Runner, dataset iteration, scorers, LLM judge
13. **budget-system** — Cost tracking, pricing registry, usage accumulator, calendar windows
14. **auth-server** — OAuth orchestrator, PKCE, magic link, session management
15. **streaming-subscriptions** — WebSocket + SSE, defineSubscription, tracked resume tokens
