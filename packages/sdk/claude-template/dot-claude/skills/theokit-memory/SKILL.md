---
user-invocable: false
description: Memory API, embedding providers, dreaming, active recall, and backends for @theokit/sdk.
paths:
  - "**/*memory*"
  - "**/*Memory*"
  - "**/*embed*"
---

# TheoKit SDK -- Memory

Quick reference for durable memory, embedding providers, dreaming, and backends.

## Enabling memory on an agent

```typescript
import { Agent } from "@theokit/sdk";

const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
  memory: {
    enabled: true,
    namespace: "my-app",
    userId: "user-123",
    scope: "user",
  },
});

await (await agent.send("Remember: my preferred test runner is Vitest.")).wait();
```

## MemoryOptions

```typescript
interface MemoryOptions {
  enabled: boolean;
  namespace?: string;   // separates application domains
  userId?: string;      // isolates user memories
  scope?: "agent" | "user" | "team";
  storePath?: string;   // relative to workspace; cannot escape
}
```

## Scopes

| Scope | Use for |
|---|---|
| `"agent"` | Durable state for one agent ID. Default scope. |
| `"user"` | Stable user preferences across agent instances. Requires `userId`. |
| `"team"` | Shared team facts safe for every authorized caller. |

## Safety rules

- Memory MUST NOT store API keys, bearer tokens, passwords, or credential material.
- Local `storePath` is resolved relative to the workspace. Path traversal raises `ConfigurationError`.
- Memory is durable by `{ namespace, userId, scope }`, not by JavaScript process.

## SDKMemoryManager

```typescript
interface SDKMemoryManager {
  // Reserved for explicit inspection and deletion APIs.
}
```

The agent uses memory during runs automatically. Public management APIs are narrow until deletion and audit semantics are finalized.

## Memory backends (v1.2+)

```typescript
import { Memory } from "@theokit/sdk";

const memory = await Memory.create({
  cwd: process.cwd(),
  index: {
    backend: "sqlite-vec",  // default
    embedding: { provider: "openai", model: "text-embedding-3-small" },
  },
});

// Or use LanceDB for >100k facts:
const memory = await Memory.create({
  cwd: process.cwd(),
  index: {
    backend: "lance",
    embedding: { provider: "openai", model: "text-embedding-3-small" },
  },
});
```

- `@lancedb/lancedb` is an optional peer dep. If missing with `backend: "lance"`, throws `ConfigurationError(code: "lance_backend_unavailable")`.
- Embedding dimension validated when opening existing index. Mismatch throws `ConfigurationError(code: "embedding_dimension_mismatch")`.

## Embedding providers (ADR D11)

Locked provider union: `openai`, `mistral`, `openrouter`, `voyage`, `deepinfra`.

```typescript
index: {
  embedding: {
    provider: "openai",
    model: "text-embedding-3-small",
  },
}
```

Each provider adapter implements:

```typescript
interface EmbeddingAdapter {
  id: string;
  model: string;
  dimension: number;
  embed(texts: string[]): Promise<number[][]>;
}
```

## Memory migration CLI (v1.2+)

Migrate SQLite memory index to LanceDB without data loss:

```bash
# Dry-run (preview, no writes)
pnpm exec theokit-migrate-memory --cwd . --dry-run

# Real migration
pnpm exec theokit-migrate-memory --cwd .
```

Options: `--cwd <path>`, `--dry-run`, `--keep-sqlite`, `--batch-size <n>`.

Algorithm: read SQLite, write to staging `lance-new/`, validate count + sample text match, atomic rename, prompt to delete SQLite.

## Dreaming (consolidation sweeps)

```typescript
await Memory.runDreamingSweep({
  cwd: process.cwd(),
  embedding: { provider: "openai", model: "text-embedding-3-small" },
});
```

Dreaming consolidates redundant facts into compressed summaries. In v1.x, consolidation is deterministic only (no LLM-mediated narrative). LLM narrative mode is deferred.

## Active recall

Active recall queries memory during `agent.send` to inject relevant facts into the LLM context. Configured via the memory options on the agent. Query modes:

- `"embedding"` -- cosine similarity search against the vector index.
- `"keyword"` -- keyword-based search.
- `"hybrid"` -- combines embedding and keyword results.

## Semantic cache (related)

`Cache.semantic` from `@theokit/sdk` reuses embedding adapters for LLM response caching with cosine-similarity matching. See the cache documentation for details.

## Resume behavior

Memory is durable by `{ namespace, userId, scope }`, not by process. Recreating or resuming an agent with the same memory config can recall durable facts. Inline secrets and MCP servers are NOT persisted through memory.

## Conversation storage (pluggable persistence)

```typescript
import { Agent, InMemoryConversationStorage } from "@theokit/sdk";

const agent = await Agent.create({
  apiKey, model,
  conversationStorage: new InMemoryConversationStorage(),
});
```

Built-in adapters: `FileSystemConversationStorage`, `InMemoryConversationStorage`. Custom adapters implement `ConversationStorageAdapter`.

When using custom storage, `Agent.resume` requires the adapter to be passed again -- silent FS fallback is rejected with `ConfigurationError(code: "conversation_storage_required")`.
