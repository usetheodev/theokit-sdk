# a peer framework — Architecture Map

## Overview
- **Type:** TypeScript AI Agent Framework (full-stack)
- **Architecture:** Modular monorepo with plugin-based extension
- **Monorepo:** pnpm workspaces + Turborepo, 90+ packages
- **Core Package:** `packages/core/` (~45K LoC), `packages/server/`, `packages/rag/`, `packages/memory/`
- **Build:** Turborepo + tsup (dual ESM+CJS), Vitest, ESLint+Prettier

## Layer Diagram

```
PUBLIC API (@a peer framework/core — 40+ sub-path exports)
  ├── a peer framework (framework entry), Agent, Workflow
  ├── Tool, Memory, RAG, MCP, Eval
  └── Auth, Cache, Vector, Voice, Signals, Channels

SERVER LAYER (@a peer framework/server)
  ├── HTTP handlers, route definitions
  ├── Server adapters (Hono, Express, NestJS, Koa, Fastify)
  └── OpenAPI spec generation

AGENT RUNTIME
  ├── Agent (autonomous reasoning + tool use)
  ├── Durable Agent (resumable state)
  ├── Tool Loop Agent (specialized tool-calling)
  ├── Agent-to-Agent (A2A) protocol
  └── Background Tasks (job queue)

DATA LAYER
  ├── Memory (@a peer framework/memory — conversation, semantic, working)
  ├── RAG (@a peer framework/rag — chunking, splitting, retrieval)
  ├── Vector (27 backends — Pinecone, Qdrant, PG, etc.)
  └── Storage (in-memory, DB persistence)

INTEGRATION LAYER
  ├── 40+ LLM providers (via AI SDK)
  ├── 27 vector store backends
  ├── 17 voice/TTS/STT providers
  ├── 9 auth providers
  ├── 13 observability platforms
  ├── Browser automation (Stagehand, Firecrawl)
  └── Channels (Slack), Signals (GitHub webhooks)

DEVELOPER TOOLS
  ├── CLI (16+ commands: init, dev, deploy, build, studio)
  ├── Visual Editor (browser-based)
  ├── Playground (agent testing)
  ├── Deployer (a peer vendor, Cloudflare, Netlify)
  └── Client SDKs (JS, React, AI SDK)
```

## Key Differentiators vs TheoKit SDK
- **RAG pipeline** (first-class document chunking + retrieval)
- **27 vector store backends** (vs TheoKit's LanceDB/SQLite-vec)
- **Voice integration** (17 TTS/STT providers)
- **Server adapters** (5 frameworks)
- **Visual Editor + Playground** (browser GUI)
- **Deployer** (multi-platform)
- **Agent-to-Agent (A2A)** protocol
- **Client SDKs** (JS, React, a peer framework)
- **18 starter templates**
- **Browser automation** integrations

## Module Count
- Core source files: ~300+ (packages/core/src/)
- Total packages: 90+
- Integration packages: 70+ (stores, voice, auth, observability)
