# @theokit/sdk — Architecture Map

## Overview
- **Type:** TypeScript AI Agent SDK
- **Architecture:** Hexagonal (Ports & Adapters) with dual-mode runtime
- **Monorepo:** pnpm workspaces, 32 packages
- **Core Package:** `packages/sdk/` (~44K LoC production, ~44K LoC tests)
- **Build:** tsup (dual ESM+CJS), Vitest, Biome

## Layer Diagram

```
PUBLIC API (index.ts — 50+ exports, 11 sub-path entries)
  ├── Agent (facade) + AgentBuilder + AgentFactory
  ├── Memory, Task, Budget, Cron, Eval, Workflow
  └── Types (24 type definition files)

RUNTIME ENGINE (internal/runtime/ — 65+ files)
  ├── LocalAgent (file-based, hook-driven)
  ├── CloudAgent (HTTP, managed state)
  ├── BudgetTracker, MemoryProvider, Compression
  └── Registry (live agent tracking)

LLM LAYER (internal/llm/ + providers/)
  ├── Router (fault injection, fallback)
  ├── 10 built-in providers (Anthropic, OpenAI, Gemini, Ollama, Bedrock, Vertex, etc.)
  └── Credential pools, discovery

CROSS-CUTTING
  ├── Memory (active-memory, lance-index, embedding, dreaming)
  ├── Tools (registry, dispatch, MCP)
  ├── Observability (OTel, Langfuse, Sentry, PostHog)
  ├── Security (redaction, path-safety, auth)
  └── Persistence (FS, Memory, SQLite)
```

## Key Differentiators vs Mastra
- **Gateway system** (11 chat platform adapters)
- **Personality system** (persona presets)
- **Secret redaction** (30+ patterns)
- **Message compression** for long conversations
- **Path safety** primitives (sub-path export)
- **Subscription system** (SSE/WS with resume tokens)
- **Batch processing** primitives

## Module Count
- Core source files: ~200+ (packages/sdk/src/)
- Test files: ~538 (packages/sdk/tests/)
- Total packages in workspace: 32
